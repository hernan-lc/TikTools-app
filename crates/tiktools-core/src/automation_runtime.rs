use super::*;

const AUTOMATION_ACTION_DEADLINE: std::time::Duration = std::time::Duration::from_secs(125);
const PLUGIN_CALL_DEADLINE: std::time::Duration = std::time::Duration::from_secs(30);
#[cfg(feature = "http")]
const MAX_HTTP_RESPONSE_BYTES: usize = 2 * 1024 * 1024;

impl AppCore {
    pub(super) async fn test_action(
        self: &Arc<Self>,
        action: &Value,
        trigger: Option<&str>,
    ) -> Value {
        let event = self
            .last_automation_event
            .read()
            .expect("automation event lock poisoned")
            .clone()
            .unwrap_or_else(|| sample_automation_event(trigger.unwrap_or("tiktok.chat")));
        self.execute_action(action, &event, None, true).await
    }

    pub(super) async fn test_event(self: &Arc<Self>, record: &Value) -> Value {
        let started = now_millis();
        let trigger = record
            .get("trigger")
            .and_then(Value::as_str)
            .unwrap_or("tiktok.chat");
        let event = self
            .last_automation_event
            .read()
            .expect("automation event lock poisoned")
            .clone()
            .filter(|event| event.get("type").and_then(Value::as_str) == Some(trigger))
            .unwrap_or_else(|| {
                self.plugin_event_sample(trigger)
                    .unwrap_or_else(|| sample_automation_event(trigger))
            });

        if !self.automation.event_record_matches(record, &event) {
            let summary = "Event filters did not match the sample event.";
            return json!({
                "id": self.automation.next_run_id("test-event", started),
                "at": started,
                "status": "error",
                "eventName": trigger,
                "actionName": record.get("name").and_then(Value::as_str).unwrap_or("Event"),
                "summary": summary,
                "durationMs": now_millis().saturating_sub(started),
                "test": true,
                "logs": [],
                "error": summary
            });
        }

        let actions = self.automation.actions_for_event(record);
        if actions.is_empty() {
            let summary = "The event has no saved actions to test.";
            return json!({
                "id": self.automation.next_run_id("test-event", started),
                "at": started,
                "status": "error",
                "eventName": trigger,
                "actionName": record.get("name").and_then(Value::as_str).unwrap_or("Event"),
                "summary": summary,
                "durationMs": now_millis().saturating_sub(started),
                "test": true,
                "logs": [],
                "error": summary
            });
        }

        let mut runs = Vec::with_capacity(actions.len());
        for action in &actions {
            runs.push(
                self.execute_action(action, &event, Some(record), true)
                    .await,
            );
        }
        let failed = runs
            .iter()
            .any(|run| run.get("status") == Some(&Value::String("error".to_owned())));
        let summary = if failed {
            "One or more actions failed."
        } else {
            "All referenced actions passed."
        };
        let mut result = json!({
            "id": self.automation.next_run_id("test-event", started),
            "at": started,
            "status": if failed { "error" } else { "ok" },
            "eventName": trigger,
            "actionName": record.get("name").and_then(Value::as_str).unwrap_or("Event"),
            "summary": summary,
            "durationMs": now_millis().saturating_sub(started),
            "test": true,
            "logs": [],
            "actions": runs
        });
        if failed {
            result["error"] = Value::String(summary.to_owned());
        }
        result
    }

    pub(super) async fn run_automation_event(self: &Arc<Self>, event: Value) {
        if self.automation.emit_depth(&event) >= 3 {
            tracing::warn!(event_type = ?event.get("type"), "automation emit depth limit reached");
            return;
        }
        for record in self.automation.matching_events(&event) {
            if !self.automation.claim_event(&record, &event, now_millis()) {
                continue;
            }
            for action in self.automation.actions_for_event(&record) {
                self.execute_action(&action, &event, Some(&record), false)
                    .await;
            }
        }
    }

    pub(super) async fn execute_action(
        self: &Arc<Self>,
        action: &Value,
        event: &Value,
        origin: Option<&Value>,
        test: bool,
    ) -> Value {
        let started = now_millis();
        let type_id = action
            .get("typeId")
            .or_else(|| action.get("type"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        let config = action
            .get("config")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let mut logs = Vec::new();
        let result = match tokio::time::timeout(
            AUTOMATION_ACTION_DEADLINE,
            self.execute_action_impl(&type_id, &config, action, event, &mut logs, test),
        )
        .await
        {
            Ok(result) => result,
            Err(_) => Err(format!(
                "Automation action timed out after {} seconds.",
                AUTOMATION_ACTION_DEADLINE.as_secs()
            )),
        };

        let (status, summary, error) = match result {
            Ok(summary) => ("ok", summary, None),
            Err(error) => ("error", error.clone(), Some(error)),
        };
        let run = json!({
            "id": self.automation.next_run_id(if test { "test-action" } else { "run" }, started),
            "at": started,
            "status": status,
            "eventId": origin.and_then(|value| value.get("id")),
            "eventName": origin.and_then(|value| value.get("name")),
            "actionId": action.get("id"),
            "actionName": action.get("name").and_then(Value::as_str).unwrap_or("Action"),
            "summary": summary,
            "durationMs": now_millis().saturating_sub(started),
            "test": test,
            "logs": logs.into_iter().take(40).collect::<Vec<_>>(),
            "error": error
        });
        let runs = self.automation.record_run(run.clone());
        self.emit(HostMessage::BehaviorRuns { runs });
        run
    }

    pub(super) async fn execute_action_impl(
        self: &Arc<Self>,
        type_id: &str,
        config: &serde_json::Map<String, Value>,
        action: &Value,
        event: &Value,
        logs: &mut Vec<String>,
        test: bool,
    ) -> Result<String, String> {
        match type_id {
            "core.log" => {
                let message = render_template(
                    config
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                    event,
                );
                tracing::info!(target: "tiktools::automation", message = %message, "automation log");
                logs.push(message.clone());
                Ok(message.chars().take(120).collect())
            }
            "core.emit" => {
                let event_type = normalize_emit_type(
                    config
                        .get("type")
                        .and_then(Value::as_str)
                        .unwrap_or("overlay.alert"),
                )?;
                let payload = config
                    .get("data")
                    .map(|value| render_json_map(value, event))
                    .unwrap_or_default();
                if !test {
                    self.publish_automation_event(self.make_internal_automation_event(
                        event,
                        &event_type,
                        Value::Object(payload.into_iter().collect()),
                    ))
                    .await;
                }
                Ok(if test {
                    format!("would emit {event_type}")
                } else {
                    format!("emit {event_type}")
                })
            }
            "core.points" => {
                let unique_id = render_template(
                    config.get("uniqueId").and_then(Value::as_str).unwrap_or(""),
                    event,
                );
                let delta = number_value(config.get("delta")).unwrap_or_default();
                if unique_id.trim().is_empty() || !delta.is_finite() || delta == 0.0 {
                    return Err("Points action needs a viewer and a non-zero number.".to_owned());
                }
                if test {
                    return Ok(format!("would award {unique_id} {delta:+}"));
                }
                let award = self
                    .points
                    .adjust(&unique_id, delta)
                    .ok_or_else(|| format!("Viewer `{unique_id}` is not in the leaderboard."))?;
                self.emit(HostMessage::PointsAwarded {
                    unique_id: award.unique_id.clone(),
                    delta: award.delta,
                    total_points: award.total_points,
                    level: award.level,
                });
                self.emit_leaderboard_if_due();
                Ok(format!("{} {:+}", award.unique_id, award.delta))
            }
            "core.delay" => {
                let millis = number_value(config.get("ms"))
                    .unwrap_or_default()
                    .clamp(0.0, 60_000.0) as u64;
                if !test && millis > 0 {
                    tokio::time::sleep(std::time::Duration::from_millis(millis)).await;
                }
                Ok(format!("wait {millis} ms"))
            }
            "audio.play" | "core.audio.play" => {
                self.execute_audio_action(config, event, logs, test).await
            }
            "core.code" => {
                let source = config
                    .get("source")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "Script action has no source.".to_owned())?;
                let result = self.automation.evaluate_script(source, event, &json!({}))?;
                let mut parts = Vec::new();
                for log in result
                    .get("log")
                    .into_iter()
                    .flat_map(as_values)
                    .filter_map(Value::as_str)
                {
                    if logs.len() < 40 {
                        logs.push(log.to_owned());
                    }
                }
                for intent in result.get("emit").into_iter().flat_map(as_values) {
                    let Some(intent) = intent.as_object() else {
                        continue;
                    };
                    let Some(event_type) = intent.get("type").and_then(Value::as_str) else {
                        continue;
                    };
                    let event_type = normalize_emit_type(event_type)?;
                    let payload = intent
                        .get("data")
                        .map(|value| render_json_map(value, event))
                        .unwrap_or_default();
                    if !test {
                        self.publish_automation_event(self.make_internal_automation_event(
                            event,
                            &event_type,
                            Value::Object(payload.into_iter().collect()),
                        ))
                        .await;
                    }
                    parts.push(if test {
                        format!("would emit {event_type}")
                    } else {
                        format!("emit {event_type}")
                    });
                }
                for intent in result
                    .get(tiktools_plugin_api::AUDIO_PLAY_INTENT)
                    .into_iter()
                    .flat_map(as_values)
                {
                    let Some(intent) = intent.as_object() else {
                        continue;
                    };
                    parts.push(self.execute_audio_action(intent, event, logs, test).await?);
                }
                if let Some(intent) = result.get("fetch").and_then(Value::as_object) {
                    let mut fetch_config = intent.clone();
                    if let Some(emit_response_as) = result.get("emitResponseAs") {
                        fetch_config.insert("emitResponseAs".to_owned(), emit_response_as.clone());
                    }
                    let allowed_hosts = hosts_in_source(source);
                    parts.push(
                        self.execute_http_action(
                            &fetch_config,
                            event,
                            logs,
                            Some(&allowed_hosts),
                            test,
                        )
                        .await?,
                    );
                }
                if parts.is_empty() {
                    Ok(format!("script returned {}", result_type(&result)))
                } else {
                    Ok(parts.join(" · "))
                }
            }
            "core.fetch" => {
                self.execute_http_action(config, event, logs, None, test)
                    .await
            }
            _ if type_id.is_empty() => Err("Action has no typeId.".to_owned()),
            _ => {
                self.execute_plugin_action(type_id, action, event, logs, test)
                    .await
            }
        }
    }

    pub(super) async fn execute_audio_action(
        self: &Arc<Self>,
        config: &serde_json::Map<String, Value>,
        event: &Value,
        logs: &mut Vec<String>,
        test: bool,
    ) -> Result<String, String> {
        let configured = config
            .get("fileRef")
            .or_else(|| config.get("file"))
            .or_else(|| config.get("filePath"))
            .or_else(|| config.get("path"))
            .ok_or_else(|| "Audio action has no file reference.".to_owned())?;
        let raw_path = configured
            .get("path")
            .and_then(Value::as_str)
            .or_else(|| configured.as_str())
            .ok_or_else(|| "Audio file reference must contain a path.".to_owned())?;
        let rendered_path = render_template(raw_path, event);
        let file = crate::services::audio_file_ref_from_config(
            &rendered_path,
            self.db.paths().data.as_path(),
        )
        .map_err(|error| error.to_string())?;
        let volume = number_value(config.get("volume"))
            .unwrap_or(1.0)
            .clamp(0.0, 1.0);
        if !volume.is_finite() {
            return Err("Audio volume must be finite.".to_owned());
        }
        let overlap = match config
            .get("overlap")
            .and_then(Value::as_str)
            .unwrap_or("allow")
        {
            "restart" => tiktools_plugin_api::AudioOverlap::Restart,
            "drop" => tiktools_plugin_api::AudioOverlap::Drop,
            _ => tiktools_plugin_api::AudioOverlap::Allow,
        };
        if test {
            let summary = format!("would play {}", file.name);
            if logs.len() < 40 {
                logs.push(summary.clone());
            }
            return Ok(summary);
        }
        let result = self
            .play_audio(
                file.clone(),
                tiktools_plugin_api::AudioPlayOptions {
                    volume: volume as f32,
                    overlap,
                },
            )
            .await
            .map_err(|error| error.to_string())?;
        let summary = if result.played {
            format!("played {}", file.name)
        } else {
            format!(
                "skipped {}{}",
                file.name,
                result
                    .reason
                    .as_deref()
                    .map(|reason| format!(" ({reason})"))
                    .unwrap_or_default()
            )
        };
        tracing::info!(target: "tiktools::automation", file = %file.path, played = result.played, "audio action completed");
        if logs.len() < 40 {
            logs.push(summary.clone());
        }
        Ok(summary)
    }

    #[cfg(feature = "http")]
    pub(super) async fn execute_http_action(
        self: &Arc<Self>,
        config: &serde_json::Map<String, Value>,
        event: &Value,
        logs: &mut Vec<String>,
        allowed_hosts: Option<&[String]>,
        test: bool,
    ) -> Result<String, String> {
        let raw_url = config
            .get("url")
            .and_then(Value::as_str)
            .ok_or_else(|| "HTTP action has no URL.".to_owned())?;
        let configured_url = reqwest::Url::parse(raw_url)
            .map_err(|_| "HTTP URL is invalid before template rendering.".to_owned())?;
        let configured_host = configured_url
            .host_str()
            .map(str::to_ascii_lowercase)
            .ok_or_else(|| "HTTP URL has no host.".to_owned())?;
        let rendered_url = render_template(raw_url, event);
        let url = reqwest::Url::parse(&rendered_url)
            .map_err(|_| "HTTP URL is invalid after template rendering.".to_owned())?;
        let allow_private_network = config
            .get("allowPrivateNetwork")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if test {
            validate_http_url_shape(&url, &configured_host, allowed_hosts, allow_private_network)?;
        } else {
            validate_http_url(&url, &configured_host, allowed_hosts, allow_private_network).await?;
        }

        let method_name = config
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or("POST")
            .trim()
            .to_ascii_uppercase();
        let method = reqwest::Method::from_bytes(method_name.as_bytes())
            .map_err(|_| format!("HTTP method is invalid: {method_name}"))?;
        let mut content_type = String::new();
        let mut rendered_headers = Vec::new();
        if let Some(headers) = config.get("headers").and_then(Value::as_object) {
            if headers.len() > 64 {
                return Err("HTTP action has too many headers.".to_owned());
            }
            for (key, value) in headers {
                let value = value_to_string(&Value::String(render_template(
                    &value_to_string(value),
                    event,
                )));
                if key.eq_ignore_ascii_case("content-type") {
                    content_type = value.clone();
                }
                rendered_headers.push((key.clone(), value));
            }
        }
        let body = config.get("body").and_then(|value| {
            if value.is_null() {
                None
            } else {
                Some(
                    value
                        .as_str()
                        .map(|value| render_template(value, event))
                        .unwrap_or_else(|| value_to_string(value)),
                )
            }
        });
        if let Some(body) = body.as_deref() {
            if !matches!(method, reqwest::Method::GET | reqwest::Method::HEAD)
                && content_type
                    .to_ascii_lowercase()
                    .contains("application/json")
                && !body.trim().is_empty()
                && serde_json::from_str::<Value>(body).is_err()
            {
                return Err("The JSON body is invalid after applying the template.".to_owned());
            }
        }
        if test {
            let summary = format!("would {method_name} request to {configured_host}");
            if logs.len() < 40 {
                logs.push(summary.clone());
            }
            return Ok(summary);
        }
        let http_client = self.http_client.as_ref().ok_or_else(|| {
            self.http_client_error.clone().unwrap_or_else(|| {
                "HTTP automation is disabled because its hardened client is unavailable.".to_owned()
            })
        })?;
        let mut request = http_client.request(method.clone(), url.clone());
        for (key, value) in rendered_headers {
            request = request.header(key, value);
        }
        if let Some(body) = body.as_deref() {
            request = request.body(body.to_owned());
        }
        let timeout_ms = number_value(config.get("timeoutMs"))
            .unwrap_or(5_000.0)
            .clamp(100.0, 120_000.0) as u64;
        let started = now_millis();
        let response = request
            .timeout(std::time::Duration::from_millis(timeout_ms))
            .send()
            .await
            .map_err(|error| {
                if error.is_timeout() {
                    format!("HTTP request timed out after {timeout_ms} ms.")
                } else {
                    format!("HTTP request failed: {error}")
                }
            })?;
        if response.url() != &url && response.url().host_str() != Some(configured_host.as_str()) {
            return Err("HTTP redirect changed the destination host.".to_owned());
        }
        if response.status().is_redirection() && response.headers().get("location").is_some() {
            return Err("HTTP redirects are blocked by policy.".to_owned());
        }
        let status = response.status().as_u16();
        let response_url = response.url().to_string();
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_owned();
        if response
            .content_length()
            .is_some_and(|length| length > MAX_HTTP_RESPONSE_BYTES as u64)
        {
            return Err("HTTP response exceeds the 2 MiB limit.".to_owned());
        }
        let mut response = response;
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| format!("could not read HTTP response: {error}"))?
        {
            if bytes.len().saturating_add(chunk.len()) > MAX_HTTP_RESPONSE_BYTES {
                return Err("HTTP response exceeds the 2 MiB limit.".to_owned());
            }
            bytes.extend_from_slice(&chunk);
        }
        let body = if content_type.to_ascii_lowercase().contains("json") {
            serde_json::from_slice::<Value>(&bytes)
                .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).into_owned()))
        } else {
            Value::String(String::from_utf8_lossy(&bytes).into_owned())
        };
        let elapsed = now_millis().saturating_sub(started);
        let log = format!("{method_name} {configured_host} → {status} ({elapsed} ms)");
        tracing::info!(target: "tiktools::automation", message = %log, "HTTP action completed");
        logs.push(log);

        if let Some(emit_response_as) = config
            .get("emitResponseAs")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
        {
            let event_type = normalize_emit_type(emit_response_as)?;
            Box::pin(
                self.publish_automation_event(self.make_internal_automation_event(
                    event,
                    &event_type,
                    json!({"status": status, "ok": (200..300).contains(&status), "body": body}),
                )),
            )
            .await;
        }
        if !(200..300).contains(&status) {
            return Err(format!(
                "HTTP {status} {}",
                if status >= 500 {
                    "server error"
                } else {
                    "request failed"
                }
            ));
        }
        Ok(format!("{status} OK · {elapsed} ms · {response_url}"))
    }

    #[cfg(not(feature = "http"))]
    pub(super) async fn execute_http_action(
        self: &Arc<Self>,
        _config: &serde_json::Map<String, Value>,
        _event: &Value,
        _logs: &mut Vec<String>,
        _allowed_hosts: Option<&[String]>,
        _test: bool,
    ) -> Result<String, String> {
        Err("HTTP action execution requires the host HTTP capability.".to_owned())
    }

    pub(super) async fn execute_plugin_action(
        self: &Arc<Self>,
        type_id: &str,
        action: &Value,
        event: &Value,
        logs: &mut Vec<String>,
        test: bool,
    ) -> Result<String, String> {
        let Some((plugin, descriptor)) = self.plugin_for_action(type_id) else {
            return Err(format!(
                "Action type `{type_id}` is not available in this host."
            ));
        };
        if !self.plugin_ready(&plugin.manifest.id) {
            return Err(format!(
                "Plugin `{}` is not installed, enabled, or available.",
                plugin.manifest.id
            ));
        }
        let requires_audio_output = descriptor
            .get("requiredCapabilities")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .any(|capability| {
                tiktools_plugin_api::capabilities::capability_matches(
                    capability,
                    tiktools_plugin_api::CAPABILITY_AUDIO_PLAY,
                )
            });
        for capability in descriptor
            .get("requiredCapabilities")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
        {
            self.capabilities
                .require_capability(&plugin.manifest, capability)
                .map_err(|error| error.to_string())?;
        }
        if requires_audio_output {
            self.capabilities
                .require_permission(
                    &plugin.manifest,
                    tiktools_plugin_api::capabilities::AUDIO_OUTPUT_PERMISSION,
                )
                .map_err(|error| error.to_string())?;
        }
        if test {
            return Ok(format!(
                "would run plugin {} action {type_id}",
                plugin.manifest.id
            ));
        }
        self.plugins
            .start(&plugin.manifest.id)
            .map_err(|error| error.to_string())?;
        let plugin_id = plugin.manifest.id.clone();
        let request = json!({"type": "action", "action": action, "event": event});
        let plugins = Arc::clone(&self.plugins);
        let request_for_call = request.clone();
        let response = tokio::time::timeout(
            PLUGIN_CALL_DEADLINE,
            tokio::task::spawn_blocking(move || plugins.call(&plugin_id, &request_for_call)),
        )
        .await
        .map_err(|_| {
            format!(
                "plugin `{}` timed out after {} seconds",
                plugin.manifest.id,
                PLUGIN_CALL_DEADLINE.as_secs()
            )
        })?
        .map_err(|error| format!("plugin task failed: {error}"))?
        .map_err(|error| error.to_string())?;
        self.events.publish(AppEvent::Plugin(json!({
            "pluginId": plugin.manifest.id,
            "type": "action-result",
            "actionType": type_id,
            "response": response
        })));

        let mut parts = Vec::new();
        for log in response
            .get("logs")
            .into_iter()
            .flat_map(as_values)
            .filter_map(Value::as_str)
        {
            if logs.len() < 40 {
                logs.push(log.to_owned());
            }
        }
        for intent in response
            .get(tiktools_plugin_api::AUDIO_PLAY_INTENT)
            .into_iter()
            .flat_map(as_values)
        {
            self.capabilities
                .require_capability(&plugin.manifest, tiktools_plugin_api::CAPABILITY_AUDIO_PLAY)
                .map_err(|error| error.to_string())?;
            self.capabilities
                .require_permission(
                    &plugin.manifest,
                    tiktools_plugin_api::capabilities::AUDIO_OUTPUT_PERMISSION,
                )
                .map_err(|error| error.to_string())?;
            let Some(intent) = intent.as_object() else {
                continue;
            };
            parts.push(self.execute_audio_action(intent, event, logs, test).await?);
        }
        for intent in response.get("emit").into_iter().flat_map(as_values) {
            let Some(intent) = intent.as_object() else {
                continue;
            };
            let Some(event_type) = intent.get("type").and_then(Value::as_str) else {
                continue;
            };
            let event_type = normalize_emit_type(event_type)?;
            let payload = Value::Object(
                intent
                    .get("data")
                    .map(|value| render_json_map(value, event))
                    .unwrap_or_default()
                    .into_iter()
                    .collect(),
            );
            if let Some(typed) =
                self.plugin_typed_event(&plugin.manifest, &event_type, &payload, event)?
            {
                self.publish_automation_event(typed).await;
                parts.push(format!("emit {event_type}"));
                continue;
            }
            self.publish_automation_event(self.make_internal_automation_event(
                event,
                &event_type,
                payload,
            ))
            .await;
            parts.push(format!("emit {event_type}"));
        }
        if let Some(summary) = response.get("summary").and_then(Value::as_str) {
            parts.push(summary.to_owned());
        }
        if parts.is_empty() {
            parts.push(format!("plugin {} completed", plugin.manifest.id));
        }
        Ok(parts.join(" · "))
    }

    pub(super) fn plugin_for_action(
        &self,
        type_id: &str,
    ) -> Option<(tiktools_plugin_loader::DiscoveredPlugin, Value)> {
        self.plugins.list().into_iter().find_map(|plugin| {
            plugin
                .manifest
                .action_types
                .iter()
                .find(|descriptor| descriptor.get("id").and_then(Value::as_str) == Some(type_id))
                .cloned()
                .map(|descriptor| (plugin, descriptor))
        })
    }

    pub(super) fn plugin_ready(&self, id: &str) -> bool {
        let Some(plugin) = self.plugins.get(id) else {
            return false;
        };
        if !plugin.available {
            return false;
        }
        #[cfg(feature = "persistence")]
        if let Ok(snapshot) = self.db.load_behavior_snapshot() {
            if let Some(state) = snapshot
                .get("plugins")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .find(|state| state.get("id").and_then(Value::as_str) == Some(id))
            {
                return state.get("installed").and_then(Value::as_bool) == Some(true)
                    && state.get("enabled").and_then(Value::as_bool) == Some(true);
            }
        }
        true
    }

    /// Builds a typed event for one of the calling plugin's declared event
    /// types. The host stamps identity, timing, depth, and connection context;
    /// the plugin only supplies the type and its data payload.
    pub(super) fn make_plugin_event(&self, source: &Value, event_type: &str, data: Value) -> Value {
        let mut event = json!({
            "id": format!("plugin-event-{}", self.next_sequence()),
            "type": event_type,
            "timestamp": now_millis(),
            "data": data,
        });
        if let Some(data) = event.get_mut("data").and_then(Value::as_object_mut) {
            data.insert(
                "depth".to_owned(),
                Value::from(self.automation.emit_depth(source).saturating_add(1)),
            );
        }
        for key in ["connectionId", "creator", "user"] {
            if let Some(value) = source.get(key) {
                event[key] = value.clone();
            }
        }
        if let Some(source_id) = source.get("id") {
            event["sourceEventId"] = source_id.clone();
        }
        event
    }

    /// Resolves a plugin `emit` intent to a typed event when the type is one
    /// of that plugin's declared event types. Returns `Ok(None)` for anything
    /// else so the caller keeps the internal `plugin.emit` channel, and an
    /// error when the plugin did not declare the `events.publish` capability.
    pub(super) fn plugin_typed_event(
        &self,
        manifest: &tiktools_plugin_api::manifest::PluginManifest,
        event_type: &str,
        data: &Value,
        source: &Value,
    ) -> Result<Option<Value>, String> {
        if !declared_event_types(manifest).contains(&event_type.to_owned()) {
            return Ok(None);
        }
        self.capabilities
            .require_capability(manifest, tiktools_plugin_api::capabilities::EVENTS_PUBLISH)
            .map_err(|error| error.to_string())?;
        if !data.is_object()
            || serde_json::to_vec(&data)
                .map(|bytes| bytes.len() > MAX_PLUGIN_EVENT_BYTES)
                .unwrap_or(true)
        {
            return Err(format!(
                "Plugin event `{event_type}` needs an object payload under 64 KB."
            ));
        }
        Ok(Some(self.make_plugin_event(
            source,
            event_type,
            data.clone(),
        )))
    }

    /// Sample event for a plugin-owned trigger, taken from the declaring
    /// plugin's manifest sample so `test-event` previews realistic data.
    pub(super) fn plugin_event_sample(&self, trigger: &str) -> Option<Value> {
        for plugin in self.plugins.list() {
            for entry in &plugin.manifest.event_types {
                if tiktools_plugin_api::manifest::validate_event_type(entry).is_err() {
                    continue;
                }
                if entry.get("type").and_then(Value::as_str) != Some(trigger) {
                    continue;
                }
                let data = entry
                    .get("sample")
                    .and_then(Value::as_object)
                    .cloned()
                    .unwrap_or_default();
                return Some(json!({
                    "id": "sample-event",
                    "type": trigger,
                    "timestamp": now_millis(),
                    "user": {"uniqueId": "viewer_demo", "nickname": "Viewer Demo", "userId": "1"},
                    "data": Value::Object(data),
                }));
            }
        }
        None
    }

    /// Starts the background poll that lets running plugins publish
    /// spontaneous events (hotkeys, timers, watchers). Ticks are cheap no-ops
    /// while no plugin declares event types; shutdown stops the plugins, which
    /// empties every later tick until the process exits.
    pub fn spawn_plugin_event_poll(self: &Arc<Self>) {
        let core = Arc::clone(self);
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(PLUGIN_POLL_INTERVAL);
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                ticker.tick().await;
                core.poll_plugin_events().await;
            }
        });
    }

    pub(super) async fn poll_plugin_events(self: &Arc<Self>) {
        let candidates: Vec<(String, Vec<String>)> = self
            .plugins
            .list()
            .into_iter()
            .filter(|plugin| plugin.running && self.plugin_ready(&plugin.manifest.id))
            .filter_map(|plugin| {
                let declared = declared_event_types(&plugin.manifest);
                if declared.is_empty() {
                    return None;
                }
                if self
                    .capabilities
                    .require_capability(
                        &plugin.manifest,
                        tiktools_plugin_api::capabilities::EVENTS_PUBLISH,
                    )
                    .is_err()
                {
                    return None;
                }
                Some((plugin.manifest.id.clone(), declared))
            })
            .collect();
        if candidates.is_empty() {
            return;
        }
        let source = self
            .last_automation_event
            .read()
            .expect("automation event lock poisoned")
            .clone()
            .unwrap_or_else(|| json!({}));
        for (plugin_id, declared) in candidates {
            let plugins = Arc::clone(&self.plugins);
            let request = serde_json::json!({"type": "poll"});
            let plugin_id_for_call = plugin_id.clone();
            let outcome = tokio::time::timeout(
                PLUGIN_POLL_DEADLINE,
                tokio::task::spawn_blocking(move || plugins.call(&plugin_id_for_call, &request)),
            )
            .await;
            let response = match outcome {
                Ok(Ok(Ok(response))) => response,
                Ok(Ok(Err(error))) => {
                    tracing::debug!(plugin = %plugin_id, %error, "plugin poll failed");
                    continue;
                }
                Ok(Err(error)) => {
                    tracing::debug!(plugin = %plugin_id, %error, "plugin poll task failed");
                    continue;
                }
                Err(_) => {
                    tracing::debug!(plugin = %plugin_id, "plugin poll timed out");
                    continue;
                }
            };
            for (event_type, data) in parse_polled_events(&declared, &response) {
                self.publish_automation_event(self.make_plugin_event(&source, &event_type, data))
                    .await;
            }
        }
    }

    pub(super) fn make_internal_automation_event(
        &self,
        source: &Value,
        event_type: &str,
        payload: Value,
    ) -> Value {
        let mut event = json!({
            "id": format!("plugin-emit-{}", self.next_sequence()),
            "type": "plugin.emit",
            "timestamp": now_millis(),
            "data": {
                "emitType": event_type,
                "depth": self.automation.emit_depth(source).saturating_add(1),
                "payload": payload
            }
        });
        for key in ["connectionId", "creator", "user"] {
            if let Some(value) = source.get(key) {
                event[key] = value.clone();
            }
        }
        if let Some(source_id) = source.get("id") {
            event["sourceEventId"] = source_id.clone();
        }
        event
    }
}
