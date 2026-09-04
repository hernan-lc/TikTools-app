use super::*;

use tiktools_plugin_api::MediaPickerOptions;

impl AppCore {
    pub async fn handle_page_message(self: &Arc<Self>, message: PageMessage) {
        self.events.publish(AppEvent::Ui(message.clone()));
        match message {
            PageMessage::Disconnect => {
                self.publish_disconnected_event().await;
                self.live.disconnect().await;
                self.emit(HostMessage::connection_disconnected());
            }
            PageMessage::Connect {
                unique_id,
                session_cookie,
                room_id,
            } => {
                self.start_live_event_pump();
                self.connect_native(ConnectRequest {
                    unique_id,
                    session_cookie,
                    room_id,
                })
                .await;
            }
            PageMessage::PickLive { session_cookie } => {
                self.start_live_event_pump();
                self.pick_live(&session_cookie).await;
            }
            PageMessage::OpenMediaPicker {
                request_id,
                mode,
                kind,
                title,
                initial_directory,
                extensions,
            } => {
                let options = MediaPickerOptions {
                    mode,
                    kind,
                    title,
                    initial_directory,
                    extensions,
                };
                let (selection, error) = match self.open_media_picker(options).await {
                    Ok(selection) => (selection, None),
                    Err(error) => (None, Some(error.to_string())),
                };
                self.emit(HostMessage::MediaSelected {
                    request_id,
                    selection,
                    error,
                });
            }
            PageMessage::GetPointsConfig => {
                self.emit(HostMessage::PointsConfig {
                    config: self.points.config(),
                });
            }
            PageMessage::UpdatePointsConfig { config } => {
                self.emit(HostMessage::PointsConfig {
                    config: self.points.update_config(config),
                });
            }
            PageMessage::GetLeaderboard { limit } => {
                self.emit(HostMessage::Leaderboard {
                    viewers: self.points.leaderboard(limit),
                });
            }
            PageMessage::ResetPoints { unique_id } => {
                self.points.reset(unique_id.as_deref());
                self.emit(HostMessage::Leaderboard {
                    viewers: self.points.leaderboard(Some(100)),
                });
            }
            PageMessage::AdjustPoints { unique_id, delta } => {
                if let Some(award) = self.points.award_points(
                    &unique_id,
                    PointAction::Manual,
                    AwardOptions {
                        custom_amount: Some(delta),
                        ..AwardOptions::default()
                    },
                ) {
                    self.emit(HostMessage::PointsAwarded {
                        unique_id: award.unique_id,
                        delta: award.delta,
                        total_points: award.total_points,
                        level: award.level,
                    });
                }
                self.emit(HostMessage::Leaderboard {
                    viewers: self.points.leaderboard(Some(100)),
                });
            }
            PageMessage::GetCreator { unique_id } => {
                #[cfg(feature = "persistence")]
                let creator = match self.db.load_creator(unique_id.as_deref()) {
                    Ok(creator) => creator,
                    Err(error) => {
                        tracing::warn!(%error, "could not load creator state");
                        None
                    }
                };
                #[cfg(not(feature = "persistence"))]
                let creator = {
                    let _ = unique_id;
                    None
                };
                self.emit(HostMessage::CreatorState { creator });
            }
            PageMessage::GetRecentCreators { limit } => {
                #[cfg(feature = "persistence")]
                let creators = match self
                    .db
                    .load_recent_creators(limit.unwrap_or(10).clamp(0, 1000))
                {
                    Ok(creators) => creators,
                    Err(error) => {
                        tracing::warn!(%error, "could not load creator history");
                        Vec::new()
                    }
                };
                #[cfg(not(feature = "persistence"))]
                let creators = {
                    let _ = limit;
                    Vec::new()
                };
                self.emit(HostMessage::RecentCreators { creators });
            }
            PageMessage::GetAppState { keys } => {
                let state = self.app_state.read(keys.as_deref());
                #[cfg(feature = "persistence")]
                let state = {
                    let mut state = state;
                    match self.db.load_app_state() {
                        Ok(persisted) => {
                            state = persisted
                                .into_iter()
                                .filter_map(|(key, value)| {
                                    value.as_str().map(|value| (key, value.to_owned()))
                                })
                                .filter(|(key, _)| {
                                    keys.as_ref()
                                        .is_none_or(|keys| keys.is_empty() || keys.contains(key))
                                })
                                .collect();
                        }
                        Err(error) => tracing::warn!(%error, "could not load app state"),
                    }
                    state
                };
                self.emit(HostMessage::AppState { state });
            }
            PageMessage::SetAppState { key, value } => {
                self.app_state.set(key.clone(), value.clone());
                #[cfg(feature = "persistence")]
                if let Err(error) = self.db.save_app_state(&key, &value) {
                    tracing::warn!(%error, "could not persist app state");
                }
                self.emit(HostMessage::AppState {
                    state: [(key, value)].into_iter().collect(),
                });
            }
            PageMessage::ClearCreatorHistory => {
                #[cfg(feature = "persistence")]
                if let Err(error) = self.db.clear_creator_history() {
                    tracing::warn!(%error, "could not clear creator history");
                }
                self.emit(HostMessage::RecentCreators {
                    creators: Vec::new(),
                });
                self.emit(HostMessage::CreatorState { creator: None });
            }
            PageMessage::DebugGift { gift_id } => {
                self.emit(HostMessage::GiftDebug {
                    gift_id,
                    icon_url: None,
                    has_icon: false,
                    total_gifts: 0,
                });
            }
            PageMessage::GetAutomationWorkflows => {
                self.emit_persisted_workflows();
            }
            PageMessage::GetAutomationNodes => {
                self.emit(HostMessage::AutomationNodeCatalog {
                    nodes: builtin_node_catalog(),
                });
            }
            PageMessage::GetAutomationContext => {
                let event = self
                    .last_automation_event
                    .read()
                    .expect("automation event lock poisoned")
                    .clone();
                let captured_at = *self
                    .last_automation_event_at
                    .read()
                    .expect("automation timestamp lock poisoned");
                self.emit(HostMessage::AutomationContext { event, captured_at });
            }
            PageMessage::SaveAutomationWorkflow { graph } => {
                #[cfg(feature = "persistence")]
                {
                    if let Err(error) = self.db.save_workflow(&graph) {
                        self.emit(HostMessage::AutomationError {
                            message: error.to_string(),
                        });
                    } else {
                        self.emit_persisted_workflows();
                    }
                }
                #[cfg(not(feature = "persistence"))]
                {
                    let _ = graph;
                    self.emit(HostMessage::AutomationError {
                        message: "Rust persistence is disabled in this build.".to_owned(),
                    });
                }
            }
            PageMessage::DeleteAutomationWorkflow { id } => {
                #[cfg(feature = "persistence")]
                if let Err(error) = self.db.delete_workflow(&id) {
                    self.emit(HostMessage::AutomationError {
                        message: error.to_string(),
                    });
                }
                #[cfg(not(feature = "persistence"))]
                let _ = id;
                self.emit_persisted_workflows();
            }
            PageMessage::SetAutomationWorkflowEnabled { id, enabled } => {
                #[cfg(feature = "persistence")]
                if let Err(error) = self.db.set_workflow_enabled(&id, enabled) {
                    self.emit(HostMessage::AutomationError {
                        message: error.to_string(),
                    });
                }
                #[cfg(not(feature = "persistence"))]
                {
                    let _ = (id, enabled);
                    self.emit(HostMessage::AutomationError {
                        message: "Rust persistence is disabled in this build.".to_owned(),
                    });
                }
                self.emit_persisted_workflows();
            }
            PageMessage::GetGiftCatalog => {
                self.emit_persisted_gifts();
            }
            PageMessage::GetBehavior => {
                self.emit_persisted_behavior();
                self.emit(HostMessage::BehaviorRuns {
                    runs: self.automation.recent_runs(),
                });
            }
            PageMessage::SaveAction { action } => {
                self.save_behavior_record("behavior_actions", action);
            }
            PageMessage::DeleteAction { id } => {
                self.delete_behavior_record("behavior_actions", &id);
            }
            PageMessage::SetActionEnabled { id, enabled } => {
                self.set_behavior_enabled("behavior_actions", &id, enabled);
            }
            PageMessage::SaveEvent { event } => {
                self.save_behavior_record("behavior_events", event);
            }
            PageMessage::DeleteEvent { id } => {
                self.delete_behavior_record("behavior_events", &id);
            }
            PageMessage::SetEventEnabled { id, enabled } => {
                self.set_behavior_enabled("behavior_events", &id, enabled);
            }
            PageMessage::SetPluginInstall { id, installed } => {
                let state_updated = {
                    #[cfg(feature = "persistence")]
                    {
                        if let Err(error) = self.db.set_plugin_state(&id, installed, true) {
                            self.emit(HostMessage::AutomationError {
                                message: error.to_string(),
                            });
                            false
                        } else {
                            true
                        }
                    }
                    #[cfg(not(feature = "persistence"))]
                    {
                        let _ = installed;
                        self.emit(HostMessage::AutomationError {
                            message: "Rust persistence is disabled in this build.".to_owned(),
                        });
                        false
                    }
                };
                if state_updated && !installed {
                    if let Err(error) = self.plugins.stop(&id) {
                        tracing::debug!(plugin = %id, %error, "plugin was not running during uninstall");
                    }
                }
                self.emit_persisted_behavior();
            }
            PageMessage::SetPluginEnabled { id, enabled } => {
                let state_updated = {
                    #[cfg(feature = "persistence")]
                    {
                        if let Err(error) = self.db.set_plugin_state(&id, true, enabled) {
                            self.emit(HostMessage::AutomationError {
                                message: error.to_string(),
                            });
                            false
                        } else {
                            true
                        }
                    }
                    #[cfg(not(feature = "persistence"))]
                    {
                        let _ = enabled;
                        self.emit(HostMessage::AutomationError {
                            message: "Rust persistence is disabled in this build.".to_owned(),
                        });
                        false
                    }
                };
                if state_updated {
                    let result = if enabled {
                        self.plugins.start(&id)
                    } else {
                        self.plugins.stop(&id)
                    };
                    if let Err(error) = result {
                        self.emit(HostMessage::BehaviorError {
                            message: error.to_string(),
                        });
                    }
                }
                self.emit_persisted_behavior();
            }
            PageMessage::GetActionOptions { source } => {
                self.emit(HostMessage::ActionOptions {
                    source,
                    options: Vec::new(),
                });
            }
            PageMessage::GetPluginSettings { id } => {
                self.emit_plugin_settings(&id);
            }
            PageMessage::SavePluginSettings { id, values } => {
                self.save_plugin_settings(&id, values);
            }
            PageMessage::AnalyzeAutomationScript {
                node_id,
                source,
                offset: _,
                event_type: _,
            } => {
                let diagnostics = self
                    .automation
                    .validate_script(&source)
                    .err()
                    .map(|message| {
                        vec![json!({
                            "line": 1,
                            "column": 1,
                            "message": message,
                            "severity": "error"
                        })]
                    })
                    .unwrap_or_default();
                self.emit(HostMessage::AutomationScriptAnalysis {
                    analysis: json!({
                        "nodeId": node_id,
                        "source": source,
                        "diagnostics": diagnostics,
                        "completions": [],
                        "hover": null
                    }),
                });
            }
            PageMessage::TestAction { action, trigger } => {
                self.emit(HostMessage::BehaviorTestResult {
                    runs: vec![self.test_action(&action, trigger.as_deref()).await],
                });
            }
            PageMessage::TestEvent { event } => {
                self.emit(HostMessage::BehaviorTestResult {
                    runs: vec![self.test_event(&event).await],
                });
            }
        }
    }
}
