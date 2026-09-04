#![forbid(unsafe_code)]

use std::io::{self, BufReader, BufWriter};

use serde_json::{json, Map, Value};
use tiktools_plugin_api::{
    read_frame, write_frame, FrameError, PluginRequest, PluginResponse, METHOD_CALL,
    TIKTOOLS_PLUGIN_PROTOCOL_VERSION,
};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = BufReader::new(stdin.lock());
    let mut writer = BufWriter::new(stdout.lock());

    loop {
        let request = match read_frame::<_, PluginRequest>(&mut reader) {
            Ok(request) => request,
            Err(FrameError::Io(error)) if error.kind() == io::ErrorKind::UnexpectedEof => break,
            Err(error) => return Err(error.into()),
        };
        let response = handle(request);
        write_frame(&mut writer, &response)?;
    }
    Ok(())
}

fn handle(request: PluginRequest) -> PluginResponse {
    if request.protocol_version != TIKTOOLS_PLUGIN_PROTOCOL_VERSION {
        return failure(
            request.id,
            format!("unsupported protocol version {}", request.protocol_version),
        );
    }
    if request.method != METHOD_CALL {
        return failure(request.id, format!("unsupported method `{}`", request.method));
    }

    let Some(action) = request.payload.get("action").and_then(Value::as_object) else {
        return failure(request.id, "action payload is missing".to_owned());
    };
    let Some(config) = action.get("config").and_then(Value::as_object) else {
        return failure(request.id, "action config is missing".to_owned());
    };
    let Some(file_ref) = file_reference(config) else {
        return failure(request.id, "audio action has no file reference".to_owned());
    };

    let mut intent = Map::new();
    intent.insert("fileRef".to_owned(), file_ref);
    if let Some(volume) = config.get("volume") {
        intent.insert("volume".to_owned(), volume.clone());
    }
    if let Some(overlap) = config.get("overlap") {
        intent.insert("overlap".to_owned(), overlap.clone());
    }

    PluginResponse {
        protocol_version: TIKTOOLS_PLUGIN_PROTOCOL_VERSION,
        id: request.id,
        ok: true,
        result: Some(json!({
            "summary": "requested host audio playback",
            "playAudio": Value::Object(intent)
        })),
        error: None,
    }
}

fn file_reference(config: &Map<String, Value>) -> Option<Value> {
    ["fileRef", "filePath", "file", "path"]
        .into_iter()
        .find_map(|key| config.get(key))
        .and_then(|value| {
            if value.is_string() {
                Some(json!({"path": value}))
            } else if value.is_object() {
                Some(value.clone())
            } else {
                None
            }
        })
}

fn failure(id: String, error: String) -> PluginResponse {
    PluginResponse {
        protocol_version: TIKTOOLS_PLUGIN_PROTOCOL_VERSION,
        id,
        ok: false,
        result: None,
        error: Some(error),
    }
}
