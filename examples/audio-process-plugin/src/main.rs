#![forbid(unsafe_code)]
// Release plugin executables must not allocate a console on Windows; the
// host launches them with CREATE_NO_WINDOW and talks over piped stdio.
#![cfg_attr(
    all(target_os = "windows", not(debug_assertions)),
    windows_subsystem = "windows"
)]

use serde_json::{Map, Value};
use tiktools_plugin_sdk::prelude::*;

#[derive(Default)]
struct AudioPlugin;

impl Plugin for AudioPlugin {
    fn action(
        &mut self,
        _context: &PluginContext,
        call: ActionCall,
    ) -> PluginResult<ActionResult> {
        let file_ref = file_reference(call.config())
            .ok_or_else(|| PluginError::invalid_request("audio action has no file reference"))?;
        let file_ref = if let Some(path) = file_ref.as_str() {
            MediaFileRef::from_path(path)
        } else {
            serde_json::from_value(file_ref).map_err(|error| {
                PluginError::invalid_request(format!("invalid audio file reference: {error}"))
            })?
        };
        let mut intent = AudioPlayIntent::new(file_ref);
        if let Some(volume) = call.config().get("volume").and_then(number) {
            intent = intent.volume(volume);
        }
        if let Some(overlap) = call.config().get("overlap").and_then(Value::as_str) {
            intent = intent.overlap(match overlap {
                "restart" => AudioOverlap::Restart,
                "drop" => AudioOverlap::Drop,
                _ => AudioOverlap::Allow,
            });
        }
        Ok(ActionResult::summary("requested host audio playback")
            .intent(HostIntent::audio_play(intent)))
    }
}

fn file_reference(config: &Map<String, Value>) -> Option<Value> {
    ["fileRef", "filePath", "file", "path"]
        .into_iter()
        .find_map(|key| config.get(key))
        .and_then(|value| (value.is_string() || value.is_object()).then(|| value.clone()))
}

fn number(value: &Value) -> Option<f32> {
    match value {
        Value::Number(value) => value.as_f64().map(|value| value as f32),
        Value::String(value) => value.parse().ok(),
        _ => None,
    }
}

tiktools_process_plugin!(AudioPlugin);
