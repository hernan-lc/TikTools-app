use super::*;

pub(crate) fn empty_behavior_snapshot() -> serde_json::Value {
    json!({
        "actions": [],
        "events": [],
        "plugins": [],
        "actionTypes": builtin_action_types(),
        "translations": builtin_translations()
    })
}

pub(crate) fn localized(default: &str, key: &str) -> Value {
    json!({"default": default, "i18key": key})
}

pub(crate) fn is_identifier(value: &str) -> bool {
    let mut characters = value.chars();
    matches!(characters.next(), Some('a'..='z' | 'A'..='Z' | '_'))
        && value.len() <= 128
        && characters.all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-')
        })
}

pub(crate) fn normalize_emit_type(value: &str) -> Result<String, String> {
    let normalized = value
        .trim()
        .to_ascii_lowercase()
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-')
        })
        .take(64)
        .collect::<String>();
    if normalized.is_empty() {
        Err("Internal event needs a name.".to_owned())
    } else {
        Ok(normalized)
    }
}

pub(crate) fn number_value(value: Option<&Value>) -> Option<f64> {
    match value {
        Some(Value::Number(value)) => value.as_f64(),
        Some(Value::String(value)) => value.trim().parse().ok(),
        _ => None,
    }
}

pub(crate) fn hosts_in_source(source: &str) -> Vec<String> {
    let mut hosts = Vec::new();
    let mut rest = source;
    while let Some(offset) = rest.find("http://").or_else(|| rest.find("https://")) {
        let candidate = &rest[offset..];
        let end = candidate
            .find(|character: char| {
                character.is_whitespace()
                    || matches!(character, '"' | '\'' | '`' | ')' | '}' | ']' | ',')
            })
            .unwrap_or(candidate.len());
        let url = &candidate[..end];
        let host_start = url.find("://").map(|index| index + 3).unwrap_or(0);
        let host = url[host_start..]
            .split(['/', '?', '#'])
            .next()
            .unwrap_or_default()
            .trim_matches(['[', ']'])
            .split('@')
            .next_back()
            .unwrap_or_default()
            .split(':')
            .next()
            .unwrap_or_default()
            .to_ascii_lowercase();
        if !host.is_empty() && !host.contains('{') && !hosts.contains(&host) {
            hosts.push(host);
        }
        rest = &candidate[end..];
        if rest == candidate {
            break;
        }
    }
    hosts
}

#[cfg(feature = "http")]
pub(crate) async fn validate_http_url(
    url: &reqwest::Url,
    configured_host: &str,
    allowed_hosts: Option<&[String]>,
    allow_private_network: bool,
) -> Result<(), String> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Only http:// and https:// URLs are allowed.".to_owned());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("HTTP URLs cannot contain embedded credentials.".to_owned());
    }
    let host = url
        .host_str()
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "HTTP URL has no host.".to_owned())?;
    if host != configured_host {
        return Err("The rendered HTTP URL changed its configured host.".to_owned());
    }
    if let Some(allowed_hosts) = allowed_hosts {
        if !allowed_hosts.iter().any(|allowed| allowed == &host) {
            return Err(format!("HTTP host is not allowed by the script: {host}"));
        }
    }
    if is_private_host(&host) && !allow_private_network {
        return Err(format!("HTTP request to a private host is blocked: {host}"));
    }
    let port = url
        .port_or_known_default()
        .ok_or_else(|| "HTTP URL has no valid port.".to_owned())?;
    let addresses = tokio::net::lookup_host((host.as_str(), port))
        .await
        .map_err(|_| format!("HTTP host could not be resolved: {host}"))?;
    if !allow_private_network && addresses.map(|address| address.ip()).any(is_private_ip) {
        return Err(format!("HTTP host resolves to a private address: {host}"));
    }
    Ok(())
}

#[cfg(feature = "http")]
pub(crate) fn is_private_host(host: &str) -> bool {
    let normalized = host.trim_matches(['[', ']']).to_ascii_lowercase();
    normalized == "localhost"
        || normalized.ends_with(".localhost")
        || normalized.ends_with(".local")
        || normalized == "::"
        || normalized == "::1"
        || normalized
            .parse::<std::net::IpAddr>()
            .is_ok_and(is_private_ip)
}

#[cfg(feature = "http")]
pub(crate) fn is_private_ip(address: std::net::IpAddr) -> bool {
    match address {
        std::net::IpAddr::V4(address) => {
            let octets = address.octets();
            octets[0] == 0
                || octets[0] == 10
                || octets[0] == 127
                || (octets[0] == 100 && (64..=127).contains(&octets[1]))
                || (octets[0] == 169 && octets[1] == 254)
                || (octets[0] == 172 && (16..=31).contains(&octets[1]))
                || (octets[0] == 192 && octets[1] == 168)
        }
        std::net::IpAddr::V6(address) => {
            address.is_loopback()
                || address.is_unspecified()
                || (address.segments()[0] & 0xfe00) == 0xfc00
                || (address.segments()[0] & 0xffc0) == 0xfe80
        }
    }
}

pub(crate) fn render_json_map(
    value: &Value,
    event: &Value,
) -> std::collections::BTreeMap<String, Value> {
    value
        .as_object()
        .map(|object| {
            object
                .iter()
                .map(|(key, value)| {
                    let value = value
                        .as_str()
                        .map(|value| Value::String(render_template(value, event)))
                        .unwrap_or_else(|| value.clone());
                    (key.clone(), value)
                })
                .collect()
        })
        .unwrap_or_default()
}

pub(crate) fn render_template(source: &str, event: &Value) -> String {
    let mut rendered = String::with_capacity(source.len());
    let mut rest = source;
    while let Some(start) = rest.find("{{") {
        rendered.push_str(&rest[..start]);
        let expression = &rest[start + 2..];
        let Some(end) = expression.find("}}") else {
            rendered.push_str(&rest[start..]);
            break;
        };
        let path = expression[..end].trim();
        if let Some(value) = read_event_path(event, path) {
            rendered.push_str(&value_to_string(value));
        }
        rest = &expression[end + 2..];
    }
    rendered.push_str(rest);
    rendered
}

pub(crate) fn read_event_path<'a>(event: &'a Value, path: &str) -> Option<&'a Value> {
    let path = path.trim();
    let path = path.strip_prefix("event.").unwrap_or(path);
    let path = path.strip_prefix("event").unwrap_or(path);
    let mut current = event;
    for part in path.trim_matches('.').split('.') {
        if part.is_empty() {
            continue;
        }
        current = current.get(part)?;
    }
    Some(current)
}

pub(crate) fn value_to_string(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(value) => value.clone(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::Array(_) | Value::Object(_) => serde_json::to_string(value).unwrap_or_default(),
    }
}

pub(crate) fn result_type(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

pub(crate) fn as_values(value: &Value) -> Vec<&Value> {
    match value {
        Value::Array(values) => values.iter().collect(),
        value => vec![value],
    }
}

pub(crate) fn sample_automation_event(event_type: &str) -> Value {
    json!({
        "id": "sample-event",
        "type": event_type,
        "timestamp": now_millis(),
        "user": {"uniqueId": "viewer_demo", "nickname": "Viewer Demo", "userId": "1"},
        "data": {"comment": "hello", "giftName": "Rosa", "diamondCount": 1, "count": 1}
    })
}

#[derive(Debug, Clone)]
pub(crate) struct LiveContext {
    pub(crate) unique_id: String,
    pub(crate) room_id: String,
    pub(crate) connection_id: String,
}

#[cfg(feature = "native-tiktok")]
pub(crate) fn clean_unique_id(value: &str) -> Option<String> {
    let value = value.trim().trim_start_matches('@');
    (!value.is_empty()).then_some(value.to_owned())
}

#[cfg(feature = "native-tiktok")]
pub(crate) fn native_user(event: &NativeLiveEvent) -> Option<&tiktools_tiktok::events::EventUser> {
    match event {
        NativeLiveEvent::Chat { user, .. }
        | NativeLiveEvent::Gift { user, .. }
        | NativeLiveEvent::Like { user, .. }
        | NativeLiveEvent::Member { user, .. }
        | NativeLiveEvent::Social { user, .. } => Some(user),
        NativeLiveEvent::RoomUser { .. } | NativeLiveEvent::Unknown { .. } => None,
    }
}

#[cfg(feature = "native-tiktok")]
pub(crate) fn client_event_kind(event: &ClientEvent) -> &'static str {
    match event {
        ClientEvent::Connected(_) => "connected",
        ClientEvent::Event(_) => "live-event",
        ClientEvent::Reconnecting { .. } => "reconnecting",
        ClientEvent::Disconnected { .. } => "disconnected",
        ClientEvent::Error { .. } => "error",
    }
}

#[cfg(feature = "native-tiktok")]
pub(crate) fn user_value(user: &tiktools_tiktok::events::EventUser) -> serde_json::Value {
    json!({
        "userId": user.user_id,
        "uniqueId": clean_unique_id(&user.unique_id).unwrap_or_else(|| "viewer".to_owned()),
        "nickname": user.nickname,
    })
}

#[cfg(feature = "native-tiktok")]
pub(crate) fn creator_value(info: &tiktools_tiktok::ConnectionInfo) -> serde_json::Value {
    json!({
        "uniqueId": info.unique_id,
        "roomId": info.room_id,
        "nickname": info.nickname,
        "avatarUrl": info.avatar_url,
        "title": info.title,
        "lastConnected": now_millis(),
        "connectCount": 1,
        "displayId": info.unique_id,
    })
}

pub(crate) fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or_default()
}
