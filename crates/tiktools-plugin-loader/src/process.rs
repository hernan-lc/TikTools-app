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
    read_frame, write_frame, PluginManifest, PluginRequest, PluginResponse, PluginRuntimeKind,
    TIKTOOLS_PLUGIN_PROTOCOL_VERSION,
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
        let (result, stdin, stdout) = match receiver.recv_timeout(PROCESS_CALL_TIMEOUT) {
            Ok(result) => result,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                self.terminate_child();
                return Err(PluginLoaderError::Runtime(format!(
                    "plugin process call timed out after {} seconds",
                    PROCESS_CALL_TIMEOUT.as_secs()
                )));
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                self.terminate_child();
                return Err(PluginLoaderError::Runtime(
                    "plugin process I/O worker stopped unexpectedly".to_owned(),
                ));
            }
        };
        self.stdin = Some(stdin);
        self.stdout = Some(stdout);
        let response: PluginResponse =
            result.map_err(|error| PluginLoaderError::Runtime(error.to_string()))?;
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

    fn shutdown(&mut self) -> Result<(), PluginLoaderError> {
        self.stdin.take();
        self.stdout.take();
        self.terminate_child();
        Ok(())
    }
}
