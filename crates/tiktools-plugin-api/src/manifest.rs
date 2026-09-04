//! Versioned, runtime-neutral plugin manifests.
//!
//! The host only accepts the native schema. There is no compatibility parser
//! for the removed TypeScript plugin format: a package must declare its
//! runtime and entry explicitly before it can be discovered.

use std::fmt;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use thiserror::Error;

use crate::{TIKTOOLS_PLUGIN_ABI_VERSION, TIKTOOLS_PLUGIN_PROTOCOL_VERSION};

const PLUGIN_SCHEMA_VERSION: u32 = 2;
const MAX_MANIFEST_BYTES: usize = 256 * 1024;
const MAX_LIST_ENTRIES: usize = 128;
const MAX_DESCRIPTOR_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PluginRuntimeKind {
    Native,
    Wasm,
    Process,
}

impl PluginRuntimeKind {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "native" => Some(Self::Native),
            "wasm" => Some(Self::Wasm),
            "process" => Some(Self::Process),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum PluginTrust {
    #[default]
    Trusted,
    Sandboxed,
    Untrusted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PluginManifest {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub runtime: PluginRuntimeKind,
    pub entry: String,
    pub trust: PluginTrust,
    pub capabilities: Vec<String>,
    pub permissions: Vec<String>,
    pub protocol_version: u32,
    pub abi_version: Option<u32>,
    pub targets: Vec<String>,
    /// JSON action descriptors exposed by the plugin, if any.
    pub action_types: Vec<Value>,
    /// Host-rendered settings schema, kept as data and never executed.
    pub settings_schema: Option<Value>,
    pub settings_ui_hints: Option<Value>,
}

#[derive(Debug, Error)]
pub enum ManifestError {
    #[error("plugin manifest is not valid JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("plugin manifest must be a JSON object")]
    NotAnObject,
    #[error("plugin manifest has unsupported schema version {0}")]
    UnsupportedSchema(u32),
    #[error("plugin manifest field `{0}` is missing or invalid")]
    MissingField(&'static str),
    #[error("plugin manifest field `{0}` is invalid")]
    InvalidField(&'static str),
    #[error("plugin manifest entry must stay inside its package")]
    UnsafeEntry,
    #[error("plugin manifest is larger than {MAX_MANIFEST_BYTES} bytes")]
    TooLarge,
}

impl PluginManifest {
    pub fn from_json_str(input: &str) -> Result<Self, ManifestError> {
        if input.len() > MAX_MANIFEST_BYTES {
            return Err(ManifestError::TooLarge);
        }
        let value: Value = serde_json::from_str(input)?;
        Self::from_value(value)
    }

    pub fn from_value(value: Value) -> Result<Self, ManifestError> {
        let object = value.as_object().ok_or(ManifestError::NotAnObject)?;
        let schema_version =
            number(object, "schemaVersion").ok_or(ManifestError::MissingField("schemaVersion"))?;
        if schema_version != PLUGIN_SCHEMA_VERSION {
            return Err(ManifestError::UnsupportedSchema(schema_version));
        }

        let id = required_string(object, "id")?;
        if !is_valid_plugin_id(&id) {
            return Err(ManifestError::InvalidField("id"));
        }
        let name = required_string(object, "name")?;
        if name.trim().is_empty() || name.len() > 256 {
            return Err(ManifestError::InvalidField("name"));
        }
        let version = required_string(object, "version")?;
        if version.trim().is_empty()
            || version.len() > 128
            || version.chars().any(char::is_whitespace)
        {
            return Err(ManifestError::InvalidField("version"));
        }
        let description = optional_string(object, "description");
        if description
            .as_deref()
            .is_some_and(|value| value.len() > 4_096)
        {
            return Err(ManifestError::InvalidField("description"));
        }

        let entry = required_string(object, "entry")?;
        if !is_safe_relative_path(&entry) {
            return Err(ManifestError::UnsafeEntry);
        }
        let runtime = optional_string(object, "runtime")
            .and_then(|value| PluginRuntimeKind::parse(&value))
            .ok_or(ManifestError::MissingField("runtime"))?;

        let default_trust = if runtime == PluginRuntimeKind::Native {
            PluginTrust::Trusted
        } else {
            PluginTrust::Sandboxed
        };
        let trust = match optional_string(object, "trust") {
            None => default_trust,
            Some(value) => match value.as_str() {
                "trusted" => PluginTrust::Trusted,
                "sandboxed" => PluginTrust::Sandboxed,
                "untrusted" => PluginTrust::Untrusted,
                _ => return Err(ManifestError::InvalidField("trust")),
            },
        };

        let capabilities = string_list(object, "capabilities")?;
        let permissions = string_list(object, "permissions")?;
        let targets = string_list(object, "targets")?;
        let protocol_version =
            number(object, "protocolVersion").unwrap_or(TIKTOOLS_PLUGIN_PROTOCOL_VERSION);
        let abi_version = number(object, "abiVersion");
        if protocol_version == 0 {
            return Err(ManifestError::InvalidField("protocolVersion"));
        }
        if runtime == PluginRuntimeKind::Native && abi_version.is_some_and(|version| version == 0) {
            return Err(ManifestError::InvalidField("abiVersion"));
        }

        let action_types = json_list(object, "actionTypes")?;
        let (settings_schema, settings_ui_hints) = settings(object)?;

        Ok(Self {
            schema_version,
            id,
            name,
            version,
            description,
            runtime,
            entry,
            trust,
            capabilities,
            permissions,
            protocol_version,
            abi_version,
            targets,
            action_types,
            settings_schema,
            settings_ui_hints,
        })
    }

    pub fn validate_compatibility(&self) -> Result<(), ManifestError> {
        if self.schema_version != PLUGIN_SCHEMA_VERSION {
            return Err(ManifestError::UnsupportedSchema(self.schema_version));
        }
        if self.protocol_version != TIKTOOLS_PLUGIN_PROTOCOL_VERSION {
            return Err(ManifestError::InvalidField("protocolVersion"));
        }
        if self.runtime == PluginRuntimeKind::Native
            && self
                .abi_version
                .is_some_and(|version| version != TIKTOOLS_PLUGIN_ABI_VERSION)
        {
            return Err(ManifestError::InvalidField("abiVersion"));
        }
        Ok(())
    }

    pub fn target_matches_current_platform(&self) -> bool {
        if self.targets.is_empty() {
            return true;
        }
        let target = current_target();
        let platform = current_platform();
        self.targets
            .iter()
            .any(|candidate| candidate == &target || candidate == &platform)
    }
}

impl fmt::Display for PluginRuntimeKind {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Native => "native",
            Self::Wasm => "wasm",
            Self::Process => "process",
        })
    }
}

fn required_string(
    object: &Map<String, Value>,
    key: &'static str,
) -> Result<String, ManifestError> {
    optional_string(object, key).ok_or(ManifestError::MissingField(key))
}

fn optional_string(object: &Map<String, Value>, key: &str) -> Option<String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

fn number(object: &Map<String, Value>, key: &str) -> Option<u32> {
    object
        .get(key)
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
}

fn string_list(
    object: &Map<String, Value>,
    key: &'static str,
) -> Result<Vec<String>, ManifestError> {
    object
        .get(key)
        .map(|value| string_list_value(value, key))
        .transpose()
        .map(|value| value.unwrap_or_default())
}

fn string_list_value(value: &Value, key: &'static str) -> Result<Vec<String>, ManifestError> {
    let entries = value.as_array().ok_or(ManifestError::InvalidField(key))?;
    if entries.len() > MAX_LIST_ENTRIES {
        return Err(ManifestError::InvalidField(key));
    }
    entries
        .iter()
        .map(|entry| {
            let value = entry.as_str().ok_or(ManifestError::InvalidField(key))?;
            if value.is_empty() || value.len() > 256 || value.chars().any(char::is_whitespace) {
                return Err(ManifestError::InvalidField(key));
            }
            Ok(value.to_owned())
        })
        .collect()
}

fn json_list(object: &Map<String, Value>, key: &'static str) -> Result<Vec<Value>, ManifestError> {
    let Some(value) = object.get(key) else {
        return Ok(Vec::new());
    };
    let entries = value.as_array().ok_or(ManifestError::InvalidField(key))?;
    if entries.len() > MAX_LIST_ENTRIES
        || entries.iter().any(|entry| {
            serde_json::to_vec(entry)
                .map(|bytes| bytes.len() > MAX_DESCRIPTOR_BYTES)
                .unwrap_or(true)
        })
    {
        return Err(ManifestError::InvalidField(key));
    }
    Ok(entries.clone())
}

fn settings(object: &Map<String, Value>) -> Result<(Option<Value>, Option<Value>), ManifestError> {
    let Some(settings) = object.get("settings") else {
        return Ok((None, None));
    };
    let settings = settings
        .as_object()
        .ok_or(ManifestError::InvalidField("settings"))?;
    let schema = settings.get("schema").cloned();
    let ui_hints = settings.get("uiHints").cloned();
    if schema.as_ref().is_some_and(|value| !value.is_object())
        || ui_hints.as_ref().is_some_and(|value| !value.is_object())
    {
        return Err(ManifestError::InvalidField("settings"));
    }
    for value in [schema.as_ref(), ui_hints.as_ref()].into_iter().flatten() {
        if serde_json::to_vec(value)
            .map(|bytes| bytes.len() > MAX_DESCRIPTOR_BYTES)
            .unwrap_or(true)
        {
            return Err(ManifestError::InvalidField("settings"));
        }
    }
    Ok((schema, ui_hints))
}

pub fn is_valid_plugin_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    (2..=128).contains(&bytes.len())
        && bytes[0].is_ascii_lowercase()
        && bytes[1..].iter().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'_' | b'-')
        })
}

/// Validate a package-relative path before joining it with a plugin root.
pub fn is_safe_relative_path(value: &str) -> bool {
    if value.is_empty() || value.contains('\0') || value.starts_with('/') || value.starts_with('\\')
    {
        return false;
    }
    let normalized = value.replace('\\', "/");
    if normalized.starts_with('/') || normalized.contains(":/") {
        return false;
    }
    let parts: Vec<&str> = normalized.split('/').collect();
    !parts.is_empty()
        && normalized != "."
        && parts.iter().all(|part| !part.is_empty() && *part != "..")
}

pub fn current_platform() -> String {
    match std::env::consts::OS {
        "windows" => "win32",
        "macos" => "darwin",
        platform => platform,
    }
    .to_owned()
}

pub fn current_target() -> String {
    let platform = current_platform();
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        "x86" => "ia32",
        architecture => architecture,
    };
    let abi = match std::env::consts::OS {
        "windows" => "msvc",
        "linux" => "gnu",
        "macos" => "darwin",
        other => other,
    };
    format!("{platform}-{arch}-{abi}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_new_native_manifest_and_descriptors() {
        let manifest = PluginManifest::from_json_str(
            r#"{
                "schemaVersion": 2,
                "id": "miniaudio",
                "name": "MiniAudio",
                "version": "1.2.0",
                "runtime": "native",
                "entry": "native/miniaudio.dll",
                "actionTypes": [{"id":"audio.play"}],
                "settings": {"schema": {"type":"object"}},
                "permissions": ["audio"]
            }"#,
        )
        .unwrap();

        assert_eq!(manifest.runtime, PluginRuntimeKind::Native);
        assert_eq!(manifest.entry, "native/miniaudio.dll");
        assert_eq!(manifest.action_types.len(), 1);
        assert!(manifest.settings_schema.is_some());
    }

    #[test]
    fn rejects_removed_schema_and_unsafe_entries() {
        assert!(matches!(
            PluginManifest::from_json_str(
                r#"{"schemaVersion":1,"id":"demo","name":"Demo","version":"1.0.0","main":"index.js"}"#
            ),
            Err(ManifestError::UnsupportedSchema(1))
        ));
        assert!(matches!(
            PluginManifest::from_json_str(
                r#"{"schemaVersion":2,"id":"demo","name":"Demo","version":"1.0.0","runtime":"process","entry":"../index"}"#
            ),
            Err(ManifestError::UnsafeEntry)
        ));
    }

    #[test]
    fn current_target_is_platform_qualified() {
        assert!(current_target().starts_with(&format!("{}-", current_platform())));
    }

    #[test]
    fn rejects_traversal() {
        assert!(!is_safe_relative_path("../../secret"));
        assert!(!is_safe_relative_path("native/../secret"));
        assert!(is_safe_relative_path("native/plugin.dll"));
    }
}
