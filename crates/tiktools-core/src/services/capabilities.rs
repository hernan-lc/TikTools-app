//! Explicit host capability checks for runtime plugins.
//!
//! This broker is the policy boundary for process/WASM plugins. Trusted
//! native plugins can still call OS APIs directly, so their manifest entries
//! document intent and the host API remains the enforceable surface.

use std::{collections::BTreeMap, fs, io, path::PathBuf};

use serde_json::Value;
use thiserror::Error;
use tiktools_plugin_api::{
    capabilities::{declares_capability, declares_permission},
    manifest::is_valid_plugin_id,
    PluginManifest,
};

#[derive(Debug, Error)]
pub enum CapabilityError {
    #[error("plugin `{plugin_id}` is not permitted to use `{requested}`")]
    PermissionDenied {
        plugin_id: String,
        requested: String,
    },
    #[error("plugin `{plugin_id}` does not declare capability `{requested}`")]
    CapabilityUndeclared {
        plugin_id: String,
        requested: String,
    },
    #[error("invalid plugin id for capability storage: {0}")]
    InvalidPluginId(String),
    #[error("could not create plugin capability directory: {0}")]
    Io(#[from] io::Error),
}

#[derive(Debug, Clone)]
pub struct CapabilityBroker {
    plugin_data_root: PathBuf,
}

impl CapabilityBroker {
    pub fn new(plugin_data_root: PathBuf) -> Self {
        Self { plugin_data_root }
    }

    pub fn plugin_data_root(&self) -> &PathBuf {
        &self.plugin_data_root
    }

    pub fn require_permission(
        &self,
        manifest: &PluginManifest,
        requested: &str,
    ) -> Result<(), CapabilityError> {
        if declares_permission(manifest, requested) {
            return Ok(());
        }
        Err(CapabilityError::PermissionDenied {
            plugin_id: manifest.id.clone(),
            requested: requested.to_owned(),
        })
    }

    pub fn require_capability(
        &self,
        manifest: &PluginManifest,
        requested: &str,
    ) -> Result<(), CapabilityError> {
        if declares_capability(manifest, requested) {
            return Ok(());
        }
        Err(CapabilityError::CapabilityUndeclared {
            plugin_id: manifest.id.clone(),
            requested: requested.to_owned(),
        })
    }

    pub fn ensure_plugin_data_dir(
        &self,
        manifest: &PluginManifest,
    ) -> Result<PathBuf, CapabilityError> {
        if !is_valid_plugin_id(&manifest.id) {
            return Err(CapabilityError::InvalidPluginId(manifest.id.clone()));
        }
        let directory = self.plugin_data_root.join(&manifest.id);
        fs::create_dir_all(&directory)?;
        Ok(directory)
    }

    pub fn load_plugin_settings(
        &self,
        manifest: &PluginManifest,
    ) -> Result<Value, CapabilityError> {
        let path = self.ensure_plugin_data_dir(manifest)?.join("settings.json");
        match fs::read_to_string(path) {
            Ok(value) => {
                Ok(serde_json::from_str(&value)
                    .unwrap_or_else(|_| Value::Object(Default::default())))
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                Ok(Value::Object(Default::default()))
            }
            Err(error) => Err(CapabilityError::Io(error)),
        }
    }

    pub fn save_plugin_settings(
        &self,
        manifest: &PluginManifest,
        values: &BTreeMap<String, Value>,
    ) -> Result<Value, CapabilityError> {
        let directory = self.ensure_plugin_data_dir(manifest)?;
        let path = directory.join("settings.json");
        let temporary = directory.join("settings.json.tmp");
        let payload = serde_json::to_vec(values).map_err(|error| {
            CapabilityError::Io(io::Error::new(io::ErrorKind::InvalidData, error))
        })?;
        fs::write(&temporary, payload)?;
        fs::rename(&temporary, &path)?;
        Ok(Value::Object(values.clone().into_iter().collect()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest() -> PluginManifest {
        PluginManifest::from_json_str(
            r#"{
                "schemaVersion": 2,
                "id": "demo.plugin",
                "name": "Demo",
                "version": "1.0.0",
                "runtime": "process",
                "entry": "index.js",
                "capabilities": ["audio.play"],
                "permissions": ["audio.output"]
            }"#,
        )
        .unwrap()
    }

    #[test]
    fn enforces_declared_capabilities_and_permissions() {
        let broker = CapabilityBroker::new(std::env::temp_dir());
        let manifest = manifest();
        assert!(broker.require_capability(&manifest, "audio.play").is_ok());
        assert!(broker.require_permission(&manifest, "audio.output").is_ok());
        assert!(broker.require_permission(&manifest, "http").is_err());
    }
}
