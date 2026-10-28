//! Isolated per-plugin WebViews and their restricted broker.
//!
//! A webview-mode plugin page opens in its own native window, served from
//! the plugin's built UI directory over `tiktools-plugin://` with a strict
//! CSP (see [`assets`]). An initialization script installs the narrow
//! `window.tiktools` surface on top of Wry's `window.ipc` transport before
//! page code runs; the transport itself is left untouched (on WebKitGTK it
//! is a non-configurable property installed before init scripts, so it
//! cannot be deleted). The security boundary is the Rust handler behind
//! that transport: this window's `window.ipc` reaches only the restricted
//! [`broker::PluginUiBroker`], never the main window's full IPC router.
//! All broker calls (see [`broker`]) are ownership-scoped to the window's
//! bound plugin id.
//!
//! The manager owns every plugin window; the main-window lifecycle routes
//! window events here and issues open/close/respond commands. Teardown is
//! explicit and ordered (child WebView, then display sync, then parent
//! window); see [`PluginUiWindow::teardown`].

pub mod assets;
pub mod broker;
#[cfg(test)]
mod smoke;

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use serde_json::Value;
use tiktools_control_api::ControlApi;
use tiktools_core::AppCore;
use tokio::runtime::Handle;
use winit::event::WindowEvent;
use winit::event_loop::{ActiveEventLoop, EventLoopProxy};
use winit::window::{Window, WindowId};
use wry::dpi::{PhysicalPosition as WryPhysicalPosition, PhysicalSize as WryPhysicalSize};
use wry::{Rect, WebView, WebViewBuilder};

use crate::event::{DesktopCommand, DesktopEvent};
use crate::platform;
use crate::window::reload::{
    failure_reasons, PluginBridgeState, PluginPageSupervisor, RecoveryDecision, WebviewLifecycle,
};
use assets::{allows_navigation, plugin_page_url, PluginAssetServer, PLUGIN_ASSET_SCHEME};
use broker::PluginUiBroker;

/// Mirrors the core identifier rule (`helpers::is_identifier`): plugin and
/// page ids in open requests must be strict identifiers before any lookup.
pub fn is_valid_ui_id(value: &str) -> bool {
    let mut characters = value.chars();
    matches!(characters.next(), Some('a'..='z' | 'A'..='Z' | '_'))
        && value.len() <= 128
        && characters.all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-')
        })
}

fn apply_topics(
    current: &mut HashSet<String>,
    effect: crate::event::PluginUiSubscription,
) -> Result<(), &'static str> {
    match effect {
        crate::event::PluginUiSubscription::Subscribe(topics) => {
            if current
                .iter()
                .cloned()
                .chain(topics.iter().cloned())
                .collect::<HashSet<_>>()
                .len()
                > 32
            {
                return Err("plugin broker subscription capacity exhausted");
            }
            current.extend(topics);
        }
        crate::event::PluginUiSubscription::Unsubscribe(topics) => {
            for topic in topics {
                current.remove(&topic);
            }
        }
    }
    Ok(())
}

static NEXT_WINDOW_OWNER: AtomicU64 = AtomicU64::new(1);
static NEXT_PAGE_GENERATION: AtomicU64 = AtomicU64::new(1);

fn close_owner_matches(
    window_id: Option<WindowId>,
    owner: Option<u64>,
    current_id: WindowId,
    current_owner: u64,
) -> bool {
    window_id.is_none_or(|id| id == current_id)
        && owner.is_none_or(|generation| generation == current_owner)
}

/// Lifecycle of one native plugin window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PluginWindowState {
    /// Live: events, resizes, and broker responses flow normally.
    Open,
    /// `CloseRequested` was received: a deferred `ClosePluginUi` command
    /// will tear the entry down outside the window-event handler. Resizes
    /// and broker responses are ignored meanwhile; a racing `Destroyed`
    /// takes the disown path instead. A second close is never queued.
    Closing,
}

impl PluginWindowState {
    /// `CloseRequested` transition: `Open -> Closing` returns true (the
    /// caller must post the deferred teardown command); `Closing` returns
    /// false (a teardown is already queued).
    fn begin_close(&mut self) -> bool {
        if *self == PluginWindowState::Closing {
            return false;
        }
        *self = PluginWindowState::Closing;
        true
    }
}

/// One ordered teardown step. [`teardown_plan`] pins the destruction
/// sequence as data so tests assert it without a display server.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TeardownStep {
    DropWebView,
    SyncDisplay,
    DropWindow,
    ForgetWindow,
}

/// Destruction order for one plugin window: the child WebView dies first,
/// then (on Linux) the GDK round-trip flushes its container destroy while
/// the parent destroy is still buffered, and only then is the parent
/// window handle destroyed. When the server already destroyed the parent
/// (`Destroyed` without `CloseRequested`), the dead handle is forgotten
/// instead of destroyed twice.
fn teardown_plan(externally_destroyed: bool) -> [TeardownStep; 3] {
    if externally_destroyed {
        [
            TeardownStep::DropWebView,
            TeardownStep::SyncDisplay,
            TeardownStep::ForgetWindow,
        ]
    } else {
        [
            TeardownStep::DropWebView,
            TeardownStep::SyncDisplay,
            TeardownStep::DropWindow,
        ]
    }
}

struct PluginUiWindow {
    /// `None` only after [`PluginUiWindow::teardown`] has taken a handle:
    /// map-resident entries always hold both live handles.
    webview: Option<WebView>,
    window: Option<Window>,
    topics: HashSet<String>,
    state: PluginWindowState,
    ipc_shutdown: tokio::sync::watch::Sender<bool>,
    ipc_slots: Arc<tokio::sync::Semaphore>,
    output: crate::window::outbox::WebviewOutbox,
    generation: Arc<AtomicU64>,
    output_generation: u64,
    owner: u64,
    /// Explicit lifecycle for this pop-out: Loading until the first broker
    /// round-trip proves the init script installed `window.tiktools`.
    lifecycle: PluginPageSupervisor,
}

impl Drop for PluginUiWindow {
    fn drop(&mut self) {
        // `Drop::drop` runs BEFORE field destructors (fields then drop in
        // declaration order), so every handle is taken explicitly in
        // `teardown` instead of relying on field order. Covers every
        // removal path: close, deferred CloseRequested, retain-based
        // teardown, and map drop.
        self.teardown();
    }
}

impl PluginUiWindow {
    fn sync_generation(&mut self) {
        let generation = self.generation.load(Ordering::Acquire);
        if generation != self.output_generation {
            self.output_generation = generation;
            // Navigation Started: reset subscriptions for the previous page
            // before the fresh document can inherit them, drop its stale
            // backlog without replay, and restart the bounded bridge
            // watchdog. Recovery never replays broker calls.
            self.output.discard_pending();
            self.topics.clear();
            let from = self.lifecycle.state();
            self.lifecycle
                .on_navigation_started(std::time::Instant::now());
            tracing::info!(
                generation,
                from = ?from,
                to = ?self.lifecycle.state(),
                "plugin WebView navigation Started: subscriptions reset, bridge watchdog started"
            );
        }
    }

    /// Post-navigation bridge readiness check: the first broker round-trip
    /// on this generation proves the init script installed
    /// `window.tiktools`. Until then delivery stays halted.
    fn mark_bridge_ready(&mut self, plugin_id: &str, page_id: &str) {
        if self.lifecycle.bridge() != PluginBridgeState::Ready {
            self.lifecycle.on_bridge_message();
            tracing::info!(
                plugin = plugin_id,
                page = page_id,
                lifecycle = ?self.lifecycle.state(),
                "plugin WebView bridge Ready: init script verified, delivery restored"
            );
        }
    }

    fn handle(&self) -> &Window {
        self.window
            .as_ref()
            .expect("map-resident plugin window holds its handle")
    }

    fn view(&self) -> &WebView {
        self.webview
            .as_ref()
            .expect("map-resident plugin window holds its WebView")
    }

    /// Explicit ordered teardown: child WebView, then display sync, then
    /// parent window. Safe to run twice (second run finds `None`s).
    fn teardown(&mut self) {
        let _ = self.ipc_shutdown.send(true);
        self.ipc_slots.close();
        self.output.discard_pending();
        self.topics.clear();
        for step in teardown_plan(false) {
            self.execute(step);
        }
    }

    /// Drops a window the server already destroyed (no CloseRequested, e.g.
    /// an external kill): the dead parent handle is forgotten instead of
    /// queueing a second destroy for a dead id (which would file the same
    /// stale BadWindow the sync exists to prevent). `self` then drops with
    /// both handles taken, so the normal `Drop` is a no-op: no double
    /// destroy, and no leak on the normal close path.
    fn disown_destroyed(mut self) {
        let _ = self.ipc_shutdown.send(true);
        self.ipc_slots.close();
        self.output.discard_pending();
        self.topics.clear();
        for step in teardown_plan(true) {
            self.execute(step);
        }
    }

    fn execute(&mut self, step: TeardownStep) {
        match step {
            TeardownStep::DropWebView => {
                if let Some(webview) = self.webview.take() {
                    crate::platform::prepare_webview_teardown(&webview);
                    drop(webview);
                }
            }
            // Must run AFTER the WebView drop and BEFORE the parent
            // window drop: it forces the container destroy ahead of the
            // parent destroy (see `platform::sync_gtk_display`).
            TeardownStep::SyncDisplay => crate::platform::sync_gtk_display(),
            TeardownStep::DropWindow => {
                if let Some(window) = self.window.take() {
                    drop(window);
                }
            }
            TeardownStep::ForgetWindow => {
                crate::platform::record_external_destroy();
                std::mem::forget(self.window.take());
            }
        }
    }
}

/// Verifies the initialization script is available before a plugin window
/// is built. The bridge check is post-navigation (first broker round-trip),
/// but a missing or truncated script must fail fast with a diagnostic
/// instead of opening a blank page that only times out later.
pub fn init_script_available() -> bool {
    !INIT_SCRIPT.is_empty()
        && INIT_SCRIPT.contains("window.tiktools")
        && INIT_SCRIPT.contains("__tiktools_broker_push__")
        && INIT_SCRIPT.contains("apiVersion: 1")
        && !INIT_SCRIPT.contains("delete window.ipc")
}

#[derive(Default)]
pub struct PluginUiWindows {
    windows: HashMap<(String, String), PluginUiWindow>,
    flush_cursor: usize,
    evaluate_calls: u64,
    evaluate_bytes: u64,
    evaluate_errors: u64,
    /// Auto-recreate budget per plugin page: at most one automatic reopen
    /// after a timed-out window is closed. Manual reopens reset the count
    /// by going through `open` (which clears the entry on success).
    recreate_budget: HashMap<(String, String), u32>,
    pending_recreates: Vec<(String, String)>,
}

impl PluginUiWindows {
    /// Opens (or focuses, when already open) the isolated window for one
    /// plugin page. Returns whether a new window was created.
    #[allow(clippy::too_many_arguments)]
    pub fn open(
        &mut self,
        event_loop: &ActiveEventLoop,
        core: &Arc<AppCore>,
        control: &Arc<ControlApi>,
        runtime: &Handle,
        proxy: &EventLoopProxy<DesktopEvent>,
        plugin_id: &str,
        page_id: &str,
    ) -> Result<bool, String> {
        if !is_valid_ui_id(plugin_id) || !is_valid_ui_id(page_id) {
            return Err("invalid plugin or page id".to_owned());
        }
        let key = (plugin_id.to_owned(), page_id.to_owned());
        if let Some(existing) = self.windows.get(&key) {
            if existing.state == PluginWindowState::Closing {
                // A deferred teardown is still queued: finish it now so the
                // fresh window never shares a map entry with the dying one.
                // The queued close carries the old native id and cannot
                // destroy the replacement window.
                self.windows.remove(&key);
            } else {
                existing.handle().focus_window();
                tracing::debug!(
                    plugin = plugin_id,
                    page = page_id,
                    "plugin window already open, focused"
                );
                return Ok(false);
            }
        }
        if self.windows.len() >= 32 {
            return Err("native plugin window capacity exhausted (32)".to_owned());
        }
        let target = core
            .plugin_ui_target(plugin_id, page_id)
            .map_err(|error| error.to_string())?;
        let window = event_loop
            .create_window(
                Window::default_attributes()
                    .with_title(format!("TikTools — {}", target.name))
                    .with_inner_size(winit::dpi::LogicalSize::new(960_u32, 720_u32))
                    .with_min_inner_size(winit::dpi::LogicalSize::new(640_u32, 480_u32))
                    .with_resizable(true)
                    .with_visible(true),
            )
            .map_err(|error| format!("could not create plugin window: {error}"))?;

        let assets = PluginAssetServer::new(target.id.clone(), Arc::new(target.asset_root.clone()));
        let navigation_plugin = target.id.clone();
        let ipc_plugin = target.id.clone();
        let ipc_page = target.page_id.clone();
        let ipc_window_id = window.id();
        let ipc_proxy = proxy.clone();
        let ipc_runtime = runtime.clone();
        let ipc_control = control.clone();
        let ipc_slots = Arc::new(tokio::sync::Semaphore::new(128));
        let handler_slots = Arc::clone(&ipc_slots);
        let generation = Arc::new(AtomicU64::new(
            NEXT_PAGE_GENERATION.fetch_add(1, Ordering::AcqRel),
        ));
        let owner = NEXT_WINDOW_OWNER.fetch_add(1, Ordering::AcqRel);
        let page_generation = generation.clone();
        let handler_generation = generation.clone();
        // Post-navigation bridge readiness requires the init script: verify
        // availability before the WebView is built so a missing bridge
        // surfaces as a loud diagnostic instead of a blank page.
        if !init_script_available() {
            tracing::error!(
                plugin = plugin_id,
                page = page_id,
                reason = failure_reasons::INIT_SCRIPT_MISSING,
                "plugin WebView init script unavailable; not opening"
            );
            return Err("plugin WebView initialization script unavailable".to_owned());
        }
        let (ipc_shutdown, shutdown_receiver) = tokio::sync::watch::channel(false);
        let mut builder = WebViewBuilder::new()
            .with_on_page_load_handler(move |event, url| {
                if matches!(event, wry::PageLoadEvent::Started) {
                    let generation = NEXT_PAGE_GENERATION.fetch_add(1, Ordering::AcqRel);
                    page_generation.store(generation, Ordering::Release);
                    tracing::info!(url = %url, generation, "plugin WebView navigation Started");
                } else {
                    tracing::info!(url = %url, "plugin WebView navigation Finished; waiting for bridge Ready");
                }
            })
            .with_devtools(cfg!(debug_assertions) || cfg!(feature = "devtools"))
            .with_autoplay(true)
            .with_initialization_script(INIT_SCRIPT)
            .with_navigation_handler(move |url| {
                let allowed = allows_navigation(&navigation_plugin, &url);
                if !allowed {
                    tracing::warn!(url = %url, plugin = %navigation_plugin, "blocked plugin WebView navigation");
                }
                allowed
            })
            .with_new_window_req_handler(move |url, _features| {
                tracing::debug!(url = %url, "blocked plugin WebView new-window request");
                wry::NewWindowResponse::Deny
            })
            .with_ipc_handler(move |request| {
                // The in-page devtools shortcut never reaches the broker
                // allowlist: opening the inspector is window chrome, not a
                // broker call. The check is allocation-free and size-gated.
                if crate::window::ipc::is_open_devtools_fast(request.body()) {
                    let _ = ipc_proxy.send_event(DesktopEvent::Command(
                        DesktopCommand::OpenPluginDevtools {
                            window_id: ipc_window_id,
                        },
                    ));
                    return;
                }
                // Size-gated before queueing (same bound the broker
                // enforces): the payload moves to Tokio for handling and
                // the response returns through `PluginUiRespond`.
                if request.body().len() > tiktools_control_api::MAX_REQUEST_BYTES {
                    tracing::warn!(plugin = %ipc_plugin, "plugin broker request exceeds size limit");
                    return;
                }
                let Ok(permit) = Arc::clone(&handler_slots).try_acquire_owned() else {
                    tracing::warn!(plugin = %ipc_plugin, "plugin broker admission full or closed");
                    return;
                };
                let generation = handler_generation.load(Ordering::Acquire);
                let task_generation = handler_generation.clone();
                let mut cancelled = shutdown_receiver.clone();
                let raw = request.body().clone();
                let broker = PluginUiBroker::new(ipc_plugin.clone(), ipc_control.clone());
                let proxy = ipc_proxy.clone();
                let plugin_id = ipc_plugin.clone();
                let page_id = ipc_page.clone();
                ipc_runtime.spawn(async move {
                    let admission = Arc::new(crate::event::NativeAdmission::new(permit));
                    if *cancelled.borrow_and_update() || task_generation.load(Ordering::Acquire) != generation { return; }
                    let (mut response, effect) = tokio::select! {
                        biased;
                        _ = cancelled.changed() => return,
                        result = tokio::time::timeout(std::time::Duration::from_secs(30), broker.handle(&raw)) => {
                            match result {
                                Ok(result) => result,
                                Err(_) => { tracing::warn!(plugin = %plugin_id, "plugin broker host request timed out"); return; },
                            }
                        },
                    };
                    // Rejections are host-side diagnostics (a page that
                    // only sees `broker error` cannot tell a bad method
                    // from a dead window): log them with owner context.
                    // Responses are small host-generated envelopes.
                    if let Ok(value) = serde_json::from_str::<Value>(&response) {
                        if value.get("ok") == Some(&Value::Bool(false)) {
                            tracing::debug!(
                                plugin = %plugin_id,
                                page = %page_id,
                                error = %value
                                    .get("error")
                                    .and_then(|error| error.as_str())
                                    .unwrap_or("broker error"),
                                "plugin broker rejected native request"
                            );
                        }
                    }
                    if response.len() > crate::window::outbox::MAX_OUTBOUND_BYTES {
                        let id = serde_json::from_str::<Value>(&response).ok().and_then(|v| v.get("id").cloned()).unwrap_or(Value::Null);
                        response = serde_json::json!({"apiVersion": 1, "id": id, "ok": false, "error": "broker response exceeds transport limit"}).to_string();
                    }
                    let _ = proxy.send_event(DesktopEvent::Command(
                        DesktopCommand::PluginUiRespond {
                            window_id: ipc_window_id, plugin_id, page_id,
                            response: response.into(), effect: effect.map(Into::into), generation, admission,
                        },
                    ));
                });
            });
        // Physical bounds from the start (see the main window): some
        // XWayland/KDE sessions report zero screen dimensions, which breaks
        // the logical-default conversion before the WebView attaches.
        let initial_size = window.inner_size();
        builder = builder.with_bounds(Rect {
            position: WryPhysicalPosition::new(0, 0).into(),
            size: WryPhysicalSize::new(initial_size.width.max(1), initial_size.height.max(1))
                .into(),
        });
        builder = builder
            .with_custom_protocol(PLUGIN_ASSET_SCHEME.to_owned(), move |_id, request| {
                assets.respond(request)
            });
        let url = plugin_page_url(&target.id, &target.entry_file, &target.page_id);
        builder = builder.with_url(url.as_str());
        let webview = platform::build_webview(builder, &window)
            .map_err(|error| format!("could not create plugin WebView: {error}"))?;
        window.focus_window();
        let lifecycle = PluginPageSupervisor::new(std::time::Instant::now());
        self.windows.insert(
            key,
            PluginUiWindow {
                webview: Some(webview),
                window: Some(window),
                topics: HashSet::new(),
                state: PluginWindowState::Open,
                ipc_shutdown,
                ipc_slots,
                output: crate::window::outbox::WebviewOutbox::new(),
                generation,
                output_generation: 0,
                owner,
                lifecycle,
            },
        );
        tracing::info!(
            plugin = plugin_id,
            page = page_id,
            transport = "native",
            lifecycle = ?WebviewLifecycle::Loading,
            "plugin window opened: lifecycle Loading, waiting for bridge Ready"
        );
        Ok(true)
    }

    /// Tears one window down through the ordered teardown (`Drop`). Runs
    /// outside window-event dispatch (deferred `CloseRequested`, explicit
    /// close requests, teardown topics). Closing a missing window is a
    /// harmless no-op, so a queued close can never double-destroy.
    pub(crate) fn close_if_current(
        &mut self,
        plugin_id: &str,
        page_id: &str,
        window_id: Option<WindowId>,
        owner: Option<u64>,
    ) {
        if window_id.is_some() || owner.is_some() {
            let Some(entry) = self
                .windows
                .get(&(plugin_id.to_owned(), page_id.to_owned()))
            else {
                return;
            };
            if !close_owner_matches(window_id, owner, entry.handle().id(), entry.owner) {
                return;
            }
        }
        self.close(plugin_id, page_id);
    }

    pub fn close(&mut self, plugin_id: &str, page_id: &str) {
        if self
            .windows
            .remove(&(plugin_id.to_owned(), page_id.to_owned()))
            .is_some()
        {
            tracing::debug!(
                plugin = plugin_id,
                page = page_id,
                "closed plugin UI window"
            );
        } else {
            tracing::debug!(
                plugin = plugin_id,
                page = page_id,
                "plugin window close ignored (not open)"
            );
        }
    }

    /// Closes every window owned by one plugin (lifecycle: the plugin was
    /// stopped, disabled, or uninstalled).
    pub fn close_plugin(&mut self, plugin_id: &str) {
        let before = self.windows.len();
        self.windows.retain(|(owner, _), _| owner != plugin_id);
        let closed = before - self.windows.len();
        if closed > 0 {
            tracing::debug!(
                plugin = plugin_id,
                closed,
                "plugin torn down, windows closed"
            );
        }
    }

    pub fn apply_subscription(
        &mut self,
        plugin_id: &str,
        page_id: &str,
        effect: crate::event::PluginUiSubscription,
        window_id: WindowId,
        generation: u64,
    ) {
        let Some(window) = self
            .windows
            .get_mut(&(plugin_id.to_owned(), page_id.to_owned()))
        else {
            return;
        };
        if window.handle().id() != window_id
            || window.state != PluginWindowState::Open
            || window.generation.load(Ordering::Acquire) != generation
        {
            return;
        }
        window.sync_generation();
        // A subscription round-trip proves the bridge is live on this
        // generation (post-navigation readiness check).
        window.mark_bridge_ready(plugin_id, page_id);
        if window.lifecycle.bridge() == PluginBridgeState::Ready {
            // A working bridge resets the auto-recreate budget: the next
            // failure sequence gets its own bounded recovery.
            self.recreate_budget
                .remove(&(plugin_id.to_owned(), page_id.to_owned()));
        }
        if let Err(error) = apply_topics(&mut window.topics, effect) {
            tracing::warn!(error, "legacy subscription effect rejected");
        }
    }

    /// Delivers one broker response to the calling window. Late
    /// responses for closed (or closing) windows are ignored safely: the
    /// entry is gone or skipped, so nothing ever evaluates script on a
    /// dead WebView.
    pub fn respond(
        &mut self,
        plugin_id: &str,
        page_id: &str,
        response: Arc<str>,
        window_id: WindowId,
        generation: u64,
        effect: Option<crate::event::PluginUiSubscription>,
    ) {
        let Some(window) = self
            .windows
            .get_mut(&(plugin_id.to_owned(), page_id.to_owned()))
            .filter(|entry| {
                entry.state == PluginWindowState::Open
                    && entry.handle().id() == window_id
                    && entry.generation.load(Ordering::Acquire) == generation
            })
        else {
            return;
        };
        window.sync_generation();
        // Any broker response proves the init script installed
        // `window.tiktools` on this generation.
        window.mark_bridge_ready(plugin_id, page_id);
        if window.lifecycle.bridge() == PluginBridgeState::Ready {
            self.recreate_budget
                .remove(&(plugin_id.to_owned(), page_id.to_owned()));
        }
        let rejection = effect.and_then(|effect| apply_topics(&mut window.topics, effect).err());
        if let Some(error) = rejection {
            let id = serde_json::from_str::<Value>(&response)
                .ok()
                .and_then(|value| value.get("id").cloned())
                .unwrap_or(Value::Null);
            window.output.push(
                serde_json::json!({"apiVersion":1,"id":id,"ok":false,"error":error}).to_string(),
            );
        } else {
            window.output.push_critical(response);
        }
    }

    /// Plugin event topics have no general loss/resync contract. Keep these
    /// reliable rather than silently treating arbitrary plugin events as feed.
    #[cfg(test)]
    pub fn deliver_event(&mut self, plugin_id: &str, topic: &str, data: &Value) {
        let envelope = serde_json::json!({
            "apiVersion": broker::BROKER_API_VERSION, "event": topic, "data": data,
        });
        for ((owner, _), window) in &mut self.windows {
            window.sync_generation();
            if owner == plugin_id
                && window.state == PluginWindowState::Open
                && window.topics.contains(topic)
            {
                window.output.push_value(&envelope);
            }
        }
    }

    /// Fair schedule: at most one capped evaluation per open window per tick.
    /// A failed/overflowed reliable transport closes its owner coherently;
    /// pagehide rejects broker promises. Nothing retries side effects.
    pub(crate) fn flush_batches(&mut self) -> bool {
        let mut failed = Vec::new();
        let mut pending = false;
        let mut keys: Vec<_> = self.windows.keys().cloned().collect();
        keys.sort();
        let selected: Vec<_> = keys
            .iter()
            .cycle()
            .skip(self.flush_cursor)
            .take(keys.len().min(4))
            .cloned()
            .collect();
        self.flush_cursor = if keys.is_empty() {
            0
        } else {
            (self.flush_cursor + selected.len()) % keys.len()
        };
        for key in selected {
            let window = self
                .windows
                .get_mut(&key)
                .expect("selected window is map resident");
            window.sync_generation();
            if window.state != PluginWindowState::Open {
                continue;
            }
            // Hold batches until the post-navigation bridge check passes:
            // the first broker round-trip proves `window.tiktools` is live.
            // Queued output waits (still counted as pending for wake
            // chaining) instead of evaluating into a page without a bridge.
            if !window.lifecycle.is_delivery_allowed() {
                pending |= !window.output.is_empty();
                continue;
            }
            if window.output.take_transport_failure() {
                failed.push(key.clone());
                continue;
            }
            let batch = window.output.take_prepared_batch();
            if !batch.is_empty() {
                let envelopes = batch
                    .iter()
                    .map(|message| message.body.as_ref())
                    .collect::<Vec<_>>()
                    .join(",");
                let script = format!("if (typeof window.__tiktools_broker_push__ === 'function') {{ for (const item of [{envelopes}]) window.__tiktools_broker_push__(item); }}");
                self.evaluate_calls = self.evaluate_calls.saturating_add(1);
                self.evaluate_bytes = self.evaluate_bytes.saturating_add(script.len() as u64);
                if let Err(error) = window.view().evaluate_script(&script) {
                    self.evaluate_errors = self.evaluate_errors.saturating_add(1);
                    tracing::error!(%error, plugin = %key.0, page = %key.1, reason = failure_reasons::EVALUATION_FAILED, "plugin WebView lifecycle Failed: evaluation failed; closing its transport");
                    failed.push(key.clone());
                }
            }
            pending |= !window.output.is_empty();
        }
        for (plugin, page) in failed {
            self.close(&plugin, &page);
        }
        pending
            || self
                .windows
                .values()
                .any(|window| window.state == PluginWindowState::Open && !window.output.is_empty())
    }

    /// Bounded recovery poll for pop-out windows, run on the UI thread.
    /// For each open window the bridge watchdog is checked: first expiry
    /// attempts one controlled `reload()`, the next expiry closes the
    /// faulty window and queues one automatic recreate (bounded per page),
    /// then parks without further retries. Never restarts `AppCore`, never
    /// replays broker calls, never loops.
    pub(crate) fn poll_recovery(&mut self) {
        let now = std::time::Instant::now();
        let keys: Vec<(String, String)> = self.windows.keys().cloned().collect();
        let mut to_close: Vec<(String, String)> = Vec::new();
        for key in keys {
            let Some(window) = self.windows.get_mut(&key) else {
                continue;
            };
            if window.state != PluginWindowState::Open {
                continue;
            }
            window.sync_generation();
            match window.lifecycle.check_timeout(now) {
                RecoveryDecision::Wait => {}
                RecoveryDecision::ReloadOnce => {
                    tracing::warn!(
                        plugin = %key.0,
                        page = %key.1,
                        reason = failure_reasons::RELOAD_TIMEOUT,
                        "plugin WebView reload timeout: attempting one controlled navigation recovery"
                    );
                    window.output.discard_pending();
                    match window.view().reload() {
                        Ok(()) => {
                            tracing::info!(
                                plugin = %key.0,
                                page = %key.1,
                                "plugin WebView navigation recovery reload issued"
                            );
                        }
                        Err(error) => {
                            tracing::error!(%error, plugin = %key.0, page = %key.1, "plugin WebView reload failed; closing");
                            to_close.push(key.clone());
                        }
                    }
                }
                RecoveryDecision::Recreate => {
                    tracing::warn!(
                        plugin = %key.0,
                        page = %key.1,
                        reason = failure_reasons::RELOAD_TIMEOUT,
                        "plugin WebView reload timeout persists: recreating the window"
                    );
                    to_close.push(key.clone());
                    let budget = self.recreate_budget.get(&key).copied().unwrap_or(0);
                    if budget < 1 {
                        self.recreate_budget.insert(key.clone(), budget + 1);
                        self.pending_recreates.push(key.clone());
                    } else {
                        tracing::error!(
                            plugin = %key.0,
                            page = %key.1,
                            "plugin WebView recreate budget exhausted; not reopening"
                        );
                    }
                }
                RecoveryDecision::GiveUp => {
                    tracing::error!(
                        plugin = %key.0,
                        page = %key.1,
                        reason = ?window.lifecycle.failure_reason(),
                        "plugin WebView recovery exhausted; closing without further retries"
                    );
                    to_close.push(key.clone());
                }
            }
        }
        for (plugin, page) in to_close {
            self.close(&plugin, &page);
        }
    }

    /// Drains plugin pages queued for automatic recreate (at most one per
    /// page per failure sequence). The caller reopens them on the UI thread
    /// with the same `open` path, preserving `AppCore` and user data.
    pub(crate) fn drain_pending_recreates(&mut self) -> Vec<(String, String)> {
        std::mem::take(&mut self.pending_recreates)
    }

    /// Opens the inspector for one plugin window on the UI thread.
    /// Release builds without the `devtools` cargo feature keep the
    /// shortcut compiled but an intentional no-op, mirroring the main
    /// window.
    pub(crate) fn open_devtools_for_window(&self, window_id: WindowId) {
        #[cfg(any(debug_assertions, feature = "devtools"))]
        {
            for window in self.windows.values() {
                if window.state == PluginWindowState::Open && window.handle().id() == window_id {
                    window.view().open_devtools();
                    return;
                }
            }
        }
        #[cfg(not(any(debug_assertions, feature = "devtools")))]
        {
            let _ = window_id;
        }
    }

    pub(crate) fn diagnostics(&self) -> Value {
        let mut queued = 0;
        let mut bytes = 0;
        let mut tasks = 0;
        let mut loading = 0;
        let mut ready = 0;
        let mut failed = 0;
        let mut recovering = 0;
        for window in self.windows.values() {
            let snapshot = window.output.diagnostics();
            queued += snapshot["reliableCount"].as_u64().unwrap_or(0);
            bytes += snapshot["reliableBytes"].as_u64().unwrap_or(0);
            tasks += 128usize.saturating_sub(window.ipc_slots.available_permits());
            match window.lifecycle.state() {
                WebviewLifecycle::Loading => loading += 1,
                WebviewLifecycle::Ready => ready += 1,
                WebviewLifecycle::Failed => failed += 1,
                WebviewLifecycle::Recovering => recovering += 1,
            }
        }
        serde_json::json!({"openWindows": self.windows.len(), "queued": queued, "bytes": bytes, "brokerTasks": tasks, "evaluateCalls": self.evaluate_calls, "evaluateBytes": self.evaluate_bytes, "evaluateErrors": self.evaluate_errors, "lifecycle": {"loading": loading, "ready": ready, "failed": failed, "recovering": recovering}, "pendingRecreates": self.pending_recreates.len()})
    }

    pub(crate) fn forward_prepared(
        &mut self,
        message: &crate::window::outbox::QueuedWebviewMessage,
    ) {
        let Some(route) = message.plugin.as_ref() else {
            return;
        };
        if is_teardown_topic(&route.topic) {
            self.close_plugin(&route.plugin_id);
            return;
        }
        for ((owner, _), window) in &mut self.windows {
            window.sync_generation();
            if owner == &route.plugin_id
                && window.state == PluginWindowState::Open
                && window.topics.contains(&route.topic)
            {
                window.output.push_critical(message.body.clone());
            }
        }
    }

    /// Fans host JSON-RPC `event` notifications out to subscribed plugin
    /// windows, and closes windows whose plugin went away. Called with the
    /// same already-queued main-window payload (host-generated, bounded);
    /// unparseable input is ignored — the main window path owns delivery.
    #[cfg(test)]
    pub fn forward_host_message(&mut self, message: &str) {
        let Some((plugin_id, topic, data)) = parse_host_notification(message) else {
            return;
        };
        if is_teardown_topic(&topic) {
            self.close_plugin(&plugin_id);
        } else {
            self.deliver_event(&plugin_id, &topic, &data);
        }
    }

    /// Routes a window event to plugin windows. Returns true when a plugin
    /// window consumed it.
    ///
    /// `CloseRequested` never destroys handles re-entrantly: the entry is
    /// marked `Closing`, hidden for immediate feedback, and torn down by a
    /// deferred `ClosePluginUi` command outside window-event dispatch.
    pub fn on_window_event(
        &mut self,
        proxy: &EventLoopProxy<DesktopEvent>,
        window_id: WindowId,
        event: &WindowEvent,
    ) -> bool {
        let key = self
            .windows
            .iter()
            .find(|(_, window)| {
                window
                    .window
                    .as_ref()
                    .is_some_and(|handle| handle.id() == window_id)
            })
            .map(|(key, _)| key.clone());
        let Some(key) = key else {
            return false;
        };
        match event {
            WindowEvent::CloseRequested => {
                let Some(entry) = self.windows.get_mut(&key) else {
                    return true;
                };
                if !entry.state.begin_close() {
                    // Duplicate request while a teardown is already queued.
                    return true;
                }
                entry.handle().set_visible(false);
                tracing::debug!(
                    plugin = %key.0,
                    page = %key.1,
                    "plugin UI window close requested; teardown deferred"
                );
                let _ = proxy.send_event(DesktopEvent::Command(DesktopCommand::ClosePluginUi {
                    plugin_id: key.0.clone(),
                    page_id: key.1.clone(),
                    window_id: Some(window_id),
                    owner: Some(entry.owner),
                }));
            }
            WindowEvent::Destroyed => {
                // The server destroyed this window without a close
                // request: disown the dead handle instead of dropping it.
                // A queued `ClosePluginUi` for the same entry then finds
                // nothing and is a harmless no-op: no double destroy.
                tracing::debug!(
                    plugin = %key.0,
                    page = %key.1,
                    "plugin window destroyed by server"
                );
                if let Some(entry) = self.windows.remove(&key) {
                    entry.disown_destroyed();
                }
            }
            WindowEvent::KeyboardInput { event, .. } => {
                // Parent-focused shortcuts (the page-focused case is
                // covered by the init script). Closing windows ignore
                // keys: their WebView is about to be torn down.
                use winit::event::ElementState;
                use winit::keyboard::{KeyCode, PhysicalKey};
                if event.state == ElementState::Pressed && !event.repeat {
                    match event.physical_key {
                        PhysicalKey::Code(KeyCode::F12) => {
                            self.open_devtools_for_window(window_id);
                        }
                        PhysicalKey::Code(KeyCode::F5) => {
                            if let Some(window) = self
                                .windows
                                .get_mut(&key)
                                .filter(|entry| entry.state == PluginWindowState::Open)
                            {
                                window.output.discard_pending();
                                if let Err(error) = window.view().reload() {
                                    tracing::debug!(%error, "plugin WebView manual reload failed");
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
            WindowEvent::Resized(size) => {
                // Closing windows ignore resizes: their WebView is about
                // to be torn down by the deferred close.
                if let Some(window) = self
                    .windows
                    .get(&key)
                    .filter(|entry| entry.state == PluginWindowState::Open)
                {
                    let bounds = Rect {
                        position: WryPhysicalPosition::new(0, 0).into(),
                        size: WryPhysicalSize::new(size.width.max(1), size.height.max(1)).into(),
                    };
                    if let Err(error) = window.view().set_bounds(bounds) {
                        tracing::debug!(%error, "could not resize plugin WebView");
                    }
                }
            }
            WindowEvent::Focused(gained) => {
                tracing::debug!(plugin = %key.0, page = %key.1, gained, "plugin window focus changed");
                // Closing windows ignore focus: their WebView is about to
                // be torn down by the deferred close.
                if platform::window_focus_action(*gained)
                    == platform::WindowFocusAction::FocusWebview
                {
                    if let Some(window) = self
                        .windows
                        .get(&key)
                        .filter(|entry| entry.state == PluginWindowState::Open)
                    {
                        if let Err(error) = window.view().focus() {
                            tracing::debug!(%error, "could not focus plugin WebView");
                        }
                    }
                }
            }
            _ => {}
        }
        true
    }
}

/// Topics that tear down a plugin's windows: the runtime went away
/// (stop covers disable; uninstall covers removal), so no window may
/// outlive it.
fn is_teardown_topic(topic: &str) -> bool {
    matches!(topic, "plugin.uninstalled" | "plugin.stopped")
}

/// Extracts `(plugin_id, topic, data)` from a host `event` notification.
/// Only `plugin.*` topics with a string `pluginId` route to plugin
/// windows; everything else (including gap markers) is ignored.
#[cfg(test)]
fn parse_host_notification(message: &str) -> Option<(String, String, Value)> {
    if !message.contains("\"method\":\"event\"") && !message.contains("\"method\": \"event\"") {
        return None;
    }
    let value: Value = serde_json::from_str(message).ok()?;
    let params = value.get("params")?;
    let topic = params.get("topic")?.as_str()?;
    if !topic.starts_with("plugin.") {
        return None;
    }
    let data = params.get("data")?.clone();
    let plugin_id = data.get("pluginId")?.as_str()?.to_owned();
    Some((plugin_id, topic.to_owned(), data))
}

/// Runs before any page script: installs the narrow `window.tiktools`
/// surface on top of Wry's `window.ipc` transport. The transport itself
/// is deliberately left untouched: on WebKitGTK it is installed (via
/// `Object.defineProperty`, non-writable and non-configurable) *before*
/// initialization scripts run, so deleting or overwriting it throws in
/// strict mode and aborts the whole script — leaving `window.tiktools`
/// uninstalled. The security boundary is not the absence of the
/// transport but the Rust handler behind it: this window's `window.ipc`
/// reaches only [`broker::PluginUiBroker`], never the main router.
const INIT_SCRIPT: &str = r#"(function () {
  'use strict';
  if (window.tiktools !== undefined) return;
  // Page-focused shortcuts, installed even when the bridge is unavailable:
  // F5 / Ctrl+R reload the page in place (the navigation Started event
  // resets subscriptions for the previous document); F12 / Ctrl+Shift+I
  // ask the host to open the inspector. The devtools request reads the
  // transport directly and never reaches the broker allowlist.
  window.addEventListener('keydown', function (e) {
    try {
      var reloadKey = e.key === 'F5' || ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'r' || e.key === 'R'));
      var devtoolsKey = e.key === 'F12' || ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'I' || e.key === 'i'));
      if (reloadKey) {
        e.preventDefault();
        window.location.reload();
      } else if (devtoolsKey) {
        e.preventDefault();
        if (window.ipc && typeof window.ipc.postMessage === 'function') {
          window.ipc.postMessage('{"type":"open-devtools"}');
        }
      }
    } catch (shortcutError) { /* never break page input */ }
  }, true);
  var ipc = (window.ipc && typeof window.ipc.postMessage === 'function') ? window.ipc : null;
  function unavailable() { return Promise.reject(new Error('plugin host is unavailable')); }
  if (!ipc) {
    window.__tiktools_transport__ = 'unavailable';
    window.tiktools = {
      settings: { get: unavailable, set: unavailable },
      actions: { execute: unavailable },
      options: { get: unavailable },
      events: { subscribe: function () { return function () {}; } },
      host: { locale: unavailable, theme: unavailable }
    };
    return;
  }
  window.__tiktools_transport__ = 'native';
  if (window.__tiktools_broker_dispose__) window.__tiktools_broker_dispose__();
  var sequence = 0;
  var instanceId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  var pending = new Map();
  var listeners = new Map();
  var listenerCount = 0;
  var disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    pending.forEach(function (entry) {
      clearTimeout(entry.timer);
      entry.reject(new Error('plugin host was closed'));
    });
    pending.clear();
    listeners.clear();
    listenerCount = 0;
    window.removeEventListener('pagehide', dispose);
    window.removeEventListener('beforeunload', dispose);
  }
  window.__tiktools_broker_dispose__ = dispose;
  window.__tiktools_broker_diagnostics__ = function () { return {pending:pending.size,topics:listeners.size,listeners:listenerCount}; };
  window.addEventListener('pagehide', dispose);
  window.addEventListener('beforeunload', dispose);
  function fire(topic, data) {
    var watchers = listeners.get(topic);
    if (!watchers) return;
    watchers.slice().forEach(function (listener) {
      try { listener(topic, data); } catch (listenerError) { /* listener bugs must not break the bridge */ }
    });
  }
  window.__tiktools_broker_push__ = function (envelope) {
    if (disposed || !envelope || envelope.apiVersion !== 1) return;
    if (envelope.method === 'event' && envelope.params && typeof envelope.params.topic === 'string') {
      fire(envelope.params.topic, envelope.params.data);
      return;
    }
    if (typeof envelope.event === 'string') {
      fire(envelope.event, envelope.data);
      return;
    }
    if (typeof envelope.id !== 'string') return;
    var entry = pending.get(envelope.id);
    if (!entry) return;
    pending.delete(envelope.id);
    clearTimeout(entry.timer);
    if (envelope.ok === true) entry.resolve(envelope.result);
    else entry.reject(new Error(typeof envelope.error === 'string' ? envelope.error : 'broker error'));
  };
  function call(method, params) {
    if (disposed) return Promise.reject(new Error('plugin host was closed'));
    if (pending.size >= 128) return Promise.reject(new Error('plugin broker request limit reached'));
    sequence += 1;
    var id = 'plg-' + instanceId + '-' + sequence;
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        pending.delete(id);
        reject(new Error('plugin broker request timed out'));
      }, 30000);
      pending.set(id, { resolve: resolve, reject: reject, timer: timer });
      try {
        ipc.postMessage(JSON.stringify({ apiVersion: 1, id: id, method: method, params: params || {} }));
      } catch (error) {
        pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  }
  window.tiktools = {
    settings: {
      get: function () { return call('settings.get', {}); },
      set: function (values) { return call('settings.set', { values: values || {} }); }
    },
    actions: {
      execute: function (action, config) { return call('actions.execute', { action: action, config: config || {} }); }
    },
    options: {
      get: function (source, refresh) { return call('options.get', { source: source, refresh: refresh === true }); }
    },
    events: {
      subscribe: function (topics, listener) {
        if (disposed) throw new Error('plugin host was closed');
        var names = Array.isArray(topics) ? topics : [topics];
        if (typeof listener !== 'function' || names.length < 1 || names.length > 32 || names.some(function (topic) { return typeof topic !== 'string' || topic.length > 128 || topic.indexOf('plugin.') !== 0; })) throw new Error('invalid plugin event subscription');
        var allTopics = new Set(Array.from(listeners.keys()).concat(names));
        if (allTopics.size > 32 || listenerCount + names.length > 128) throw new Error('plugin event listener limit reached');
        names.forEach(function (topic) {
          if (!listeners.has(topic)) listeners.set(topic, []);
          listeners.get(topic).push(listener);
          listenerCount += 1;
        });
        var removed = false;
        function unsubscribe() {
          if (removed) return;
          removed = true;
          names.forEach(function (topic) {
            var watchers = listeners.get(topic);
            if (!watchers) return;
            var index = watchers.indexOf(listener);
            if (index >= 0) { watchers.splice(index, 1); listenerCount -= 1; }
            if (watchers.length === 0) {
              listeners.delete(topic);
              if (!disposed) call('events.unsubscribe', { topics: [topic] }).catch(function () {});
            }
          });
        }
        call('events.subscribe', { topics: names }).catch(unsubscribe);
        return unsubscribe;
      }
    },
    host: {
      locale: function () { return call('host.locale', {}); },
      theme: function () { return call('host.theme', {}); }
    }
  };
})();"#;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn aggregate_subscription_limit_is_atomic_across_requests() {
        let mut topics = HashSet::new();
        apply_topics(
            &mut topics,
            crate::event::PluginUiSubscription::Subscribe(
                (0..32).map(|n| format!("plugin.{n}")).collect(),
            ),
        )
        .unwrap();
        assert!(apply_topics(
            &mut topics,
            crate::event::PluginUiSubscription::Subscribe(vec!["plugin.more".to_owned()])
        )
        .is_err());
        assert_eq!(topics.len(), 32);
        apply_topics(
            &mut topics,
            crate::event::PluginUiSubscription::Unsubscribe(vec!["plugin.0".to_owned()]),
        )
        .unwrap();
        apply_topics(
            &mut topics,
            crate::event::PluginUiSubscription::Subscribe(vec!["plugin.more".to_owned()]),
        )
        .unwrap();
        assert_eq!(topics.len(), 32);
    }
    #[test]
    fn deferred_close_is_fenced_even_if_a_native_window_id_is_reused() {
        let id = WindowId::from(1);
        assert!(close_owner_matches(Some(id), Some(5), id, 5));
        assert!(!close_owner_matches(Some(id), Some(5), id, 6));
        assert!(close_owner_matches(None, None, id, 6));
    }

    #[test]
    fn ui_ids_follow_the_identifier_rule() {
        assert!(is_valid_ui_id("sonicboom.server"));
        assert!(is_valid_ui_id("plugin-a_b.c"));
        assert!(!is_valid_ui_id(""));
        assert!(!is_valid_ui_id("9lives"));
        assert!(!is_valid_ui_id("../escape"));
        assert!(!is_valid_ui_id("has space"));
        assert!(!is_valid_ui_id(&"x".repeat(129)));
    }

    #[test]
    fn host_notifications_route_by_plugin_topic() {
        let message = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "event",
            "params": {
                "topic": "plugin.event",
                "data": { "pluginId": "owner", "eventType": "speech.state", "event": {} },
            },
        })
        .to_string();
        let (plugin_id, topic, data) = parse_host_notification(&message).expect("routes");
        assert_eq!(plugin_id, "owner");
        assert_eq!(topic, "plugin.event");
        assert_eq!(data["eventType"], "speech.state");

        // Non-plugin topics never reach plugin windows.
        let other = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "event",
            "params": { "topic": "live.event", "data": { "pluginId": "owner" } },
        })
        .to_string();
        assert!(parse_host_notification(&other).is_none());
        // RPC responses and malformed input are ignored.
        assert!(parse_host_notification(r#"{"type":"rpc-response"}"#).is_none());
        assert!(parse_host_notification("not json").is_none());
    }

    #[test]
    fn teardown_topics_close_windows_without_affecting_delivery() {
        assert!(is_teardown_topic("plugin.uninstalled"));
        assert!(is_teardown_topic("plugin.stopped"));
        assert!(!is_teardown_topic("plugin.started"));
        assert!(!is_teardown_topic("plugin.event"));
        assert!(!is_teardown_topic("plugin.settings-changed"));
        // Forwarding without windows is a no-op, never a panic.
        let mut windows = PluginUiWindows::default();
        windows.forward_host_message(
            &serde_json::json!({
                "jsonrpc": "2.0",
                "method": "event",
                "params": {
                    "topic": "plugin.uninstalled",
                    "data": {"pluginId": "gone.plugin"},
                },
            })
            .to_string(),
        );
    }

    #[test]
    fn init_script_forwards_refresh_and_devtools_shortcuts() {
        // F5 / Ctrl+R reload in-page; F12 / Ctrl+Shift+I ask the host to
        // open devtools. The reload path needs no transport; the devtools
        // path reuses the captured `ipc` handle so the broker allowlist is
        // never involved.
        assert!(INIT_SCRIPT.contains("F5"));
        assert!(INIT_SCRIPT.contains("F12"));
        assert!(INIT_SCRIPT.contains("location.reload"));
        assert!(INIT_SCRIPT.contains("open-devtools"));
    }

    #[test]
    fn init_script_installs_the_narrow_surface_only() {
        // The transport is read but never deleted or overwritten: on
        // WebKitGTK `window.ipc` is a non-configurable property installed
        // before init scripts, so touching it throws in strict mode and
        // aborts the whole script (leaving `window.tiktools` missing).
        assert!(!INIT_SCRIPT.contains("delete window.ipc"));
        assert!(!INIT_SCRIPT.contains("window.ipc = "));
        assert!(!INIT_SCRIPT.contains("window.ipc= "));
        assert!(INIT_SCRIPT.contains("window.ipc && typeof window.ipc.postMessage"));
        assert!(INIT_SCRIPT.contains("window.tiktools = {"));
        assert!(INIT_SCRIPT.contains("apiVersion: 1"));
        assert!(INIT_SCRIPT.contains("__tiktools_broker_push__"));
        // Transport diagnostics for native debugging (see also the Rust
        // `transport = "native"` open log and broker rejection logs).
        assert!(INIT_SCRIPT.contains("__tiktools_transport__"));
        assert!(INIT_SCRIPT.contains("'native'"));
        assert!(INIT_SCRIPT.contains("'unavailable'"));
    }

    #[test]
    fn teardown_plan_destroys_the_child_before_the_parent() {
        // Pure pin of the destruction order: the child WebView dies
        // first, the display sync flushes its destroy, and only then is
        // the parent window handle destroyed. This orders the Rust calls;
        // it cannot prove the X11/GTK behavior, which the native smoke
        // test (`smoke::native_open_close_cycles`) exercises for real.
        assert_eq!(
            teardown_plan(false),
            [
                TeardownStep::DropWebView,
                TeardownStep::SyncDisplay,
                TeardownStep::DropWindow,
            ]
        );
        // A server-destroyed parent is forgotten, never destroyed twice —
        // but the WebView still drops first with the same sync.
        assert_eq!(
            teardown_plan(true),
            [
                TeardownStep::DropWebView,
                TeardownStep::SyncDisplay,
                TeardownStep::ForgetWindow,
            ]
        );
    }

    #[test]
    fn close_requests_queue_exactly_one_teardown() {
        let mut state = PluginWindowState::Open;
        assert!(state.begin_close());
        assert_eq!(state, PluginWindowState::Closing);
        // A duplicate request while closing queues nothing.
        assert!(!state.begin_close());
        assert_eq!(state, PluginWindowState::Closing);
    }

    #[test]
    fn manager_close_paths_are_harmless_without_windows() {
        let mut windows = PluginUiWindows::default();
        // Double closes, missing windows, and late broker traffic never
        // panic, recreate entries, or evaluate script anywhere.
        windows.close("ghost.plugin", "main");
        windows.close("ghost.plugin", "main");
        windows.close_plugin("ghost.plugin");
        windows.close_plugin("ghost.plugin");
        windows.respond(
            "ghost.plugin",
            "main",
            r#"{"ok":true}"#.into(),
            WindowId::from(0),
            0,
            None,
        );
        windows.apply_subscription(
            "ghost.plugin",
            "main",
            crate::event::PluginUiSubscription::Subscribe(vec!["plugin.event".to_owned()]),
            WindowId::from(0),
            0,
        );
        windows.deliver_event("ghost.plugin", "plugin.event", &Value::Null);
        windows.forward_host_message(
            &serde_json::json!({
                "jsonrpc": "2.0",
                "method": "event",
                "params": {
                    "topic": "plugin.stopped",
                    "data": {"pluginId": "ghost.plugin"},
                },
            })
            .to_string(),
        );
        assert!(windows.windows.is_empty());
    }
}
