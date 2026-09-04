//! TikTools application core.
//!
//! This crate owns domain orchestration and the host-side message contract. It
//! intentionally has no dependency on Winit, Wry, tray-icon, or any other GUI
//! implementation. The desktop crate supplies a `HostEmitter` and forwards
//! UI work to this crate from its Tokio runtime.

pub mod db;
pub mod events;
pub mod ipc;
pub mod paths;
pub mod services;

use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, RwLock,
    },
    time::{SystemTime, UNIX_EPOCH},
};

#[cfg(feature = "native-tiktok")]
use std::{sync::atomic::AtomicBool, time::Duration};

use serde_json::{json, Value};
use tiktools_plugin_loader::{plugin_roots, PluginManager};

#[cfg(feature = "native-tiktok")]
use tiktools_tiktok::{events::LiveEvent as NativeLiveEvent, ClientEvent, ConnectRequest};

#[cfg(not(feature = "native-tiktok"))]
#[derive(Debug)]
#[allow(dead_code)]
struct ConnectRequest {
    unique_id: String,
    session_cookie: String,
    room_id: Option<String>,
}

use crate::{
    events::{AppEvent, EventBus},
    ipc::messages::{HostMessage, PageMessage},
    paths::AppPaths,
    services::{
        builtin_action_types, builtin_node_catalog, builtin_translations, AppStateService,
        AutomationService, AwardOptions, CapabilityBroker, LiveService, PointAction, PointsService,
    },
};

pub trait HostEmitter: Send + Sync {
    fn emit(&self, message: HostMessage);
}

/// The Rust application service graph. Each subsystem has separate ownership
/// so a future database/live/plugin implementation can be tested in isolation.
pub struct AppCore {
    pub live: Arc<LiveService>,
    pub points: Arc<PointsService>,
    pub automation: Arc<AutomationService>,
    pub capabilities: Arc<CapabilityBroker>,
    pub plugins: Arc<PluginManager>,
    pub db: Arc<db::DatabaseManager>,
    pub app_state: Arc<AppStateService>,
    pub events: EventBus,
    emitter: Arc<dyn HostEmitter>,
    last_automation_event: RwLock<Option<serde_json::Value>>,
    last_automation_event_at: RwLock<Option<u64>>,
    automation_sequence: AtomicU64,
    #[cfg(feature = "http")]
    http_client: reqwest::Client,
    #[cfg(feature = "native-tiktok")]
    connection_sequence: AtomicU64,
    connection_context: RwLock<Option<LiveContext>>,
    #[cfg(feature = "native-tiktok")]
    live_pump_started: AtomicBool,
}

impl AppCore {
    pub fn new(emitter: Arc<dyn HostEmitter>) -> Self {
        let paths = AppPaths::from_environment();
        if let Err(error) = paths.ensure_directories() {
            tracing::warn!(%error, "could not create all Rust host directories");
        }

        let roots = plugin_roots(
            paths.builtin_plugins.clone(),
            paths.plugins.clone(),
            paths.development_plugins.clone(),
        );
        let plugins = Arc::new(PluginManager::new(roots));
        match plugins.scan() {
            Ok(entries) => tracing::info!(count = entries.len(), "runtime plugin scan complete"),
            Err(error) => tracing::warn!(%error, "runtime plugin scan failed"),
        }

        let db = Arc::new(db::DatabaseManager::new(paths));
        let capabilities = Arc::new(CapabilityBroker::new(db.paths().plugin_data.clone()));

        let live = {
            #[cfg(feature = "native-tiktok")]
            {
                let mut config = tiktools_tiktok::NativeTikTokConfig::default();
                config.bundle_cache_path = Some(db.paths().data.join("webmssdk.js"));
                LiveService::with_native_config(config)
            }
            #[cfg(not(feature = "native-tiktok"))]
            {
                LiveService::new()
            }
        };

        let automation = Arc::new(AutomationService::default());
        #[cfg(feature = "persistence")]
        if let Ok(snapshot) = db.load_behavior_snapshot() {
            automation.replace_snapshot(&snapshot);
        }
        #[cfg(feature = "http")]
        let http_client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap_or_else(|error| {
                tracing::warn!(%error, "could not configure HTTP client without redirects");
                reqwest::Client::new()
            });

        Self {
            live: Arc::new(live),
            points: Arc::new(PointsService::new(db.clone())),
            automation,
            capabilities,
            plugins,
            db,
            app_state: Arc::new(AppStateService::default()),
            events: EventBus::new(256),
            emitter,
            last_automation_event: RwLock::new(None),
            last_automation_event_at: RwLock::new(None),
            automation_sequence: AtomicU64::new(0),
            #[cfg(feature = "http")]
            http_client,
            #[cfg(feature = "native-tiktok")]
            connection_sequence: AtomicU64::new(0),
            connection_context: RwLock::new(None),
            #[cfg(feature = "native-tiktok")]
            live_pump_started: AtomicBool::new(false),
        }
    }

    pub fn emit(&self, message: HostMessage) {
        self.emitter.emit(message);
    }

    #[cfg(feature = "plugin-install")]
    pub fn install_plugin(
        &self,
        archive: impl AsRef<std::path::Path>,
        replace_existing: bool,
    ) -> Result<
        tiktools_plugin_loader::InstalledPluginPackage,
        tiktools_plugin_loader::PluginLoaderError,
    > {
        let paths = self.db.paths();
        let installer = tiktools_plugin_loader::PluginInstaller {
            plugin_directory: paths.plugins.clone(),
            staging_directory: paths.temp.join("plugin-install"),
            replace_existing,
        };
        let installed = installer.install(archive)?;
        self.plugins.scan().map(|_| ())?;
        Ok(installed)
    }

    pub async fn handle_page_message(self: &Arc<Self>, message: PageMessage) {
        self.events.publish(AppEvent::Ui(message.clone()));
        match message {
            PageMessage::Disconnect => {
                self.publish_disconnected_event().await;
                self.live.disconnect().await;
                self.emit(HostMessage::connection_disconnected());
            }
            PageMessage::Connect {
                unique_id,
                session_cookie,
                room_id,
            } => {
                self.start_live_event_pump();
                self.connect_native(ConnectRequest {
                    unique_id,
                    session_cookie,
                    room_id,
                })
                .await;
            }
            PageMessage::PickLive { session_cookie } => {
                self.start_live_event_pump();
                self.pick_live(&session_cookie).await;
            }
            PageMessage::GetPointsConfig => {
                self.emit(HostMessage::PointsConfig {
                    config: self.points.config(),
                });
            }
            PageMessage::UpdatePointsConfig { config } => {
                self.emit(HostMessage::PointsConfig {
                    config: self.points.update_config(config),
                });
            }
            PageMessage::GetLeaderboard { limit } => {
                self.emit(HostMessage::Leaderboard {
                    viewers: self.points.leaderboard(limit),
                });
            }
            PageMessage::ResetPoints { unique_id } => {
                self.points.reset(unique_id.as_deref());
                self.emit(HostMessage::Leaderboard {
                    viewers: self.points.leaderboard(Some(100)),
                });
            }
            PageMessage::AdjustPoints { unique_id, delta } => {
                if let Some(award) = self.points.award_points(
                    &unique_id,
                    PointAction::Manual,
                    AwardOptions {
                        custom_amount: Some(delta),
                        ..AwardOptions::default()
                    },
                ) {
                    self.emit(HostMessage::PointsAwarded {
                        unique_id: award.unique_id,
                        delta: award.delta,
                        total_points: award.total_points,
                        level: award.level,
                    });
                }
                self.emit(HostMessage::Leaderboard {
                    viewers: self.points.leaderboard(Some(100)),
                });
            }
            PageMessage::GetCreator { unique_id } => {
                #[cfg(feature = "persistence")]
                let creator = match self.db.load_creator(unique_id.as_deref()) {
                    Ok(creator) => creator,
                    Err(error) => {
                        tracing::warn!(%error, "could not load creator state");
                        None
                    }
                };
                #[cfg(not(feature = "persistence"))]
                let creator = {
                    let _ = unique_id;
                    None
                };
                self.emit(HostMessage::CreatorState { creator });
            }
            PageMessage::GetRecentCreators { limit } => {
                #[cfg(feature = "persistence")]
                let creators = match self
                    .db
                    .load_recent_creators(limit.unwrap_or(10).clamp(0, 1000))
                {
                    Ok(creators) => creators,
                    Err(error) => {
                        tracing::warn!(%error, "could not load creator history");
                        Vec::new()
                    }
                };
                #[cfg(not(feature = "persistence"))]
                let creators = {
                    let _ = limit;
                    Vec::new()
                };
                self.emit(HostMessage::RecentCreators { creators });
            }
            PageMessage::GetAppState { keys } => {
                let state = self.app_state.read(keys.as_deref());
                #[cfg(feature = "persistence")]
                let state = {
                    let mut state = state;
                    match self.db.load_app_state() {
                        Ok(persisted) => {
                            state = persisted
                                .into_iter()
                                .filter_map(|(key, value)| {
                                    value.as_str().map(|value| (key, value.to_owned()))
                                })
                                .filter(|(key, _)| {
                                    keys.as_ref()
                                        .is_none_or(|keys| keys.is_empty() || keys.contains(key))
                                })
                                .collect();
                        }
                        Err(error) => tracing::warn!(%error, "could not load app state"),
                    }
                    state
                };
                self.emit(HostMessage::AppState { state });
            }
            PageMessage::SetAppState { key, value } => {
                self.app_state.set(key.clone(), value.clone());
                #[cfg(feature = "persistence")]
                if let Err(error) = self.db.save_app_state(&key, &value) {
                    tracing::warn!(%error, "could not persist app state");
                }
                self.emit(HostMessage::AppState {
                    state: [(key, value)].into_iter().collect(),
                });
            }
            PageMessage::ClearCreatorHistory => {
                #[cfg(feature = "persistence")]
                if let Err(error) = self.db.clear_creator_history() {
                    tracing::warn!(%error, "could not clear creator history");
                }
                self.emit(HostMessage::RecentCreators {
                    creators: Vec::new(),
                });
                self.emit(HostMessage::CreatorState { creator: None });
            }
            PageMessage::DebugGift { gift_id } => {
                self.emit(HostMessage::GiftDebug {
                    gift_id,
                    icon_url: None,
                    has_icon: false,
                    total_gifts: 0,
                });
            }
            PageMessage::GetAutomationWorkflows => {
                self.emit_persisted_workflows();
            }
            PageMessage::GetAutomationNodes => {
                self.emit(HostMessage::AutomationNodeCatalog {
                    nodes: builtin_node_catalog(),
                });
            }
            PageMessage::GetAutomationContext => {
                let event = self
                    .last_automation_event
                    .read()
                    .expect("automation event lock poisoned")
                    .clone();
                let captured_at = *self
                    .last_automation_event_at
                    .read()
                    .expect("automation timestamp lock poisoned");
                self.emit(HostMessage::AutomationContext { event, captured_at });
            }
            PageMessage::SaveAutomationWorkflow { graph } => {
                #[cfg(feature = "persistence")]
                {
                    if let Err(error) = self.db.save_workflow(&graph) {
                        self.emit(HostMessage::AutomationError {
                            message: error.to_string(),
                        });
                    } else {
                        self.emit_persisted_workflows();
                    }
                }
                #[cfg(not(feature = "persistence"))]
                {
                    let _ = graph;
                    self.emit(HostMessage::AutomationError {
                        message: "Rust persistence is disabled in this build.".to_owned(),
                    });
                }
            }
            PageMessage::DeleteAutomationWorkflow { id } => {
                #[cfg(feature = "persistence")]
                if let Err(error) = self.db.delete_workflow(&id) {
                    self.emit(HostMessage::AutomationError {
                        message: error.to_string(),
                    });
                }
                #[cfg(not(feature = "persistence"))]
                let _ = id;
                self.emit_persisted_workflows();
            }
            PageMessage::SetAutomationWorkflowEnabled { id, enabled } => {
                #[cfg(feature = "persistence")]
                if let Err(error) = self.db.set_workflow_enabled(&id, enabled) {
                    self.emit(HostMessage::AutomationError {
                        message: error.to_string(),
                    });
                }
                #[cfg(not(feature = "persistence"))]
                {
                    let _ = (id, enabled);
                    self.emit(HostMessage::AutomationError {
                        message: "Rust persistence is disabled in this build.".to_owned(),
                    });
                }
                self.emit_persisted_workflows();
            }
            PageMessage::GetGiftCatalog => {
                self.emit_persisted_gifts();
            }
            PageMessage::GetBehavior => {
                self.emit_persisted_behavior();
                self.emit(HostMessage::BehaviorRuns {
                    runs: self.automation.recent_runs(),
                });
            }
            PageMessage::SaveAction { action } => {
                self.save_behavior_record("behavior_actions", action);
            }
            PageMessage::DeleteAction { id } => {
                self.delete_behavior_record("behavior_actions", &id);
            }
            PageMessage::SetActionEnabled { id, enabled } => {
                self.set_behavior_enabled("behavior_actions", &id, enabled);
            }
            PageMessage::SaveEvent { event } => {
                self.save_behavior_record("behavior_events", event);
            }
            PageMessage::DeleteEvent { id } => {
                self.delete_behavior_record("behavior_events", &id);
            }
            PageMessage::SetEventEnabled { id, enabled } => {
                self.set_behavior_enabled("behavior_events", &id, enabled);
            }
            PageMessage::SetPluginInstall { id, installed } => {
                let state_updated = {
                    #[cfg(feature = "persistence")]
                    {
                        if let Err(error) = self.db.set_plugin_state(&id, installed, true) {
                            self.emit(HostMessage::AutomationError {
                                message: error.to_string(),
                            });
                            false
                        } else {
                            true
                        }
                    }
                    #[cfg(not(feature = "persistence"))]
                    {
                        let _ = installed;
                        self.emit(HostMessage::AutomationError {
                            message: "Rust persistence is disabled in this build.".to_owned(),
                        });
                        false
                    }
                };
                if state_updated && !installed {
                    if let Err(error) = self.plugins.stop(&id) {
                        tracing::debug!(plugin = %id, %error, "plugin was not running during uninstall");
                    }
                }
                self.emit_persisted_behavior();
            }
            PageMessage::SetPluginEnabled { id, enabled } => {
                let state_updated = {
                    #[cfg(feature = "persistence")]
                    {
                        if let Err(error) = self.db.set_plugin_state(&id, true, enabled) {
                            self.emit(HostMessage::AutomationError {
                                message: error.to_string(),
                            });
                            false
                        } else {
                            true
                        }
                    }
                    #[cfg(not(feature = "persistence"))]
                    {
                        let _ = enabled;
                        self.emit(HostMessage::AutomationError {
                            message: "Rust persistence is disabled in this build.".to_owned(),
                        });
                        false
                    }
                };
                if state_updated {
                    let result = if enabled {
                        self.plugins.start(&id)
                    } else {
                        self.plugins.stop(&id)
                    };
                    if let Err(error) = result {
                        self.emit(HostMessage::BehaviorError {
                            message: error.to_string(),
                        });
                    }
                }
                self.emit_persisted_behavior();
            }
            PageMessage::GetActionOptions { source } => {
                self.emit(HostMessage::ActionOptions {
                    source,
                    options: Vec::new(),
                });
            }
            PageMessage::GetPluginSettings { id } => {
                self.emit_plugin_settings(&id);
            }
            PageMessage::SavePluginSettings { id, values } => {
                self.save_plugin_settings(&id, values);
            }
            PageMessage::AnalyzeAutomationScript {
                node_id,
                source,
                offset: _,
                event_type: _,
            } => {
                let diagnostics = self
                    .automation
                    .validate_script(&source)
                    .err()
                    .map(|message| {
                        vec![json!({
                            "line": 1,
                            "column": 1,
                            "message": message,
                            "severity": "error"
                        })]
                    })
                    .unwrap_or_default();
                self.emit(HostMessage::AutomationScriptAnalysis {
                    analysis: json!({
                        "nodeId": node_id,
                        "source": source,
                        "diagnostics": diagnostics,
                        "completions": [],
                        "hover": null
                    }),
                });
            }
            PageMessage::TestAction { action, trigger } => {
                self.emit(HostMessage::BehaviorTestResult {
                    runs: vec![self.test_action(&action, trigger.as_deref()).await],
                });
            }
            PageMessage::TestEvent { event } => {
                self.emit(HostMessage::BehaviorTestResult {
                    runs: vec![self.test_event(&event).await],
                });
            }
        }
    }

    #[cfg(feature = "native-tiktok")]
    fn start_live_event_pump(self: &Arc<Self>) {
        if self.live_pump_started.swap(true, Ordering::AcqRel) {
            return;
        }
        let mut receiver = self.live.subscribe();
        let core = Arc::clone(self);
        tracing::info!("native TikTok event pump started");
        tokio::spawn(async move {
            loop {
                match receiver.recv().await {
                    Ok(event) => {
                        tracing::debug!(
                            kind = client_event_kind(&event),
                            "native TikTok event received"
                        );
                        core.handle_native_event(event).await;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(count)) => {
                        tracing::warn!(count, "native TikTok event receiver lagged")
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                        tracing::warn!("native TikTok event stream closed");
                        break;
                    }
                }
            }
        });
    }

    #[cfg(not(feature = "native-tiktok"))]
    fn start_live_event_pump(self: &Arc<Self>) {}

    #[cfg(feature = "native-tiktok")]
    async fn connect_native(self: &Arc<Self>, request: ConnectRequest) {
        self.publish_disconnected_event().await;
        self.live.disconnect().await;
        self.emit(HostMessage::Connection {
            status: ipc::messages::ConnectionStatus::Connecting,
            unique_id: clean_unique_id(&request.unique_id),
            title: None,
            room_id: request.room_id.clone(),
            avatar_url: None,
        });

        match self.live.connect(request).await {
            Ok(_) => {}
            Err(error) => {
                self.emit(HostMessage::Error {
                    phase: ipc::messages::ErrorPhase::Connect,
                    message: error.to_string(),
                });
                self.live.disconnect().await;
                self.emit(HostMessage::connection_disconnected());
            }
        }
    }

    #[cfg(not(feature = "native-tiktok"))]
    async fn connect_native(self: &Arc<Self>, _request: ConnectRequest) {
        self.emit(HostMessage::Error {
            phase: ipc::messages::ErrorPhase::Connect,
            message: "the native TikTok client is disabled in this build".to_owned(),
        });
        self.emit(HostMessage::connection_disconnected());
    }

    #[cfg(feature = "native-tiktok")]
    async fn pick_live(self: &Arc<Self>, session_cookie: &str) {
        match self.live.live_channels(session_cookie).await {
            Ok(mut rooms) => {
                if rooms.is_empty() {
                    self.emit(HostMessage::Error {
                        phase: ipc::messages::ErrorPhase::Connect,
                        message: "TikTok returned no live rooms.".to_owned(),
                    });
                    return;
                }
                // The native discovery client orders rooms by viewers. Picking
                // the first item is deterministic and avoids a random source
                // in the core; callers can request another room explicitly.
                let room = rooms.remove(0);
                self.connect_native(ConnectRequest {
                    unique_id: room.unique_id,
                    session_cookie: session_cookie.to_owned(),
                    room_id: Some(room.room_id),
                })
                .await;
            }
            Err(error) => {
                self.emit(HostMessage::Error {
                    phase: ipc::messages::ErrorPhase::Connect,
                    message: error.to_string(),
                });
                self.emit(HostMessage::connection_disconnected());
            }
        }
    }

    #[cfg(not(feature = "native-tiktok"))]
    async fn pick_live(&self, _session_cookie: &str) {
        self.emit(HostMessage::Error {
            phase: ipc::messages::ErrorPhase::Connect,
            message: "the native TikTok client is disabled in this build".to_owned(),
        });
    }

    #[cfg(feature = "native-tiktok")]
    async fn handle_native_event(self: &Arc<Self>, event: ClientEvent) {
        match event {
            ClientEvent::Connected(info) => self.handle_connected(info).await,
            ClientEvent::Event(event) => self.handle_live_event(event).await,
            ClientEvent::Reconnecting { attempt, delay_ms } => {
                self.emit(HostMessage::Reconnecting { attempt, delay_ms });
            }
            ClientEvent::Disconnected { reason } => {
                self.live.disconnect().await;
                self.publish_disconnected_event().await;
                tracing::info!(%reason, "TikTok live disconnected");
                self.emit(HostMessage::connection_disconnected());
            }
            ClientEvent::Error { phase, message } => {
                self.emit(HostMessage::Error {
                    phase: match phase {
                        tiktools_tiktok::ErrorPhase::Connect => ipc::messages::ErrorPhase::Connect,
                        tiktools_tiktok::ErrorPhase::Live => ipc::messages::ErrorPhase::Live,
                    },
                    message,
                });
            }
        }
    }

    #[cfg(feature = "native-tiktok")]
    async fn handle_connected(self: &Arc<Self>, info: tiktools_tiktok::ConnectionInfo) {
        let sequence = self.connection_sequence.fetch_add(1, Ordering::AcqRel) + 1;
        let context = LiveContext {
            unique_id: info.unique_id.clone(),
            room_id: info.room_id.clone(),
            connection_id: format!("connection-{sequence}"),
        };
        *self
            .connection_context
            .write()
            .expect("connection context lock poisoned") = Some(context.clone());

        let gifts = info
            .gifts
            .iter()
            .map(|gift| {
                json!({
                    "id": gift.id,
                    "name": gift.name,
                    "diamondCount": gift.diamond_count,
                    "iconUrl": gift.icon_url,
                })
            })
            .collect::<Vec<_>>();

        #[cfg(feature = "persistence")]
        let (creator, recent_creators, app_state) = {
            let database = Arc::clone(&self.db);
            let info_for_db = info.clone();
            let gifts_for_db = gifts.clone();
            match tokio::time::timeout(
                Duration::from_secs(2),
                tokio::task::spawn_blocking(move || {
                    let creator = match database.save_creator(
                        &info_for_db.unique_id,
                        Some(&info_for_db.room_id),
                        Some(&info_for_db.nickname),
                        info_for_db.avatar_url.as_deref(),
                        Some(&info_for_db.title),
                        Some(&info_for_db.unique_id),
                    ) {
                        Ok(creator) => creator,
                        Err(error) => {
                            tracing::warn!(%error, "could not persist connected creator");
                            creator_value(&info_for_db)
                        }
                    };
                    let recent_creators =
                        database.load_recent_creators(10).unwrap_or_else(|error| {
                            tracing::warn!(%error, "could not load recent creators");
                            Vec::new()
                        });
                    let app_state = database
                        .load_app_state()
                        .ok()
                        .map(|values| {
                            values
                                .into_iter()
                                .filter_map(|(key, value)| {
                                    value.as_str().map(|value| (key, value.to_owned()))
                                })
                                .collect::<std::collections::BTreeMap<_, _>>()
                        })
                        .unwrap_or_default();
                    if let Err(error) = database.save_gift_catalog(&gifts_for_db) {
                        tracing::warn!(%error, "could not persist TikTok gift catalog");
                    }
                    (creator, recent_creators, app_state)
                }),
            )
            .await
            {
                Ok(Ok(values)) => values,
                Ok(Err(error)) => {
                    tracing::error!(%error, "connection persistence worker failed");
                    (
                        creator_value(&info),
                        Vec::new(),
                        std::collections::BTreeMap::new(),
                    )
                }
                Err(_) => {
                    tracing::warn!(
                        "connection persistence exceeded 2 seconds; continuing live event delivery"
                    );
                    (
                        creator_value(&info),
                        Vec::new(),
                        std::collections::BTreeMap::new(),
                    )
                }
            }
        };

        #[cfg(not(feature = "persistence"))]
        let (creator, recent_creators, app_state) = (
            creator_value(&info),
            Vec::new(),
            std::collections::BTreeMap::new(),
        );

        self.emit(HostMessage::Connection {
            status: ipc::messages::ConnectionStatus::Connected,
            unique_id: Some(info.unique_id.clone()),
            title: Some(info.title.clone()).filter(|value| !value.is_empty()),
            room_id: Some(info.room_id.clone()),
            avatar_url: info.avatar_url.clone(),
        });
        self.emit(HostMessage::CreatorState {
            creator: Some(creator),
        });
        self.emit(HostMessage::RecentCreators {
            creators: recent_creators,
        });
        self.emit(HostMessage::AppState { state: app_state });
        self.emit(HostMessage::PointsConfig {
            config: self.points.config(),
        });
        self.emit(HostMessage::Leaderboard {
            viewers: self.points.leaderboard(Some(50)),
        });

        self.emit(HostMessage::GiftCatalog { gifts });

        self.queue_automation_event(self.make_automation_event(
            "tiktok.connected",
            json!({"uniqueId": info.unique_id, "roomId": info.room_id}),
            None,
        ));
    }

    #[cfg(feature = "native-tiktok")]
    async fn handle_live_event(self: &Arc<Self>, event: NativeLiveEvent) {
        let automation_event = self.normalize_native_event(&event);
        let Some((mut ui_event, action, options, reason)) = self.ui_event_and_points(&event) else {
            if let Some(event) = automation_event {
                self.queue_automation_event(event);
            }
            if let NativeLiveEvent::RoomUser {
                total, total_user, ..
            } = event
            {
                self.emit(HostMessage::RoomStats {
                    viewers: total,
                    total_users: total_user,
                    top_viewers: Vec::new(),
                });
            }
            return;
        };

        let should_award = !matches!(
            event,
            NativeLiveEvent::Gift {
                streakable: true,
                repeat_end: false,
                ..
            }
        );
        let point_award = if should_award {
            let unique_id = ui_event["author"].as_str().unwrap_or("viewer").to_owned();
            let points = Arc::clone(&self.points);
            match tokio::time::timeout(
                Duration::from_secs(2),
                tokio::task::spawn_blocking(move || {
                    points.award_points(&unique_id, action, options)
                }),
            )
            .await
            {
                Ok(Ok(award)) => award,
                Ok(Err(error)) => {
                    tracing::error!(%error, "points worker failed while handling TikTok event");
                    None
                }
                Err(_) => {
                    tracing::warn!(
                        "points persistence exceeded 2 seconds; continuing live event delivery"
                    );
                    None
                }
            }
        } else {
            None
        };
        if let Some(award) = point_award.as_ref() {
            if let Some(object) = ui_event.as_object_mut() {
                object.insert("points".to_owned(), json!(award.total_points));
                object.insert("level".to_owned(), json!(award.level));
                object.insert("pointsDelta".to_owned(), json!(award.delta));
            }
            self.emit(HostMessage::PointsAwarded {
                unique_id: award.unique_id.clone(),
                delta: award.delta,
                total_points: award.total_points,
                level: award.level,
            });
        }
        if let Some(event) = automation_event {
            let mut event = event;
            if let Some(award) = point_award.as_ref() {
                if let Some(object) = event.as_object_mut() {
                    object.insert(
                        "points".to_owned(),
                        json!({
                            "delta": award.delta,
                            "total": award.total_points,
                            "level": award.level
                        }),
                    );
                }
            }
            self.queue_automation_event(event);
            if let Some(award) = point_award.as_ref().filter(|award| award.delta != 0.0) {
                self.queue_automation_event(self.make_automation_event(
                    "points.awarded",
                    json!({
                        "uniqueId": award.unique_id,
                        "delta": award.delta,
                        "totalPoints": award.total_points,
                        "level": award.level,
                        "currencyName": award.currency_name,
                        "reason": reason
                    }),
                    None,
                ));
            }
        }
        self.emit(HostMessage::LiveEvent { event: ui_event });
        self.emit(HostMessage::Leaderboard {
            viewers: self.points.leaderboard(Some(50)),
        });
    }

    #[cfg(feature = "native-tiktok")]
    fn ui_event_and_points(
        &self,
        event: &NativeLiveEvent,
    ) -> Option<(serde_json::Value, PointAction, AwardOptions, &'static str)> {
        let user = native_user(event)?;
        let unique_id = clean_unique_id(&user.unique_id).unwrap_or_else(|| "viewer".to_owned());
        let base_options = || AwardOptions {
            user_id: user.user_id.clone(),
            nickname: (!user.nickname.is_empty()).then(|| user.nickname.clone()),
            ..AwardOptions::default()
        };
        match event {
            NativeLiveEvent::Chat { comment, .. } => Some((
                json!({
                    "kind": "chat",
                    "author": unique_id,
                    "nickname": user.nickname,
                    "text": comment,
                    "i18nKey": "chatMessage",
                    "i18nParams": {"comment": comment}
                }),
                PointAction::Chat,
                base_options(),
                "chat",
            )),
            NativeLiveEvent::Gift {
                gift_name,
                diamond_count,
                repeat_count,
                combo_count,
                repeat_end,
                streakable,
                gift_icon_url,
                ..
            } => {
                let count = (*repeat_count).max(*combo_count).max(1);
                let diamonds = (*diamond_count).max(1);
                let total_diamonds = diamonds.saturating_mul(count);
                let mut options = base_options();
                if !(*streakable && !*repeat_end) {
                    options.diamond_count = Some(total_diamonds as f64);
                }
                let event = json!({
                    "kind": "gift",
                    "author": unique_id,
                    "nickname": user.nickname,
                    "text": format!("sent {count}× {gift_name} ({total_diamonds})"),
                    "giftDetails": {
                        "name": gift_name,
                        "count": count,
                        "diamonds": total_diamonds,
                        "imageUrl": gift_icon_url
                    },
                    "i18nKey": "giftSent",
                    "i18nParams": {"count": count, "giftName": gift_name, "diamonds": total_diamonds}
                });
                Some((event, PointAction::Gift, options, "gift"))
            }
            NativeLiveEvent::Like { count, .. } => {
                let count = (*count).max(1);
                let mut options = base_options();
                options.count = Some(count as f64);
                Some((
                    json!({
                        "kind": "like",
                        "author": unique_id,
                        "nickname": user.nickname,
                        "text": format!("sent {} {}", count, if count == 1 { "like" } else { "likes" }),
                        "likeCount": count,
                        "i18nKey": "likeSent",
                        "i18nParams": {"count": count}
                    }),
                    PointAction::Like,
                    options,
                    "like",
                ))
            }
            NativeLiveEvent::Member { .. } => Some((
                json!({
                    "kind": "member",
                    "author": unique_id,
                    "nickname": user.nickname,
                    "text": "joined the LIVE",
                    "i18nKey": "joinedLive",
                    "i18nParams": {}
                }),
                PointAction::Join,
                base_options(),
                "join",
            )),
            NativeLiveEvent::Social { action, .. } => {
                let is_follow = *action == 1;
                Some((
                    json!({
                        "kind": "social",
                        "author": unique_id,
                        "nickname": user.nickname,
                        "text": if is_follow { "followed the creator" } else { "shared the LIVE" },
                        "i18nKey": if is_follow { "followedCreator" } else { "sharedLive" },
                        "i18nParams": {}
                    }),
                    if is_follow {
                        PointAction::Follow
                    } else {
                        PointAction::Share
                    },
                    base_options(),
                    if is_follow { "follow" } else { "share" },
                ))
            }
            NativeLiveEvent::RoomUser { .. } | NativeLiveEvent::Unknown { .. } => None,
        }
    }

    #[cfg(feature = "native-tiktok")]
    fn normalize_native_event(&self, event: &NativeLiveEvent) -> Option<serde_json::Value> {
        let context = self
            .connection_context
            .read()
            .expect("connection context lock poisoned")
            .clone()?;
        let (event_type, data, user) = match event {
            NativeLiveEvent::Chat {
                user,
                comment,
                method,
                msg_id,
                is_history,
            } => (
                "tiktok.chat",
                json!({"comment": comment, "method": method, "msgId": msg_id.to_string(), "isHistory": is_history}),
                Some(user_value(user)),
            ),
            NativeLiveEvent::Gift {
                user,
                gift_id,
                gift_name,
                diamond_count,
                repeat_count,
                combo_count,
                group_id,
                repeat_end,
                streakable,
                gift_icon_url,
                method,
                msg_id,
                is_history,
            } => (
                "tiktok.gift",
                json!({
                    "giftId": gift_id.to_string(),
                    "giftName": gift_name,
                    "diamondCount": diamond_count,
                    "repeatCount": repeat_count,
                    "comboCount": combo_count,
                    "groupId": group_id.to_string(),
                    "repeatEnd": repeat_end,
                    "streakable": streakable,
                    "giftIconUrl": gift_icon_url,
                    "method": method,
                    "msgId": msg_id.to_string(),
                    "isHistory": is_history
                }),
                Some(user_value(user)),
            ),
            NativeLiveEvent::Like {
                user,
                count,
                total,
                method,
                msg_id,
                is_history,
            } => (
                "tiktok.like",
                json!({"count": count, "total": total, "method": method, "msgId": msg_id.to_string(), "isHistory": is_history}),
                Some(user_value(user)),
            ),
            NativeLiveEvent::Member {
                user,
                member_count,
                action,
                method,
                msg_id,
                is_history,
            } => (
                "tiktok.join",
                json!({"memberCount": member_count, "action": action, "method": method, "msgId": msg_id.to_string(), "isHistory": is_history}),
                Some(user_value(user)),
            ),
            NativeLiveEvent::Social {
                user,
                action,
                follow_count,
                share_count,
                method,
                msg_id,
                is_history,
            } => (
                match action {
                    1 => "tiktok.follow",
                    3 => "tiktok.share",
                    _ => "tiktok.social",
                },
                json!({"action": action, "followCount": follow_count, "shareCount": share_count, "method": method, "msgId": msg_id.to_string(), "isHistory": is_history}),
                Some(user_value(user)),
            ),
            NativeLiveEvent::RoomUser {
                total,
                popularity,
                total_user,
                anonymous,
                method,
                msg_id,
                is_history,
            } => (
                "tiktok.room_stats",
                json!({"viewers": total, "totalUsers": total_user, "popularity": popularity, "anonymous": anonymous, "topViewers": [], "method": method, "msgId": msg_id.to_string(), "isHistory": is_history}),
                None,
            ),
            NativeLiveEvent::Unknown { .. } => return None,
        };
        Some(self.make_automation_event_with_context(event_type, data, user, &context))
    }

    #[cfg(feature = "native-tiktok")]
    fn make_automation_event(
        &self,
        event_type: &str,
        data: serde_json::Value,
        user: Option<serde_json::Value>,
    ) -> serde_json::Value {
        let context = self
            .connection_context
            .read()
            .expect("connection context lock poisoned")
            .clone();
        match context {
            Some(context) => {
                self.make_automation_event_with_context(event_type, data, user, &context)
            }
            None => json!({
                "id": format!("{}-{}", event_type.replace('.', "-"), self.next_sequence()),
                "type": event_type,
                "timestamp": now_millis(),
                "data": data,
                "user": user
            }),
        }
    }

    fn make_automation_event_with_context(
        &self,
        event_type: &str,
        data: serde_json::Value,
        user: Option<serde_json::Value>,
        context: &LiveContext,
    ) -> serde_json::Value {
        let mut event = json!({
            "id": format!("{}-{}", event_type.replace('.', "-"), self.next_sequence()),
            "type": event_type,
            "timestamp": now_millis(),
            "connectionId": context.connection_id,
            "creator": {"uniqueId": context.unique_id, "roomId": context.room_id},
            "data": data
        });
        if let Some(user) = user {
            event["user"] = user;
        }
        event
    }

    async fn publish_automation_event(self: &Arc<Self>, event: serde_json::Value) {
        self.remember_automation_event(&event);
        Box::pin(self.run_automation_event(event)).await;
    }

    #[cfg(feature = "native-tiktok")]
    fn queue_automation_event(self: &Arc<Self>, event: serde_json::Value) {
        self.remember_automation_event(&event);
        let core = Arc::clone(self);
        tokio::spawn(async move {
            Box::pin(core.run_automation_event(event)).await;
        });
    }

    fn remember_automation_event(&self, event: &serde_json::Value) {
        *self
            .last_automation_event
            .write()
            .expect("automation event lock poisoned") = Some(event.clone());
        *self
            .last_automation_event_at
            .write()
            .expect("automation timestamp lock poisoned") = Some(now_millis());
        self.events.publish(AppEvent::TikTok(event.clone()));
        self.emit(HostMessage::AutomationContext {
            event: Some(event.clone()),
            captured_at: *self
                .last_automation_event_at
                .read()
                .expect("automation timestamp lock poisoned"),
        });
    }

    async fn publish_disconnected_event(self: &Arc<Self>) {
        let context = self
            .connection_context
            .write()
            .expect("connection context lock poisoned")
            .take();
        let Some(context) = context else { return };
        self.publish_automation_event(self.make_automation_event_with_context(
            "tiktok.disconnected",
            json!({"uniqueId": context.unique_id, "roomId": context.room_id}),
            None,
            &context,
        ))
        .await;
    }

    fn next_sequence(&self) -> u64 {
        self.automation_sequence.fetch_add(1, Ordering::AcqRel) + 1
    }

    fn emit_persisted_workflows(&self) {
        #[cfg(feature = "persistence")]
        let workflows = match self.db.load_workflows() {
            Ok(workflows) => workflows,
            Err(error) => {
                self.emit(HostMessage::AutomationError {
                    message: error.to_string(),
                });
                Vec::new()
            }
        };
        #[cfg(not(feature = "persistence"))]
        let workflows = Vec::new();
        self.emit(HostMessage::AutomationWorkflows { workflows });
    }

    fn emit_persisted_gifts(&self) {
        #[cfg(feature = "persistence")]
        let gifts = match self.db.load_gift_catalog() {
            Ok(gifts) => gifts,
            Err(error) => {
                tracing::warn!(%error, "could not load gift catalog");
                Vec::new()
            }
        };
        #[cfg(not(feature = "persistence"))]
        let gifts = Vec::new();
        self.emit(HostMessage::GiftCatalog { gifts });
    }

    fn emit_persisted_behavior(&self) {
        #[cfg(feature = "persistence")]
        let mut snapshot = match self.db.load_behavior_snapshot() {
            Ok(snapshot) => snapshot,
            Err(error) => {
                self.emit(HostMessage::AutomationError {
                    message: error.to_string(),
                });
                empty_behavior_snapshot()
            }
        };
        #[cfg(not(feature = "persistence"))]
        let mut snapshot = empty_behavior_snapshot();
        self.merge_runtime_catalog(&mut snapshot);
        self.automation.replace_snapshot(&snapshot);
        self.emit(HostMessage::Behavior { snapshot });
    }

    fn merge_runtime_catalog(&self, snapshot: &mut serde_json::Value) {
        let Some(object) = snapshot.as_object_mut() else {
            *snapshot = empty_behavior_snapshot();
            return;
        };

        let mut action_types = builtin_action_types();
        let mut plugins = Vec::new();
        let persisted_plugins = object
            .get("plugins")
            .and_then(serde_json::Value::as_array)
            .cloned()
            .unwrap_or_default();

        for plugin in self.plugins.list() {
            let state = persisted_plugins.iter().find(|value| {
                value.get("id").and_then(serde_json::Value::as_str)
                    == Some(plugin.manifest.id.as_str())
            });
            let installed = state
                .and_then(|value| value.get("installed"))
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(true);
            let enabled = state
                .and_then(|value| value.get("enabled"))
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(true);
            let dependency = format!("{} runtime", plugin.manifest.runtime);
            let description = plugin
                .manifest
                .description
                .clone()
                .unwrap_or_else(|| format!("{} runtime plugin", plugin.manifest.name));
            let action_ids = plugin
                .manifest
                .action_types
                .iter()
                .filter_map(|value| value.get("id").and_then(serde_json::Value::as_str))
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>();
            plugins.push(json!({
                "descriptor": {
                    "id": plugin.manifest.id,
                    "name": localized(&plugin.manifest.name, "plugin.name"),
                    "version": plugin.manifest.version,
                    "description": localized(&description, "plugin.description"),
                    "dependency": localized(&dependency, "plugin.dependency"),
                    "permissions": plugin.manifest.permissions,
                    "actionTypeIds": action_ids,
                    "hasSettings": plugin.manifest.settings_schema.is_some()
                },
                "installed": installed,
                "enabled": enabled,
                "available": plugin.available,
                "unavailableReason": plugin.reason
            }));

            for descriptor in &plugin.manifest.action_types {
                let Some(mut descriptor) = descriptor.as_object().cloned() else {
                    continue;
                };
                let Some(id) = descriptor.get("id").and_then(serde_json::Value::as_str) else {
                    continue;
                };
                if !is_identifier(id) {
                    tracing::warn!(plugin = %plugin.manifest.id, action = %id, "plugin action id is invalid");
                    continue;
                }
                descriptor.insert(
                    "source".to_owned(),
                    json!({"kind": "plugin", "pluginId": plugin.manifest.id}),
                );
                if !descriptor.contains_key("requiredCapabilities") {
                    descriptor.insert(
                        "requiredCapabilities".to_owned(),
                        Value::Array(
                            plugin
                                .manifest
                                .capabilities
                                .iter()
                                .cloned()
                                .map(Value::String)
                                .collect(),
                        ),
                    );
                }
                action_types.push(Value::Object(descriptor));
            }
        }

        object.insert("actionTypes".to_owned(), Value::Array(action_types));
        object.insert("plugins".to_owned(), Value::Array(plugins));
        object.insert("translations".to_owned(), builtin_translations());
    }

    fn emit_plugin_settings(&self, id: &str) {
        let Some(plugin) = self.plugins.get(id) else {
            self.emit(HostMessage::BehaviorError {
                message: format!("Plugin `{id}` is not installed."),
            });
            return;
        };
        let Some(schema) = plugin.manifest.settings_schema.clone() else {
            self.emit(HostMessage::BehaviorError {
                message: format!("Plugin settings are not declared by `{id}`."),
            });
            return;
        };
        match self.capabilities.load_plugin_settings(&plugin.manifest) {
            Ok(values) => self.emit(HostMessage::PluginSettings {
                id: id.to_owned(),
                schema,
                ui_hints: plugin.manifest.settings_ui_hints.clone(),
                values,
            }),
            Err(error) => self.emit(HostMessage::BehaviorError {
                message: error.to_string(),
            }),
        }
    }

    fn save_plugin_settings(&self, id: &str, values: std::collections::BTreeMap<String, Value>) {
        let Some(plugin) = self.plugins.get(id) else {
            self.emit(HostMessage::BehaviorError {
                message: format!("Plugin `{id}` is not installed."),
            });
            return;
        };
        let Some(schema) = plugin.manifest.settings_schema.clone() else {
            self.emit(HostMessage::BehaviorError {
                message: format!("Plugin settings are not declared by `{id}`."),
            });
            return;
        };
        match self
            .capabilities
            .save_plugin_settings(&plugin.manifest, &values)
        {
            Ok(values) => self.emit(HostMessage::PluginSettings {
                id: id.to_owned(),
                schema,
                ui_hints: plugin.manifest.settings_ui_hints.clone(),
                values,
            }),
            Err(error) => self.emit(HostMessage::BehaviorError {
                message: error.to_string(),
            }),
        }
    }

    async fn test_action(self: &Arc<Self>, action: &Value, trigger: Option<&str>) -> Value {
        let event = self
            .last_automation_event
            .read()
            .expect("automation event lock poisoned")
            .clone()
            .unwrap_or_else(|| sample_automation_event(trigger.unwrap_or("tiktok.chat")));
        self.execute_action(action, &event, None, true).await
    }

    async fn test_event(self: &Arc<Self>, record: &Value) -> Value {
        let started = now_millis();
        let trigger = record
            .get("trigger")
            .and_then(Value::as_str)
            .unwrap_or("tiktok.chat");
        let event = self
            .last_automation_event
            .read()
            .expect("automation event lock poisoned")
            .clone()
            .filter(|event| event.get("type").and_then(Value::as_str) == Some(trigger))
            .unwrap_or_else(|| sample_automation_event(trigger));

        if !self.automation.event_record_matches(record, &event) {
            let summary = "Event filters did not match the sample event.";
            return json!({
                "id": self.automation.next_run_id("test-event", started),
                "at": started,
                "status": "error",
                "eventName": trigger,
                "actionName": record.get("name").and_then(Value::as_str).unwrap_or("Event"),
                "summary": summary,
                "durationMs": now_millis().saturating_sub(started),
                "test": true,
                "logs": [],
                "error": summary
            });
        }

        let actions = self.automation.actions_for_event(record);
        if actions.is_empty() {
            let summary = "The event has no saved actions to test.";
            return json!({
                "id": self.automation.next_run_id("test-event", started),
                "at": started,
                "status": "error",
                "eventName": trigger,
                "actionName": record.get("name").and_then(Value::as_str).unwrap_or("Event"),
                "summary": summary,
                "durationMs": now_millis().saturating_sub(started),
                "test": true,
                "logs": [],
                "error": summary
            });
        }

        let mut runs = Vec::with_capacity(actions.len());
        for action in &actions {
            runs.push(
                self.execute_action(action, &event, Some(record), true)
                    .await,
            );
        }
        let failed = runs
            .iter()
            .any(|run| run.get("status") == Some(&Value::String("error".to_owned())));
        let summary = if failed {
            "One or more actions failed."
        } else {
            "All referenced actions passed."
        };
        let mut result = json!({
            "id": self.automation.next_run_id("test-event", started),
            "at": started,
            "status": if failed { "error" } else { "ok" },
            "eventName": trigger,
            "actionName": record.get("name").and_then(Value::as_str).unwrap_or("Event"),
            "summary": summary,
            "durationMs": now_millis().saturating_sub(started),
            "test": true,
            "logs": [],
            "actions": runs
        });
        if failed {
            result["error"] = Value::String(summary.to_owned());
        }
        result
    }

    async fn run_automation_event(self: &Arc<Self>, event: Value) {
        if AutomationService::emit_depth(&event) >= 3 {
            tracing::warn!(event_type = ?event.get("type"), "automation emit depth limit reached");
            return;
        }
        for record in self.automation.matching_events(&event) {
            if !self.automation.claim_event(&record, &event, now_millis()) {
                continue;
            }
            for action in self.automation.actions_for_event(&record) {
                self.execute_action(&action, &event, Some(&record), false)
                    .await;
            }
        }
    }

    async fn execute_action(
        self: &Arc<Self>,
        action: &Value,
        event: &Value,
        origin: Option<&Value>,
        test: bool,
    ) -> Value {
        let started = now_millis();
        let type_id = action
            .get("typeId")
            .or_else(|| action.get("type"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        let config = action
            .get("config")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let mut logs = Vec::new();
        let result = self
            .execute_action_impl(&type_id, &config, action, event, &mut logs, test)
            .await;

        let (status, summary, error) = match result {
            Ok(summary) => ("ok", summary, None),
            Err(error) => ("error", error.clone(), Some(error)),
        };
        let run = json!({
            "id": self.automation.next_run_id(if test { "test-action" } else { "run" }, started),
            "at": started,
            "status": status,
            "eventId": origin.and_then(|value| value.get("id")),
            "eventName": origin.and_then(|value| value.get("name")),
            "actionId": action.get("id"),
            "actionName": action.get("name").and_then(Value::as_str).unwrap_or("Action"),
            "summary": summary,
            "durationMs": now_millis().saturating_sub(started),
            "test": test,
            "logs": logs.into_iter().take(40).collect::<Vec<_>>(),
            "error": error
        });
        let runs = self.automation.record_run(run.clone());
        self.emit(HostMessage::BehaviorRuns { runs });
        run
    }

    async fn execute_action_impl(
        self: &Arc<Self>,
        type_id: &str,
        config: &serde_json::Map<String, Value>,
        action: &Value,
        event: &Value,
        logs: &mut Vec<String>,
        test: bool,
    ) -> Result<String, String> {
        match type_id {
            "core.log" => {
                let message = render_template(
                    config
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                    event,
                );
                tracing::info!(target: "tiktools::automation", message = %message, "automation log");
                logs.push(message.clone());
                Ok(message.chars().take(120).collect())
            }
            "core.emit" => {
                let event_type = normalize_emit_type(
                    config
                        .get("type")
                        .and_then(Value::as_str)
                        .unwrap_or("overlay.alert"),
                )?;
                let payload = config
                    .get("data")
                    .map(|value| render_json_map(value, event))
                    .unwrap_or_default();
                self.publish_automation_event(self.make_internal_automation_event(
                    event,
                    &event_type,
                    Value::Object(payload.into_iter().collect()),
                ))
                .await;
                Ok(format!("emit {event_type}"))
            }
            "core.points" => {
                let unique_id = render_template(
                    config.get("uniqueId").and_then(Value::as_str).unwrap_or(""),
                    event,
                );
                let delta = number_value(config.get("delta")).unwrap_or_default();
                if unique_id.trim().is_empty() || !delta.is_finite() || delta == 0.0 {
                    return Err("Points action needs a viewer and a non-zero number.".to_owned());
                }
                let award = self
                    .points
                    .adjust(&unique_id, delta)
                    .ok_or_else(|| format!("Viewer `{unique_id}` is not in the leaderboard."))?;
                self.emit(HostMessage::PointsAwarded {
                    unique_id: award.unique_id.clone(),
                    delta: award.delta,
                    total_points: award.total_points,
                    level: award.level,
                });
                self.emit(HostMessage::Leaderboard {
                    viewers: self.points.leaderboard(Some(50)),
                });
                Ok(format!("{} {:+}", award.unique_id, award.delta))
            }
            "core.delay" => {
                let millis = number_value(config.get("ms"))
                    .unwrap_or_default()
                    .clamp(0.0, 60_000.0) as u64;
                if !test && millis > 0 {
                    tokio::time::sleep(std::time::Duration::from_millis(millis)).await;
                }
                Ok(format!("wait {millis} ms"))
            }
            "core.code" => {
                let source = config
                    .get("source")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "Script action has no source.".to_owned())?;
                let result = self.automation.evaluate_script(source, event, &json!({}))?;
                let mut parts = Vec::new();
                for log in result
                    .get("log")
                    .into_iter()
                    .flat_map(as_values)
                    .filter_map(Value::as_str)
                {
                    if logs.len() < 40 {
                        logs.push(log.to_owned());
                    }
                }
                for intent in result.get("emit").into_iter().flat_map(as_values) {
                    let Some(intent) = intent.as_object() else {
                        continue;
                    };
                    let Some(event_type) = intent.get("type").and_then(Value::as_str) else {
                        continue;
                    };
                    let event_type = normalize_emit_type(event_type)?;
                    let payload = intent
                        .get("data")
                        .map(|value| render_json_map(value, event))
                        .unwrap_or_default();
                    self.publish_automation_event(self.make_internal_automation_event(
                        event,
                        &event_type,
                        Value::Object(payload.into_iter().collect()),
                    ))
                    .await;
                    parts.push(format!("emit {event_type}"));
                }
                if let Some(intent) = result.get("fetch").and_then(Value::as_object) {
                    let mut fetch_config = intent.clone();
                    if let Some(emit_response_as) = result.get("emitResponseAs") {
                        fetch_config.insert("emitResponseAs".to_owned(), emit_response_as.clone());
                    }
                    let allowed_hosts = hosts_in_source(source);
                    parts.push(
                        self.execute_http_action(&fetch_config, event, logs, Some(&allowed_hosts))
                            .await?,
                    );
                }
                if parts.is_empty() {
                    Ok(format!("script returned {}", result_type(&result)))
                } else {
                    Ok(parts.join(" · "))
                }
            }
            "core.fetch" => self.execute_http_action(config, event, logs, None).await,
            _ if type_id.is_empty() => Err("Action has no typeId.".to_owned()),
            _ => {
                self.execute_plugin_action(type_id, action, event, logs)
                    .await
            }
        }
    }

    #[cfg(feature = "http")]
    async fn execute_http_action(
        self: &Arc<Self>,
        config: &serde_json::Map<String, Value>,
        event: &Value,
        logs: &mut Vec<String>,
        allowed_hosts: Option<&[String]>,
    ) -> Result<String, String> {
        let raw_url = config
            .get("url")
            .and_then(Value::as_str)
            .ok_or_else(|| "HTTP action has no URL.".to_owned())?;
        let configured_url = reqwest::Url::parse(raw_url)
            .map_err(|_| "HTTP URL is invalid before template rendering.".to_owned())?;
        let configured_host = configured_url
            .host_str()
            .map(str::to_ascii_lowercase)
            .ok_or_else(|| "HTTP URL has no host.".to_owned())?;
        let rendered_url = render_template(raw_url, event);
        let url = reqwest::Url::parse(&rendered_url)
            .map_err(|_| "HTTP URL is invalid after template rendering.".to_owned())?;
        let allow_private_network = config
            .get("allowPrivateNetwork")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        validate_http_url(&url, &configured_host, allowed_hosts, allow_private_network).await?;

        let method_name = config
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or("POST")
            .trim()
            .to_ascii_uppercase();
        let method = reqwest::Method::from_bytes(method_name.as_bytes())
            .map_err(|_| format!("HTTP method is invalid: {method_name}"))?;
        let mut request = self.http_client.request(method.clone(), url.clone());
        let mut content_type = String::new();
        if let Some(headers) = config.get("headers").and_then(Value::as_object) {
            if headers.len() > 64 {
                return Err("HTTP action has too many headers.".to_owned());
            }
            for (key, value) in headers {
                let value = value_to_string(&Value::String(render_template(
                    &value_to_string(value),
                    event,
                )));
                if key.eq_ignore_ascii_case("content-type") {
                    content_type = value.clone();
                }
                request = request.header(key, value);
            }
        }
        let body = config.get("body").and_then(|value| {
            if value.is_null() {
                None
            } else {
                Some(
                    value
                        .as_str()
                        .map(|value| render_template(value, event))
                        .unwrap_or_else(|| value_to_string(value)),
                )
            }
        });
        if let Some(body) = body.as_deref() {
            if !matches!(method, reqwest::Method::GET | reqwest::Method::HEAD)
                && content_type
                    .to_ascii_lowercase()
                    .contains("application/json")
                && !body.trim().is_empty()
                && serde_json::from_str::<Value>(body).is_err()
            {
                return Err("The JSON body is invalid after applying the template.".to_owned());
            }
            request = request.body(body.to_owned());
        }
        let timeout_ms = number_value(config.get("timeoutMs"))
            .unwrap_or(5_000.0)
            .clamp(100.0, 120_000.0) as u64;
        let started = now_millis();
        let response = request
            .timeout(std::time::Duration::from_millis(timeout_ms))
            .send()
            .await
            .map_err(|error| {
                if error.is_timeout() {
                    format!("HTTP request timed out after {timeout_ms} ms.")
                } else {
                    format!("HTTP request failed: {error}")
                }
            })?;
        if response.url() != &url && response.url().host_str() != Some(configured_host.as_str()) {
            return Err("HTTP redirect changed the destination host.".to_owned());
        }
        if response.status().is_redirection() && response.headers().get("location").is_some() {
            return Err("HTTP redirects are blocked by policy.".to_owned());
        }
        let status = response.status().as_u16();
        let response_url = response.url().to_string();
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_owned();
        let bytes = response
            .bytes()
            .await
            .map_err(|error| format!("could not read HTTP response: {error}"))?;
        if bytes.len() > 2 * 1024 * 1024 {
            return Err("HTTP response exceeds the 2 MiB limit.".to_owned());
        }
        let body = if content_type.to_ascii_lowercase().contains("json") {
            serde_json::from_slice::<Value>(&bytes)
                .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).into_owned()))
        } else {
            Value::String(String::from_utf8_lossy(&bytes).into_owned())
        };
        let elapsed = now_millis().saturating_sub(started);
        let log = format!(
            "{} {} → {} ({} ms)",
            method_name, configured_host, status, elapsed
        );
        tracing::info!(target: "tiktools::automation", message = %log, "HTTP action completed");
        logs.push(log);

        if let Some(emit_response_as) = config
            .get("emitResponseAs")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
        {
            let event_type = normalize_emit_type(emit_response_as)?;
            Box::pin(
                self.publish_automation_event(self.make_internal_automation_event(
                    event,
                    &event_type,
                    json!({"status": status, "ok": (200..300).contains(&status), "body": body}),
                )),
            )
            .await;
        }
        if !(200..300).contains(&status) {
            return Err(format!(
                "HTTP {status} {}",
                if status >= 500 {
                    "server error"
                } else {
                    "request failed"
                }
            ));
        }
        Ok(format!("{status} OK · {elapsed} ms · {response_url}"))
    }

    #[cfg(not(feature = "http"))]
    async fn execute_http_action(
        self: &Arc<Self>,
        _config: &serde_json::Map<String, Value>,
        _event: &Value,
        _logs: &mut Vec<String>,
        _allowed_hosts: Option<&[String]>,
    ) -> Result<String, String> {
        Err("HTTP action execution requires the host HTTP capability.".to_owned())
    }

    async fn execute_plugin_action(
        self: &Arc<Self>,
        type_id: &str,
        action: &Value,
        event: &Value,
        logs: &mut Vec<String>,
    ) -> Result<String, String> {
        let Some((plugin, descriptor)) = self.plugin_for_action(type_id) else {
            return Err(format!(
                "Action type `{type_id}` is not available in this host."
            ));
        };
        if !self.plugin_ready(&plugin.manifest.id) {
            return Err(format!(
                "Plugin `{}` is not installed, enabled, or available.",
                plugin.manifest.id
            ));
        }
        for capability in descriptor
            .get("requiredCapabilities")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
        {
            self.capabilities
                .require_capability(&plugin.manifest, capability)
                .map_err(|error| error.to_string())?;
        }
        self.plugins
            .start(&plugin.manifest.id)
            .map_err(|error| error.to_string())?;
        let plugin_id = plugin.manifest.id.clone();
        let request = json!({"type": "action", "action": action, "event": event});
        let plugins = Arc::clone(&self.plugins);
        let request_for_call = request.clone();
        let response =
            tokio::task::spawn_blocking(move || plugins.call(&plugin_id, &request_for_call))
                .await
                .map_err(|error| format!("plugin task failed: {error}"))?
                .map_err(|error| error.to_string())?;
        self.events.publish(AppEvent::Plugin(json!({
            "pluginId": plugin.manifest.id,
            "type": "action-result",
            "actionType": type_id,
            "response": response
        })));

        let mut parts = Vec::new();
        for log in response
            .get("logs")
            .into_iter()
            .flat_map(as_values)
            .filter_map(Value::as_str)
        {
            if logs.len() < 40 {
                logs.push(log.to_owned());
            }
        }
        for intent in response.get("emit").into_iter().flat_map(as_values) {
            let Some(intent) = intent.as_object() else {
                continue;
            };
            let Some(event_type) = intent.get("type").and_then(Value::as_str) else {
                continue;
            };
            let event_type = normalize_emit_type(event_type)?;
            let payload = intent
                .get("data")
                .map(|value| render_json_map(value, event))
                .unwrap_or_default();
            self.publish_automation_event(self.make_internal_automation_event(
                event,
                &event_type,
                Value::Object(payload.into_iter().collect()),
            ))
            .await;
            parts.push(format!("emit {event_type}"));
        }
        if let Some(summary) = response.get("summary").and_then(Value::as_str) {
            parts.push(summary.to_owned());
        }
        if parts.is_empty() {
            parts.push(format!("plugin {} completed", plugin.manifest.id));
        }
        Ok(parts.join(" · "))
    }

    fn plugin_for_action(
        &self,
        type_id: &str,
    ) -> Option<(tiktools_plugin_loader::DiscoveredPlugin, Value)> {
        self.plugins.list().into_iter().find_map(|plugin| {
            plugin
                .manifest
                .action_types
                .iter()
                .find(|descriptor| descriptor.get("id").and_then(Value::as_str) == Some(type_id))
                .cloned()
                .map(|descriptor| (plugin, descriptor))
        })
    }

    fn plugin_ready(&self, id: &str) -> bool {
        let Some(plugin) = self.plugins.get(id) else {
            return false;
        };
        if !plugin.available {
            return false;
        }
        #[cfg(feature = "persistence")]
        if let Ok(snapshot) = self.db.load_behavior_snapshot() {
            if let Some(state) = snapshot
                .get("plugins")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .find(|state| state.get("id").and_then(Value::as_str) == Some(id))
            {
                return state.get("installed").and_then(Value::as_bool) == Some(true)
                    && state.get("enabled").and_then(Value::as_bool) == Some(true);
            }
        }
        true
    }

    fn make_internal_automation_event(
        &self,
        source: &Value,
        event_type: &str,
        payload: Value,
    ) -> Value {
        let mut event = json!({
            "id": format!("plugin-emit-{}", self.next_sequence()),
            "type": "plugin.emit",
            "timestamp": now_millis(),
            "data": {
                "emitType": event_type,
                "depth": AutomationService::emit_depth(source).saturating_add(1),
                "payload": payload
            }
        });
        for key in ["connectionId", "creator", "user"] {
            if let Some(value) = source.get(key) {
                event[key] = value.clone();
            }
        }
        if let Some(source_id) = source.get("id") {
            event["sourceEventId"] = source_id.clone();
        }
        event
    }

    fn save_behavior_record(&self, table: &str, value: serde_json::Value) {
        #[cfg(feature = "persistence")]
        {
            if let Err(error) = self.db.save_behavior(table, &value) {
                self.emit(HostMessage::AutomationError {
                    message: error.to_string(),
                });
            } else {
                self.emit_persisted_behavior();
            }
        }
        #[cfg(not(feature = "persistence"))]
        {
            let _ = (table, value);
            self.emit(HostMessage::AutomationError {
                message: "Rust persistence is disabled in this build.".to_owned(),
            });
        }
    }

    fn delete_behavior_record(&self, table: &str, id: &str) {
        #[cfg(feature = "persistence")]
        {
            if let Err(error) = self.db.delete_behavior(table, id) {
                self.emit(HostMessage::AutomationError {
                    message: error.to_string(),
                });
            } else {
                self.emit_persisted_behavior();
            }
        }
        #[cfg(not(feature = "persistence"))]
        {
            let _ = (table, id);
            self.emit(HostMessage::AutomationError {
                message: "Rust persistence is disabled in this build.".to_owned(),
            });
        }
    }

    fn set_behavior_enabled(&self, table: &str, id: &str, enabled: bool) {
        #[cfg(feature = "persistence")]
        {
            if let Err(error) = self.db.set_behavior_enabled(table, id, enabled) {
                self.emit(HostMessage::AutomationError {
                    message: error.to_string(),
                });
            } else {
                self.emit_persisted_behavior();
            }
        }
        #[cfg(not(feature = "persistence"))]
        {
            let _ = (table, id, enabled);
            self.emit(HostMessage::AutomationError {
                message: "Rust persistence is disabled in this build.".to_owned(),
            });
        }
    }

    pub async fn shutdown(self: &Arc<Self>) {
        self.events.publish(AppEvent::Shutdown);
        self.publish_disconnected_event().await;
        self.live.disconnect().await;
        self.plugins.stop_all();
    }
}

fn empty_behavior_snapshot() -> serde_json::Value {
    json!({
        "actions": [],
        "events": [],
        "plugins": [],
        "actionTypes": builtin_action_types(),
        "translations": builtin_translations()
    })
}

fn localized(default: &str, key: &str) -> Value {
    json!({"default": default, "i18key": key})
}

fn is_identifier(value: &str) -> bool {
    let mut characters = value.chars();
    matches!(characters.next(), Some('a'..='z' | 'A'..='Z' | '_'))
        && value.len() <= 128
        && characters.all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-')
        })
}

fn normalize_emit_type(value: &str) -> Result<String, String> {
    let normalized = value
        .trim()
        .to_ascii_lowercase()
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-')
        })
        .take(64)
        .collect::<String>();
    if normalized.is_empty() {
        Err("Internal event needs a name.".to_owned())
    } else {
        Ok(normalized)
    }
}

fn number_value(value: Option<&Value>) -> Option<f64> {
    match value {
        Some(Value::Number(value)) => value.as_f64(),
        Some(Value::String(value)) => value.trim().parse().ok(),
        _ => None,
    }
}

fn hosts_in_source(source: &str) -> Vec<String> {
    let mut hosts = Vec::new();
    let mut rest = source;
    while let Some(offset) = rest.find("http://").or_else(|| rest.find("https://")) {
        let candidate = &rest[offset..];
        let end = candidate
            .find(|character: char| {
                character.is_whitespace()
                    || matches!(character, '"' | '\'' | '`' | ')' | '}' | ']' | ',')
            })
            .unwrap_or(candidate.len());
        let url = &candidate[..end];
        let host_start = url.find("://").map(|index| index + 3).unwrap_or(0);
        let host = url[host_start..]
            .split(['/', '?', '#'])
            .next()
            .unwrap_or_default()
            .trim_matches(['[', ']'])
            .split('@')
            .next_back()
            .unwrap_or_default()
            .split(':')
            .next()
            .unwrap_or_default()
            .to_ascii_lowercase();
        if !host.is_empty() && !host.contains('{') && !hosts.contains(&host) {
            hosts.push(host);
        }
        rest = &candidate[end..];
        if rest == candidate {
            break;
        }
    }
    hosts
}

#[cfg(feature = "http")]
async fn validate_http_url(
    url: &reqwest::Url,
    configured_host: &str,
    allowed_hosts: Option<&[String]>,
    allow_private_network: bool,
) -> Result<(), String> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Only http:// and https:// URLs are allowed.".to_owned());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("HTTP URLs cannot contain embedded credentials.".to_owned());
    }
    let host = url
        .host_str()
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "HTTP URL has no host.".to_owned())?;
    if host != configured_host {
        return Err("The rendered HTTP URL changed its configured host.".to_owned());
    }
    if let Some(allowed_hosts) = allowed_hosts {
        if !allowed_hosts.iter().any(|allowed| allowed == &host) {
            return Err(format!("HTTP host is not allowed by the script: {host}"));
        }
    }
    if is_private_host(&host) && !allow_private_network {
        return Err(format!("HTTP request to a private host is blocked: {host}"));
    }
    let port = url
        .port_or_known_default()
        .ok_or_else(|| "HTTP URL has no valid port.".to_owned())?;
    let addresses = tokio::net::lookup_host((host.as_str(), port))
        .await
        .map_err(|_| format!("HTTP host could not be resolved: {host}"))?;
    if !allow_private_network && addresses.map(|address| address.ip()).any(is_private_ip) {
        return Err(format!("HTTP host resolves to a private address: {host}"));
    }
    Ok(())
}

#[cfg(feature = "http")]
fn is_private_host(host: &str) -> bool {
    let normalized = host.trim_matches(['[', ']']).to_ascii_lowercase();
    normalized == "localhost"
        || normalized.ends_with(".localhost")
        || normalized.ends_with(".local")
        || normalized == "::"
        || normalized == "::1"
        || normalized
            .parse::<std::net::IpAddr>()
            .is_ok_and(is_private_ip)
}

#[cfg(feature = "http")]
fn is_private_ip(address: std::net::IpAddr) -> bool {
    match address {
        std::net::IpAddr::V4(address) => {
            let octets = address.octets();
            octets[0] == 0
                || octets[0] == 10
                || octets[0] == 127
                || (octets[0] == 100 && (64..=127).contains(&octets[1]))
                || (octets[0] == 169 && octets[1] == 254)
                || (octets[0] == 172 && (16..=31).contains(&octets[1]))
                || (octets[0] == 192 && octets[1] == 168)
        }
        std::net::IpAddr::V6(address) => {
            address.is_loopback()
                || address.is_unspecified()
                || (address.segments()[0] & 0xfe00) == 0xfc00
                || (address.segments()[0] & 0xffc0) == 0xfe80
        }
    }
}

fn render_json_map(value: &Value, event: &Value) -> std::collections::BTreeMap<String, Value> {
    value
        .as_object()
        .map(|object| {
            object
                .iter()
                .map(|(key, value)| {
                    let value = value
                        .as_str()
                        .map(|value| Value::String(render_template(value, event)))
                        .unwrap_or_else(|| value.clone());
                    (key.clone(), value)
                })
                .collect()
        })
        .unwrap_or_default()
}

fn render_template(source: &str, event: &Value) -> String {
    let mut rendered = String::with_capacity(source.len());
    let mut rest = source;
    while let Some(start) = rest.find("{{") {
        rendered.push_str(&rest[..start]);
        let expression = &rest[start + 2..];
        let Some(end) = expression.find("}}") else {
            rendered.push_str(&rest[start..]);
            break;
        };
        let path = expression[..end].trim();
        if let Some(value) = read_event_path(event, path) {
            rendered.push_str(&value_to_string(value));
        }
        rest = &expression[end + 2..];
    }
    rendered.push_str(rest);
    rendered
}

fn read_event_path<'a>(event: &'a Value, path: &str) -> Option<&'a Value> {
    let path = path.trim();
    let path = path.strip_prefix("event.").unwrap_or(path);
    let path = path.strip_prefix("event").unwrap_or(path);
    let mut current = event;
    for part in path.trim_matches('.').split('.') {
        if part.is_empty() {
            continue;
        }
        current = current.get(part)?;
    }
    Some(current)
}

fn value_to_string(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(value) => value.clone(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::Array(_) | Value::Object(_) => serde_json::to_string(value).unwrap_or_default(),
    }
}

fn result_type(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

fn as_values(value: &Value) -> Vec<&Value> {
    match value {
        Value::Array(values) => values.iter().collect(),
        value => vec![value],
    }
}

fn sample_automation_event(event_type: &str) -> Value {
    json!({
        "id": "sample-event",
        "type": event_type,
        "timestamp": now_millis(),
        "user": {"uniqueId": "viewer_demo", "nickname": "Viewer Demo", "userId": "1"},
        "data": {"comment": "hello", "giftName": "Rosa", "diamondCount": 1, "count": 1}
    })
}

#[derive(Debug, Clone)]
struct LiveContext {
    unique_id: String,
    room_id: String,
    connection_id: String,
}

#[cfg(feature = "native-tiktok")]
fn clean_unique_id(value: &str) -> Option<String> {
    let value = value.trim().trim_start_matches('@');
    (!value.is_empty()).then_some(value.to_owned())
}

#[cfg(feature = "native-tiktok")]
fn native_user(event: &NativeLiveEvent) -> Option<&tiktools_tiktok::events::EventUser> {
    match event {
        NativeLiveEvent::Chat { user, .. }
        | NativeLiveEvent::Gift { user, .. }
        | NativeLiveEvent::Like { user, .. }
        | NativeLiveEvent::Member { user, .. }
        | NativeLiveEvent::Social { user, .. } => Some(user),
        NativeLiveEvent::RoomUser { .. } | NativeLiveEvent::Unknown { .. } => None,
    }
}

#[cfg(feature = "native-tiktok")]
fn client_event_kind(event: &ClientEvent) -> &'static str {
    match event {
        ClientEvent::Connected(_) => "connected",
        ClientEvent::Event(_) => "live-event",
        ClientEvent::Reconnecting { .. } => "reconnecting",
        ClientEvent::Disconnected { .. } => "disconnected",
        ClientEvent::Error { .. } => "error",
    }
}

#[cfg(feature = "native-tiktok")]
fn user_value(user: &tiktools_tiktok::events::EventUser) -> serde_json::Value {
    json!({
        "userId": user.user_id,
        "uniqueId": clean_unique_id(&user.unique_id).unwrap_or_else(|| "viewer".to_owned()),
        "nickname": user.nickname,
    })
}

#[cfg(feature = "native-tiktok")]
fn creator_value(info: &tiktools_tiktok::ConnectionInfo) -> serde_json::Value {
    json!({
        "uniqueId": info.unique_id,
        "roomId": info.room_id,
        "nickname": info.nickname,
        "avatarUrl": info.avatar_url,
        "title": info.title,
        "lastConnected": now_millis(),
        "connectCount": 1,
        "displayId": info.unique_id,
    })
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    #[derive(Default)]
    struct RecordingEmitter {
        messages: Mutex<Vec<HostMessage>>,
    }

    impl HostEmitter for RecordingEmitter {
        fn emit(&self, message: HostMessage) {
            self.messages
                .lock()
                .expect("test emitter poisoned")
                .push(message);
        }
    }

    #[tokio::test]
    async fn native_event_runner_executes_saved_behavior() {
        let emitter = Arc::new(RecordingEmitter::default());
        let core = Arc::new(AppCore::new(emitter.clone()));
        core.automation.replace_snapshot(&json!({
            "actions": [{
                "id": "say-hello",
                "name": "Say hello",
                "typeId": "core.log",
                "enabled": true,
                "config": {"message": "hello {{ event.user.uniqueId }}"}
            }],
            "events": [{
                "id": "chat-event",
                "name": "Chat event",
                "enabled": true,
                "trigger": "tiktok.chat",
                "filters": [],
                "cooldownMs": 0,
                "cooldownScope": "user",
                "actionIds": ["say-hello"],
                "runMode": "all"
            }]
        }));

        core.publish_automation_event(json!({
            "id": "chat-1",
            "type": "tiktok.chat",
            "timestamp": 1,
            "user": {"uniqueId": "alice"},
            "data": {"comment": "hello"}
        }))
        .await;

        let runs = core.automation.recent_runs();
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0]["status"], "ok");
        assert_eq!(runs[0]["eventId"], "chat-event");
        assert_eq!(runs[0]["summary"], "hello alice");
        assert!(emitter
            .messages
            .lock()
            .expect("test emitter poisoned")
            .iter()
            .any(|message| matches!(message, HostMessage::BehaviorRuns { .. })));
    }

    #[cfg(feature = "native-tiktok")]
    #[tokio::test]
    async fn native_live_event_reaches_the_host_message_boundary() {
        let emitter = Arc::new(RecordingEmitter::default());
        let core = Arc::new(AppCore::new(emitter.clone()));
        core.handle_native_event(ClientEvent::Event(NativeLiveEvent::Chat {
            user: tiktools_tiktok::events::EventUser {
                user_id: Some("42".to_owned()),
                unique_id: "alice".to_owned(),
                nickname: "Alice".to_owned(),
                sec_uid: String::new(),
            },
            comment: "hello".to_owned(),
            method: "WebcastChatMessage".to_owned(),
            msg_id: 1,
            is_history: false,
        }))
        .await;

        let messages = emitter.messages.lock().expect("test emitter poisoned");
        assert!(messages.iter().any(|message| {
            matches!(
                message,
                HostMessage::LiveEvent { event }
                    if event.get("kind").and_then(Value::as_str) == Some("chat")
            )
        }));
        assert!(messages
            .iter()
            .any(|message| matches!(message, HostMessage::Leaderboard { .. })));
    }
}
