//! Optional WASM runtime boundary.
//!
//! The discovery/API surface is present from the first migration milestone,
//! but the WASM engine is deliberately opt-in. This keeps normal core and
//! desktop iteration free of Wasmtime/Extism compilation. The feature is the
//! place to add the chosen engine and capability imports without changing the
//! host/plugin protocol.

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
