//! Optional WASM runtime boundary.
//!
//! The discovery/API surface is present from the first migration milestone,
//! but the WASM engine is deliberately opt-in. This keeps normal core and
//! desktop iteration free of Wasmtime/Extism compilation. When implemented,
//! the adapter should target the WASM Component Model with capability-oriented
//! WASI Preview 2 / WASI 0.2-style interfaces and explicit TikTools imports,
//! rather than coupling the SDK to WASI Preview 1 file descriptors.

use std::path::Path;

use tiktools_plugin_api::{PluginManifest, PluginRuntimeKind};

use crate::{PluginInstance, PluginLoaderError, PluginRuntime};

#[derive(Default)]
pub struct WasmPluginRuntime;

impl PluginRuntime for WasmPluginRuntime {
    fn kind(&self) -> PluginRuntimeKind {
        PluginRuntimeKind::Wasm
    }

    fn load(
        &self,
        _manifest: &PluginManifest,
        _directory: &Path,
    ) -> Result<Box<dyn PluginInstance>, PluginLoaderError> {
        Err(PluginLoaderError::RuntimeUnavailable(
            "WASM runtime is optional and is not enabled in this build".to_owned(),
        ))
    }
}
