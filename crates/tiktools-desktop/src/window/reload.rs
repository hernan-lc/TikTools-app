//! Explicit WebView lifecycle and bounded reload recovery.
//!
//! Linux/WebKitGTK reloads (DevTools refresh, programmatic reload, dev
//! server vs. packaged `tiktools://` origins) previously left the desktop
//! shell with only an implicit `page_ready` bit: a new document could
//! receive the previous document's batches, a missing `frontend-ready`
//! never timed out after startup, and a failed transport reloaded without
//! bound. This module pins the required lifecycle as pure, headless
//! state machines so regression tests exercise it without a display:
//!
//! * [`WebviewLifecycle`]: `Loading`, `Ready`, `Failed`, `Recovering`.
//! * [`MainReloadSupervisor`]: Started invalidates the previous document,
//!   Ready validates the generation before restoring delivery, timeouts
//!   record a reason and allow exactly one controlled navigation recovery
//!   plus one WebView recreate before parking in `Failed`.
//! * [`PluginPageSupervisor`]: same bound for pop-out windows plus a
//!   post-navigation bridge readiness check (`window.tiktools`).
//!
//! Recovery never replays RPCs and never restarts the native [`AppCore`]:
//! it clears the previous document's outbox and requires the fresh page
//! to resynchronize through its mount reads. Navigation security is
//! unchanged (see `allows_navigation` callers): recovery only reloads or
//! recreates the already-allowed URL.

use std::time::{Duration, Instant};

/// Explicit lifecycle for the main WebView and for each plugin window.
///
/// `Loading` covers initial load and every subsequent navigation until
/// the fresh document handshakes. `Recovering` is `Loading` after at
/// least one automatic recovery attempt, kept distinct so diagnostics
/// tell a first load from a reload loop.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WebviewLifecycle {
    Loading,
    Ready,
    Failed,
    Recovering,
}

/// What the supervisor wants the UI thread to do after a timeout.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecoveryDecision {
    /// Still inside the watchdog budget: keep waiting.
    Wait,
    /// First timeout: one controlled `WebView::reload()`.
    ReloadOnce,
    /// Reload did not help: drop and rebuild the WebView on the UI thread.
    Recreate,
    /// Budget exhausted: park in `Failed`, stop retrying, surface health.
    GiveUp,
}

/// Bounded watchdog for one navigation. The same budget applies to the
/// first load, DevTools refreshes, programmatic reloads, dev-server URLs
/// and the packaged custom protocol: the transport is identical once the
/// document is gone.
pub const RELOAD_TIMEOUT: Duration = Duration::from_secs(10);

/// Exactly one controlled navigation recovery before recreating.
pub const MAX_NAVIGATION_RECOVERIES: u32 = 1;
/// Exactly one WebView recreate before parking in `Failed`.
pub const MAX_WEBVIEW_RECREATES: u32 = 1;

/// Failure reasons recorded for diagnostics (never user data).
pub mod failure_reasons {
    pub const RELOAD_TIMEOUT: &str =
        "reload timeout: no frontend-ready before the watchdog deadline";
    pub const BATCH_TIMEOUT: &str = "batch acknowledgment deadline exceeded";
    pub const EVALUATION_FAILED: &str = "script evaluation failed";
    pub const MISSING_BRIDGE: &str = "missing IPC bridge: frontend-ready never arrived";
    pub const INIT_SCRIPT_MISSING: &str = "missing IPC bridge: initialization script unavailable";
}

/// Pure supervisor for the main WebView. All time comes in as `now` so
/// tests drive it without sleeping.
#[derive(Debug)]
pub struct MainReloadSupervisor {
    state: WebviewLifecycle,
    reload_deadline: Option<Instant>,
    failure_reason: Option<&'static str>,
    navigation_recoveries: u32,
    recreates: u32,
}

impl MainReloadSupervisor {
    pub fn new() -> Self {
        Self {
            state: WebviewLifecycle::Loading,
            reload_deadline: None,
            failure_reason: None,
            navigation_recoveries: 0,
            recreates: 0,
        }
    }

    /// Navigation Started: advance to `Loading`, invalidate the previous
    /// document's delivery, and (re)start the bounded watchdog. Returns
    /// the new deadline for the caller to store alongside its outbox.
    pub fn on_navigation_started(&mut self, now: Instant) -> Instant {
        // A fresh navigation supersedes any recorded failure: the user or
        // the page asked for a new document, so the old reason must not
        // pin the new load in `Failed`.
        self.failure_reason = None;
        self.state = WebviewLifecycle::Loading;
        let deadline = now + RELOAD_TIMEOUT;
        self.reload_deadline = Some(deadline);
        deadline
    }

    /// Frontend-ready: accept only the current generation. A stale Ready
    /// from the previous document must never restore delivery.
    pub fn on_frontend_ready(&mut self, generation: u64, expected: u64) -> bool {
        if generation != expected {
            return false;
        }
        self.state = WebviewLifecycle::Ready;
        self.reload_deadline = None;
        self.failure_reason = None;
        self.navigation_recoveries = 0;
        self.recreates = 0;
        true
    }

    pub fn record_failure(&mut self, reason: &'static str) {
        self.state = WebviewLifecycle::Failed;
        self.failure_reason = Some(reason);
        self.reload_deadline = None;
    }

    /// Watchdog poll on the UI thread. Returns what the caller should do
    /// next; the caller performs the reload/recreate so this type never
    /// touches Wry and `AppCore` is never restarted.
    pub fn check_timeout(&mut self, now: Instant) -> RecoveryDecision {
        match self.state {
            WebviewLifecycle::Ready | WebviewLifecycle::Failed => return RecoveryDecision::Wait,
            WebviewLifecycle::Loading | WebviewLifecycle::Recovering => {}
        }
        let Some(deadline) = self.reload_deadline else {
            return RecoveryDecision::Wait;
        };
        if now < deadline {
            return RecoveryDecision::Wait;
        }
        if self.navigation_recoveries < MAX_NAVIGATION_RECOVERIES {
            self.navigation_recoveries += 1;
            self.state = WebviewLifecycle::Recovering;
            self.failure_reason = Some(failure_reasons::RELOAD_TIMEOUT);
            self.reload_deadline = Some(now + RELOAD_TIMEOUT);
            return RecoveryDecision::ReloadOnce;
        }
        if self.recreates < MAX_WEBVIEW_RECREATES {
            self.recreates += 1;
            self.state = WebviewLifecycle::Recovering;
            self.failure_reason = Some(failure_reasons::RELOAD_TIMEOUT);
            self.reload_deadline = Some(now + RELOAD_TIMEOUT);
            return RecoveryDecision::Recreate;
        }
        self.state = WebviewLifecycle::Failed;
        self.failure_reason = Some(failure_reasons::RELOAD_TIMEOUT);
        self.reload_deadline = None;
        RecoveryDecision::GiveUp
    }

    /// Normal IPC delivery is allowed only in `Ready`. Every other state
    /// must hold batches for the fresh document instead of evaluating
    /// script into the previous (or a dead) page.
    pub fn is_delivery_allowed(&self) -> bool {
        self.state == WebviewLifecycle::Ready
    }

    pub fn state(&self) -> WebviewLifecycle {
        self.state
    }

    pub fn failure_reason(&self) -> Option<&'static str> {
        self.failure_reason
    }

    pub fn recovery_counts(&self) -> (u32, u32) {
        (self.navigation_recoveries, self.recreates)
    }
}

impl Default for MainReloadSupervisor {
    fn default() -> Self {
        Self::new()
    }
}

/// Post-navigation bridge state for one plugin window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PluginBridgeState {
    /// Navigation started, waiting for the first broker message.
    Waiting,
    /// At least one broker message round-tripped on this generation.
    Ready,
    /// No broker traffic before the watchdog: the init script or the
    /// transport is missing.
    Missing,
}

/// Pure supervisor for one plugin pop-out window. Subscriptions reset on
/// every navigation (the previous page's topics must never leak into the
/// fresh document); recovery is bounded the same way as the main page.
#[derive(Debug)]
pub struct PluginPageSupervisor {
    state: WebviewLifecycle,
    bridge: PluginBridgeState,
    reload_deadline: Option<Instant>,
    failure_reason: Option<&'static str>,
    navigation_recoveries: u32,
    recreates: u32,
}

impl PluginPageSupervisor {
    pub fn new(now: Instant) -> Self {
        Self {
            state: WebviewLifecycle::Loading,
            bridge: PluginBridgeState::Waiting,
            reload_deadline: Some(now + RELOAD_TIMEOUT),
            failure_reason: None,
            navigation_recoveries: 0,
            recreates: 0,
        }
    }

    /// Navigation Started for the plugin window: reset subscriptions for
    /// the previous page (the caller clears topics/output), mark the
    /// bridge as waiting, and restart the watchdog.
    pub fn on_navigation_started(&mut self, now: Instant) -> Instant {
        self.failure_reason = None;
        self.state = WebviewLifecycle::Loading;
        self.bridge = PluginBridgeState::Waiting;
        let deadline = now + RELOAD_TIMEOUT;
        self.reload_deadline = Some(deadline);
        deadline
    }

    /// First broker round-trip on the current generation proves the
    /// initialization script installed `window.tiktools`.
    pub fn on_bridge_message(&mut self) {
        self.bridge = PluginBridgeState::Ready;
        // A live bridge implies a live page: a window stuck in Loading
        // with working IPC has finished loading even if the Finished
        // event was missed on some backend.
        if self.state == WebviewLifecycle::Loading {
            self.state = WebviewLifecycle::Ready;
            self.reload_deadline = None;
            self.failure_reason = None;
            self.navigation_recoveries = 0;
            self.recreates = 0;
        }
    }

    pub fn check_timeout(&mut self, now: Instant) -> RecoveryDecision {
        match self.state {
            WebviewLifecycle::Ready | WebviewLifecycle::Failed => return RecoveryDecision::Wait,
            WebviewLifecycle::Loading | WebviewLifecycle::Recovering => {}
        }
        let Some(deadline) = self.reload_deadline else {
            return RecoveryDecision::Wait;
        };
        if now < deadline {
            return RecoveryDecision::Wait;
        }
        // A timeout with no broker traffic at all reports the missing IPC
        // bridge explicitly; a timeout after bridge traffic reports the
        // reload timeout. Both paths stay bounded below.
        let missing_bridge = self.bridge == PluginBridgeState::Waiting;
        if missing_bridge {
            self.bridge = PluginBridgeState::Missing;
        }
        let reason = if missing_bridge {
            failure_reasons::MISSING_BRIDGE
        } else {
            failure_reasons::RELOAD_TIMEOUT
        };
        if self.navigation_recoveries < MAX_NAVIGATION_RECOVERIES {
            self.navigation_recoveries += 1;
            self.state = WebviewLifecycle::Recovering;
            self.failure_reason = Some(reason);
            self.reload_deadline = Some(now + RELOAD_TIMEOUT);
            return RecoveryDecision::ReloadOnce;
        }
        if self.recreates < MAX_WEBVIEW_RECREATES {
            self.recreates += 1;
            self.state = WebviewLifecycle::Recovering;
            self.failure_reason = Some(reason);
            self.reload_deadline = Some(now + RELOAD_TIMEOUT);
            return RecoveryDecision::Recreate;
        }
        self.state = WebviewLifecycle::Failed;
        self.failure_reason = Some(reason);
        self.reload_deadline = None;
        RecoveryDecision::GiveUp
    }

    pub fn is_delivery_allowed(&self) -> bool {
        self.state == WebviewLifecycle::Ready && self.bridge == PluginBridgeState::Ready
    }

    pub fn state(&self) -> WebviewLifecycle {
        self.state
    }

    pub fn bridge(&self) -> PluginBridgeState {
        self.bridge
    }

    pub fn failure_reason(&self) -> Option<&'static str> {
        self.failure_reason
    }
}

/// Methods that only read authoritative state and are therefore safe to
/// re-issue after a reload. Everything else is non-idempotent: recovery
/// clears pending calls and requires the fresh page to resynchronize
/// through its mount reads instead of replaying them.
pub fn is_idempotent_rpc_method(method: &str) -> bool {
    matches!(
        method,
        "system.health"
            | "system.capabilities"
            | "rpc.list"
            | "rpc.describe"
            | "host.locale"
            | "host.theme"
            | "ui.projection"
    )
}

#[cfg(test)]
#[path = "reload_tests.rs"]
mod tests;
