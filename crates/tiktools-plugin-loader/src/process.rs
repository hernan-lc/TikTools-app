//! Framed process runtime for crash-sensitive standalone plugins.

use std::{
    env, fs,
    io::{BufReader, BufWriter},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::mpsc,
    time::Duration,
};

use serde_json::Value;
use tiktools_plugin_api::{
    read_frame, write_frame, FrameError, PluginManifest, PluginRequest, PluginResponse,
    PluginRuntimeKind, TIKTOOLS_PLUGIN_PROTOCOL_VERSION,
};

use crate::{PluginInstance, PluginLoaderError, PluginRuntime};

const PROCESS_CALL_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Default)]
pub struct ProcessPluginRuntime;

impl PluginRuntime for ProcessPluginRuntime {
    fn kind(&self) -> PluginRuntimeKind {
        PluginRuntimeKind::Process
    }

    fn load(
        &self,
        manifest: &PluginManifest,
        directory: &Path,
    ) -> Result<Box<dyn PluginInstance>, PluginLoaderError> {
        let entry = manifest.entry.as_str();
        let package_root = fs::canonicalize(directory).map_err(|error| {
            PluginLoaderError::Runtime(format!(
                "could not resolve plugin directory {}: {error}",
                directory.display()
            ))
        })?;
        let entry_path = fs::canonicalize(directory.join(entry)).map_err(|error| {
            PluginLoaderError::Runtime(format!("could not resolve plugin entry {entry}: {error}"))
        })?;
        if !entry_path.starts_with(&package_root) {
            return Err(PluginLoaderError::Runtime(format!(
                "plugin entry escapes its package directory: {entry}"
            )));
        }
        if !entry_path.is_file() {
            return Err(PluginLoaderError::Runtime(format!(
                "entry does not exist: {entry}"
            )));
        }

        let (program, args) = process_command(&entry_path)?;
        let data_directory = env::var_os("TIKTOOLS_PLUGIN_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| directory.join(".data"));
        let storage_file = env::var_os("TIKTOOLS_PLUGIN_STORAGE_FILE")
            .map(PathBuf::from)
            .unwrap_or_else(|| data_directory.join("storage.json"));
        let mut command = Command::new(program);
        command
            .args(args)
            .current_dir(&package_root)
            // A process plugin is still trusted executable code, but it does
            // not need the host's complete environment. Only the explicit
            // plugin contract is passed across this boundary.
            .env_clear()
            .env("TIKTOOLS_PLUGIN_ID", &manifest.id)
            .env("TIKTOOLS_PLUGIN_VERSION", &manifest.version)
            .env("TIKTOOLS_PLUGIN_DIRECTORY", &package_root)
            .env("TIKTOOLS_PLUGIN_DATA_DIR", data_directory)
            .env("TIKTOOLS_PLUGIN_STORAGE_FILE", storage_file)
            .env(
                "TIKTOOLS_PLUGIN_PERMISSIONS",
                manifest.permissions.join(","),
            )
            .env(
                "TIKTOOLS_PLUGIN_CAPABILITIES",
                manifest.capabilities.join(","),
            )
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());
        let mut child = command.spawn().map_err(|error| {
            PluginLoaderError::Runtime(format!("could not start plugin host: {error}"))
        })?;
        let stdin = child.stdin.take().ok_or_else(|| {
            PluginLoaderError::Runtime("plugin stdin was not available".to_owned())
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            PluginLoaderError::Runtime("plugin stdout was not available".to_owned())
        })?;
        Ok(Box::new(ProcessPluginInstance {
            id: manifest.id.clone(),
            child,
            stdin: Some(BufWriter::new(stdin)),
            stdout: Some(BufReader::new(stdout)),
            next_request_id: 0,
        }))
    }
}

fn process_command(entry: &Path) -> Result<(PathBuf, Vec<String>), PluginLoaderError> {
    let extension = entry
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if matches!(
        extension.to_ascii_lowercase().as_str(),
        "js" | "mjs" | "cjs" | "ts"
    ) {
        return Err(PluginLoaderError::RuntimeUnavailable(
            "JavaScript plugin entries are not executable processes; migrate them to the Rust plugin ABI or a standalone executable".to_owned(),
        ));
    }
    Ok((entry.to_owned(), Vec::new()))
}

struct ProcessPluginInstance {
    id: String,
    child: Child,
    stdin: Option<BufWriter<ChildStdin>>,
    stdout: Option<BufReader<ChildStdout>>,
    next_request_id: u64,
}

impl ProcessPluginInstance {
    fn handle_message_with_timeout(
        &mut self,
        request: &[u8],
        timeout: Duration,
    ) -> Result<Vec<u8>, PluginLoaderError> {
        let payload: Value = serde_json::from_slice(request).map_err(|error| {
            PluginLoaderError::Runtime(format!("invalid process request JSON: {error}"))
        })?;
        let request_id = self.next_request_id.to_string();
        self.next_request_id = self.next_request_id.saturating_add(1);
        let message = PluginRequest::new(request_id.clone(), "call", payload);
        let mut stdin = self.stdin.take().ok_or_else(|| {
            PluginLoaderError::Runtime("plugin process stdin is unavailable".to_owned())
        })?;
        let mut stdout = self.stdout.take().ok_or_else(|| {
            PluginLoaderError::Runtime("plugin process stdout is unavailable".to_owned())
        })?;
        let (sender, receiver) = mpsc::sync_channel(1);
        std::thread::spawn(move || {
            let result = write_frame(&mut stdin, &message).and_then(|_| read_frame(&mut stdout));
            let _ = sender.send((result, stdin, stdout));
        });
        let (result, stdin, stdout) = match wait_for_io(receiver, timeout) {
            Ok(result) => result,
            Err(ProcessIoWaitError::Timeout) => {
                self.terminate_child();
                return Err(PluginLoaderError::Runtime(format!(
                    "plugin process call timed out after {} seconds",
                    timeout.as_secs()
                )));
            }
            Err(ProcessIoWaitError::Disconnected) => {
                self.terminate_child();
                return Err(PluginLoaderError::Runtime(
                    "plugin process I/O worker stopped unexpectedly".to_owned(),
                ));
            }
        };
        self.stdin = Some(stdin);
        self.stdout = Some(stdout);
        decode_process_response(result, &request_id)
    }

    fn terminate_child(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl PluginInstance for ProcessPluginInstance {
    fn id(&self) -> &str {
        &self.id
    }

    fn handle_message(&mut self, request: &[u8]) -> Result<Vec<u8>, PluginLoaderError> {
        self.handle_message_with_timeout(request, PROCESS_CALL_TIMEOUT)
    }

    fn shutdown(&mut self) -> Result<(), PluginLoaderError> {
        self.stdin.take();
        self.stdout.take();
        self.terminate_child();
        Ok(())
    }
}

#[derive(Debug)]
enum ProcessIoWaitError {
    Timeout,
    Disconnected,
}

fn wait_for_io<T>(receiver: mpsc::Receiver<T>, timeout: Duration) -> Result<T, ProcessIoWaitError> {
    match receiver.recv_timeout(timeout) {
        Ok(value) => Ok(value),
        Err(mpsc::RecvTimeoutError::Timeout) => Err(ProcessIoWaitError::Timeout),
        Err(mpsc::RecvTimeoutError::Disconnected) => Err(ProcessIoWaitError::Disconnected),
    }
}

fn decode_process_response(
    result: Result<PluginResponse, FrameError>,
    request_id: &str,
) -> Result<Vec<u8>, PluginLoaderError> {
    let response = result.map_err(|error| PluginLoaderError::Runtime(error.to_string()))?;
    if response.protocol_version != TIKTOOLS_PLUGIN_PROTOCOL_VERSION {
        return Err(PluginLoaderError::Runtime(format!(
            "plugin process protocol mismatch: {}",
            response.protocol_version
        )));
    }
    if response.id != request_id {
        return Err(PluginLoaderError::Runtime(
            "plugin process returned a response for a different request".to_owned(),
        ));
    }
    if !response.ok {
        return Err(PluginLoaderError::Runtime(
            response
                .error
                .unwrap_or_else(|| "plugin process rejected request".to_owned()),
        ));
    }
    serde_json::to_vec(&response.result.unwrap_or(Value::Null))
        .map_err(|error| PluginLoaderError::Runtime(error.to_string()))
}

#[cfg(test)]
mod tests {
    use std::process::Command;

    use super::*;

    fn response(id: &str) -> PluginResponse {
        PluginResponse {
            protocol_version: TIKTOOLS_PLUGIN_PROTOCOL_VERSION,
            id: id.to_owned(),
            ok: true,
            result: Some(serde_json::json!({"accepted": true})),
            error: None,
        }
    }

    #[test]
    fn accepts_successful_response() {
        let bytes = decode_process_response(Ok(response("request-1")), "request-1").unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&bytes).unwrap(),
            serde_json::json!({"accepted": true})
        );
    }

    #[test]
    fn rejects_response_with_wrong_request_id() {
        let error = decode_process_response(Ok(response("other")), "request-1").unwrap_err();
        assert!(error.to_string().contains("different request"));
    }

    #[test]
    fn rejects_protocol_mismatch() {
        let mut response = response("request-1");
        response.protocol_version += 1;
        let error = decode_process_response(Ok(response), "request-1").unwrap_err();
        assert!(error.to_string().contains("protocol mismatch"));
    }

    #[test]
    fn rejects_invalid_json_from_process() {
        let json_error = serde_json::from_str::<PluginResponse>("not json").unwrap_err();
        let error =
            decode_process_response(Err(FrameError::Json(json_error)), "request-1").unwrap_err();
        assert!(error.to_string().contains("not valid JSON"));
    }

    #[test]
    fn reports_io_timeout_without_waiting_for_a_child() {
        let (_sender, receiver) = mpsc::sync_channel::<()>(1);
        let error = wait_for_io(receiver, Duration::from_millis(1)).unwrap_err();
        assert!(matches!(error, ProcessIoWaitError::Timeout));
    }

    #[test]
    fn terminated_child_can_be_reaped_after_failure() {
        let child = if cfg!(windows) {
            Command::new("cmd")
                .args(["/C", "ping -n 30 127.0.0.1 > NUL"])
                .spawn()
                .unwrap()
        } else {
            Command::new("sh").args(["-c", "sleep 30"]).spawn().unwrap()
        };
        let mut instance = ProcessPluginInstance {
            id: "test".to_owned(),
            child,
            stdin: None,
            stdout: None,
            next_request_id: 0,
        };
        instance.terminate_child();
        assert!(instance.child.try_wait().unwrap().is_some());
    }
}
