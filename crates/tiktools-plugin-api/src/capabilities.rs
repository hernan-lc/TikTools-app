//! Names and matching helpers for host capabilities.

use crate::manifest::PluginManifest;

pub const HTTP: &str = "http";
pub const AUDIO: &str = "audio";
pub const AUDIO_PLAY: &str = "audio.play";
pub const AUDIO_OUTPUT_PERMISSION: &str = "audio.output";
pub const MEDIA_PICK: &str = "media.pick";
pub const MEDIA_READ: &str = "media.read";
pub const TTS: &str = "tts";
pub const POINTS_READ: &str = "points.read";
pub const POINTS_WRITE: &str = "points.write";
pub const STORAGE: &str = "storage";
/// Lets a plugin publish its own declared event types (hotkeys, timers).
pub const EVENTS_PUBLISH: &str = "events.publish";
pub const APP_STATE: &str = "app.state";

/// Returns true when a manifest explicitly declares a capability or a
/// documented wildcard covering it. This is enforceable for process/WASM
/// runtimes; native plugins remain trusted code.
pub fn declares_capability(manifest: &PluginManifest, requested: &str) -> bool {
    manifest
        .capabilities
        .iter()
        .any(|declared| capability_matches(declared, requested))
}

pub fn declares_permission(manifest: &PluginManifest, requested: &str) -> bool {
    manifest
        .permissions
        .iter()
        .any(|declared| capability_matches(declared, requested))
}

pub fn capability_matches(declared: &str, requested: &str) -> bool {
    declared == "*"
        || declared == requested
        || (declared.ends_with(".*") && requested.starts_with(declared.trim_end_matches('*')))
}
