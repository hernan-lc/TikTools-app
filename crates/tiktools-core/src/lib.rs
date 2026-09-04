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

mod automation_runtime;
mod helpers;
mod ipc_handlers;
mod live_events;
mod persistence;
#[cfg(test)]
mod tests;

pub(crate) use helpers::*;

use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, RwLock,
    },
    time::{SystemTime, UNIX_EPOCH},
};

#[cfg(feature = "native-tiktok")]
use std::sync::atomic::AtomicBool;

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

    pub(crate) fn next_sequence(&self) -> u64 {
        self.automation_sequence.fetch_add(1, Ordering::AcqRel) + 1
    }

    pub async fn shutdown(self: &Arc<Self>) {
        self.events.publish(AppEvent::Shutdown);
        self.publish_disconnected_event().await;
        self.live.disconnect().await;
        self.plugins.stop_all();
    }
}
