use super::*;

impl AppCore {
    pub(super) fn emit_persisted_workflows(&self) {
        #[cfg(feature = "persistence")]
        let workflows = match self.db.load_workflows() {
            Ok(workflows) => workflows,
            Err(error) => {
                self.emit(HostMessage::AutomationError {
                    message: error.to_string(),
                });
                Vec::new()
            }
        };
        #[cfg(not(feature = "persistence"))]
        let workflows = Vec::new();
        self.emit(HostMessage::AutomationWorkflows { workflows });
    }

    pub(super) fn emit_persisted_gifts(&self) {
        #[cfg(feature = "persistence")]
        let gifts = match self.db.load_gift_catalog() {
            Ok(gifts) => gifts,
            Err(error) => {
                tracing::warn!(%error, "could not load gift catalog");
                Vec::new()
            }
        };
        #[cfg(not(feature = "persistence"))]
        let gifts = Vec::new();
        self.emit(HostMessage::GiftCatalog { gifts });
    }

    pub(super) fn emit_persisted_behavior(&self) {
        #[cfg(feature = "persistence")]
        let mut snapshot = match self.db.load_behavior_snapshot() {
            Ok(snapshot) => snapshot,
            Err(error) => {
                self.emit(HostMessage::AutomationError {
                    message: error.to_string(),
                });
                empty_behavior_snapshot()
            }
        };
        #[cfg(not(feature = "persistence"))]
        let mut snapshot = empty_behavior_snapshot();
        self.merge_runtime_catalog(&mut snapshot);
        self.automation.replace_snapshot(&snapshot);
        self.emit(HostMessage::Behavior { snapshot });
    }

    pub(super) fn merge_runtime_catalog(&self, snapshot: &mut serde_json::Value) {
        let Some(object) = snapshot.as_object_mut() else {
            *snapshot = empty_behavior_snapshot();
            return;
        };

        let mut action_types = builtin_action_types();
        let mut plugins = Vec::new();
        let persisted_plugins = object
            .get("plugins")
            .and_then(serde_json::Value::as_array)
            .cloned()
            .unwrap_or_default();

        for plugin in self.plugins.list() {
            let state = persisted_plugins.iter().find(|value| {
                value.get("id").and_then(serde_json::Value::as_str)
                    == Some(plugin.manifest.id.as_str())
            });
            let installed = state
                .and_then(|value| value.get("installed"))
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(true);
            let enabled = state
                .and_then(|value| value.get("enabled"))
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(true);
            let dependency = format!("{} runtime", plugin.manifest.runtime);
            let description = plugin
                .manifest
                .description
                .clone()
                .unwrap_or_else(|| format!("{} runtime plugin", plugin.manifest.name));
            let action_ids = plugin
                .manifest
                .action_types
                .iter()
                .filter_map(|value| value.get("id").and_then(serde_json::Value::as_str))
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>();
            plugins.push(json!({
                "descriptor": {
                    "id": plugin.manifest.id,
                    "name": localized(&plugin.manifest.name, "plugin.name"),
                    "version": plugin.manifest.version,
                    "description": localized(&description, "plugin.description"),
                    "dependency": localized(&dependency, "plugin.dependency"),
                    "permissions": plugin.manifest.permissions,
                    "actionTypeIds": action_ids,
                    "hasSettings": plugin.manifest.settings_schema.is_some()
                },
                "installed": installed,
                "enabled": enabled,
                "available": plugin.available,
                "unavailableReason": plugin.reason
            }));

            for descriptor in &plugin.manifest.action_types {
                let Some(mut descriptor) = descriptor.as_object().cloned() else {
                    continue;
                };
                let Some(id) = descriptor.get("id").and_then(serde_json::Value::as_str) else {
                    continue;
                };
                if !is_identifier(id) {
                    tracing::warn!(plugin = %plugin.manifest.id, action = %id, "plugin action id is invalid");
                    continue;
                }
                descriptor.insert(
                    "source".to_owned(),
                    json!({"kind": "plugin", "pluginId": plugin.manifest.id}),
                );
                if !descriptor.contains_key("requiredCapabilities") {
                    descriptor.insert(
                        "requiredCapabilities".to_owned(),
                        Value::Array(
                            plugin
                                .manifest
                                .capabilities
                                .iter()
                                .cloned()
                                .map(Value::String)
                                .collect(),
                        ),
                    );
                }
                action_types.push(Value::Object(descriptor));
            }
        }

        object.insert("actionTypes".to_owned(), Value::Array(action_types));
        object.insert("plugins".to_owned(), Value::Array(plugins));
        object.insert("translations".to_owned(), builtin_translations());
    }

    pub(super) fn emit_plugin_settings(&self, id: &str) {
        let Some(plugin) = self.plugins.get(id) else {
            self.emit(HostMessage::BehaviorError {
                message: format!("Plugin `{id}` is not installed."),
            });
            return;
        };
        let Some(schema) = plugin.manifest.settings_schema.clone() else {
            self.emit(HostMessage::BehaviorError {
                message: format!("Plugin settings are not declared by `{id}`."),
            });
            return;
        };
        match self.capabilities.load_plugin_settings(&plugin.manifest) {
            Ok(values) => self.emit(HostMessage::PluginSettings {
                id: id.to_owned(),
                schema,
                ui_hints: plugin.manifest.settings_ui_hints.clone(),
                values,
            }),
            Err(error) => self.emit(HostMessage::BehaviorError {
                message: error.to_string(),
            }),
        }
    }

    pub(super) fn save_plugin_settings(
        &self,
        id: &str,
        values: std::collections::BTreeMap<String, Value>,
    ) {
        let Some(plugin) = self.plugins.get(id) else {
            self.emit(HostMessage::BehaviorError {
                message: format!("Plugin `{id}` is not installed."),
            });
            return;
        };
        let Some(schema) = plugin.manifest.settings_schema.clone() else {
            self.emit(HostMessage::BehaviorError {
                message: format!("Plugin settings are not declared by `{id}`."),
            });
            return;
        };
        match self
            .capabilities
            .save_plugin_settings(&plugin.manifest, &values)
        {
            Ok(values) => self.emit(HostMessage::PluginSettings {
                id: id.to_owned(),
                schema,
                ui_hints: plugin.manifest.settings_ui_hints.clone(),
                values,
            }),
            Err(error) => self.emit(HostMessage::BehaviorError {
                message: error.to_string(),
            }),
        }
    }

    pub(super) fn save_behavior_record(&self, table: &str, value: serde_json::Value) {
        #[cfg(feature = "persistence")]
        {
            if let Err(error) = self.db.save_behavior(table, &value) {
                self.emit(HostMessage::AutomationError {
                    message: error.to_string(),
                });
            } else {
                self.emit_persisted_behavior();
            }
        }
        #[cfg(not(feature = "persistence"))]
        {
            let _ = (table, value);
            self.emit(HostMessage::AutomationError {
                message: "Rust persistence is disabled in this build.".to_owned(),
            });
        }
    }

    pub(super) fn delete_behavior_record(&self, table: &str, id: &str) {
        #[cfg(feature = "persistence")]
        {
            if let Err(error) = self.db.delete_behavior(table, id) {
                self.emit(HostMessage::AutomationError {
                    message: error.to_string(),
                });
            } else {
                self.emit_persisted_behavior();
            }
        }
        #[cfg(not(feature = "persistence"))]
        {
            let _ = (table, id);
            self.emit(HostMessage::AutomationError {
                message: "Rust persistence is disabled in this build.".to_owned(),
            });
        }
    }

    pub(super) fn set_behavior_enabled(&self, table: &str, id: &str, enabled: bool) {
        #[cfg(feature = "persistence")]
        {
            if let Err(error) = self.db.set_behavior_enabled(table, id, enabled) {
                self.emit(HostMessage::AutomationError {
                    message: error.to_string(),
                });
            } else {
                self.emit_persisted_behavior();
            }
        }
        #[cfg(not(feature = "persistence"))]
        {
            let _ = (table, id, enabled);
            self.emit(HostMessage::AutomationError {
                message: "Rust persistence is disabled in this build.".to_owned(),
            });
        }
    }
}
