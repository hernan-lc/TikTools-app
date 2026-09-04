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
use tiktools_plugin_api::{
    AudioPlayOptions, AudioPlaybackResult, MediaFileRef, MediaPickerOptions, MediaSelection,
};
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
        builtin_action_types, builtin_node_catalog, builtin_translations,
        media_selection_from_path_with_kind, validate_audio_file_ref,
        validate_media_picker_options, AppStateService, AutomationService, AwardOptions,
        CapabilityBroker, LiveService, PointAction, PointsService,
    },
};

pub use services::{
    MediaApiError, MediaError, MediaHost, MediaHostError, MediaHostFuture, NoopMediaHost,
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
    pub media: Arc<dyn MediaHost>,
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
        Self::with_media_host(emitter, Arc::new(NoopMediaHost))
    }

    /// Builds the core with an explicit native capability implementation.
    /// The desktop crate supplies this for file dialogs and audio output;
    /// headless callers can keep using [`AppCore::new`].
    pub fn with_media_host(emitter: Arc<dyn HostEmitter>, media: Arc<dyn MediaHost>) -> Self {
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
            media,
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

    /// Opens the host-owned native picker and returns a validated reference to
    /// the existing file/directory. The result contains metadata and a
    /// canonical path only; the host never copies the selected bytes.
    pub async fn open_media_picker(
        &self,
        options: MediaPickerOptions,
    ) -> Result<Option<MediaSelection>, MediaApiError> {
        validate_media_picker_options(&options)?;
        let mode = options.mode;
        let kind = options.kind;
        let path = self.media.open_picker(options).await?;
        path.map(|path| media_selection_from_path_with_kind(&path, mode, kind))
            .transpose()
            .map_err(MediaApiError::from)
    }

    /// Validates a media reference immediately before playback and then hands
    /// the canonical path to the desktop audio backend. This is the only core
    /// entry point used by automation and runtime plugins for local audio.
    pub async fn play_audio(
        &self,
        file: MediaFileRef,
        options: AudioPlayOptions,
    ) -> Result<AudioPlaybackResult, MediaApiError> {
        if !options.volume.is_finite() {
            return Err(MediaApiError::Validation(MediaError::InvalidOption(
                "volume",
            )));
        }
        let file = validate_audio_file_ref(&file, self.db.paths().data.as_path())?;
        self.media
            .play_audio(
                file,
                AudioPlayOptions {
                    volume: options.volume.clamp(0.0, 1.0),
                    ..options
                },
            )
            .await
            .map_err(MediaApiError::from)
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
