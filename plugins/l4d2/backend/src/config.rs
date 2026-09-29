//! Host-managed settings for the RCON backend.
//!
//! The host writes `<TIKTOOLS_PLUGIN_DATA_DIR>/<plugin-id>/settings.json`
//! from the settings UI (same contract as every process plugin); the
//! backend re-reads it on every action so host/port/password edits apply
//! without a restart. The password is a `secret` schema field: the real
//! value lives only in that file, and this module is careful never to
//! let it reach logs, errors, or Debug output.

use std::path::PathBuf;
use std::time::Duration;

use serde_json::Value;

const DEFAULT_PLUGIN_ID: &str = "l4d2.interactive";
const MIN_TIMEOUT_MS: u64 = 2000;
const MAX_TIMEOUT_MS: u64 = 12000;
const MIN_PER_MINUTE: u64 = 1;
const MAX_PER_MINUTE: u64 = 120;
/// Connect budget stays small so a dead server fails fast; the rest of
/// the action timeout stays available for auth plus one command.
const CONNECT_TIMEOUT_MS: u64 = 3000;

/// No Debug impl on purpose: the only printable view is [`L4d2Settings::redacted`].
#[derive(Clone)]
pub struct L4d2Settings {
    pub host: String,
    pub port: u16,
    password: String,
    pub timeout: Duration,
    pub max_per_minute: u64,
}

impl L4d2Settings {
    pub fn password(&self) -> &str {
        &self.password
    }
}

/// Debug deliberately omits the password: a stray `{:?}` in a log line
/// must never exfiltrate the RCON credential.
impl std::fmt::Debug for RedactedSettings {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("L4d2Settings")
            .field("host", &self.0.host)
            .field("port", &self.0.port)
            .field("password", &"[redacted]")
            .field("timeout", &self.0.timeout)
            .field("max_per_minute", &self.0.max_per_minute)
            .finish()
    }
}

/// Redacted Debug view; use `settings.redacted()` anywhere a value might
/// be logged.
pub struct RedactedSettings(L4d2Settings);

impl std::fmt::Display for RedactedSettings {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}:{}", self.0.host, self.0.port)
    }
}

impl L4d2Settings {
    pub fn redacted(&self) -> RedactedSettings {
        RedactedSettings(self.clone())
    }
}

fn settings_path() -> PathBuf {
    let root = std::env::var("TIKTOOLS_PLUGIN_DATA_DIR").unwrap_or_else(|_| ".".to_owned());
    let id = std::env::var("TIKTOOLS_PLUGIN_ID").unwrap_or_else(|_| DEFAULT_PLUGIN_ID.to_owned());
    PathBuf::from(root).join(id).join("settings.json")
}

/// Loads settings from the host-managed path for this process.
pub fn load() -> Result<L4d2Settings, String> {
    load_from_file(&settings_path())
}

/// Loads settings from an explicit file (tests and tooling).
pub fn load_from_file(path: &std::path::Path) -> Result<L4d2Settings, String> {
    let raw = std::fs::read_to_string(path)
        .map_err(|_| "L4D2 settings are missing: open the plugin settings and save the RCON host, port, and password.".to_owned())?;
    parse(&raw)
}

fn text_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(|text| text.trim().to_owned())
        .filter(|text| !text.is_empty())
}

fn int_field(value: &Value, key: &str) -> Option<i64> {
    value.get(key).and_then(Value::as_i64)
}

fn parse(raw: &str) -> Result<L4d2Settings, String> {
    let value: Value = serde_json::from_str(raw).map_err(|_| {
        "L4D2 settings are not valid JSON; re-save them in the plugin settings.".to_owned()
    })?;
    let host = text_field(&value, "host").ok_or_else(|| "L4D2 RCON host is missing.".to_owned())?;
    if host.len() > 253
        || host.contains(char::is_whitespace)
        || host.contains("://")
        || host.contains('\0')
    {
        return Err("L4D2 RCON host must be a plain hostname or IP (no scheme, no spaces).".into());
    }
    let port = int_field(&value, "port")
        .filter(|port| (1..=65535).contains(port))
        .ok_or_else(|| "L4D2 RCON port must be 1..65535.".to_owned())? as u16;
    let password = text_field(&value, "password")
        .filter(|password| password.len() <= 256)
        .ok_or_else(|| "L4D2 RCON password is missing.".to_owned())?;
    let timeout_ms = int_field(&value, "timeoutMs")
        .filter(|timeout| (MIN_TIMEOUT_MS as i64..=MAX_TIMEOUT_MS as i64).contains(timeout))
        .ok_or_else(|| {
            format!("L4D2 RCON timeout must be {MIN_TIMEOUT_MS}..{MAX_TIMEOUT_MS} ms.")
        })? as u64;
    let max_per_minute = int_field(&value, "maxPerMinute")
        .filter(|rate| (MIN_PER_MINUTE as i64..=MAX_PER_MINUTE as i64).contains(rate))
        .ok_or_else(|| {
            format!("L4D2 rate limit must be {MIN_PER_MINUTE}..{MAX_PER_MINUTE} per minute.")
        })? as u64;
    Ok(L4d2Settings {
        host,
        port,
        password,
        timeout: Duration::from_millis(timeout_ms),
        max_per_minute,
    })
}

impl L4d2Settings {
    pub fn rcon_timeouts(&self) -> crate::rcon::RconTimeouts {
        crate::rcon::RconTimeouts {
            connect: Duration::from_millis(CONNECT_TIMEOUT_MS.min(self.timeout.as_millis() as u64)),
            io: self.timeout,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_settings(contents: &str) -> (tempfile_guard::Guard, PathBuf) {
        // No tempfile dependency: unique sibling under the OS temp dir.
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let id = COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let path = std::env::temp_dir().join(format!("tiktools-l4d2-settings-{id}.json"));
        std::fs::write(&path, contents).expect("fixture");
        (tempfile_guard::Guard(path.clone()), path)
    }

    /// Minimal RAII cleanup without adding a dependency.
    mod tempfile_guard {
        pub struct Guard(pub std::path::PathBuf);
        impl Drop for Guard {
            fn drop(&mut self) {
                let _ = std::fs::remove_file(&self.0);
            }
        }
    }

    const VALID: &str = r#"{"host":"127.0.0.1","port":27015,"password":"s3cret","timeoutMs":8000,"maxPerMinute":30}"#;

    #[test]
    fn loads_valid_settings() {
        let (_guard, path) = write_settings(VALID);
        let settings = load_from_file(&path).expect("valid");
        assert_eq!(settings.host, "127.0.0.1");
        assert_eq!(settings.port, 27015);
        assert_eq!(settings.password(), "s3cret");
        assert_eq!(settings.timeout, Duration::from_millis(8000));
        assert_eq!(settings.max_per_minute, 30);
        assert_eq!(
            settings.rcon_timeouts().connect,
            Duration::from_millis(3000)
        );
    }

    #[test]
    fn missing_file_points_at_the_settings_ui() {
        let error = load_from_file(std::path::Path::new(
            "/nonexistent/tiktools-l4d2-settings.json",
        ))
        .map(|_| ())
        .expect_err("must fail");
        assert!(error.contains("plugin settings"), "{error}");
    }

    #[test]
    fn rejects_bad_host_port_and_password() {
        for raw in [
            r#"{"host":"","port":27015,"password":"x","timeoutMs":8000,"maxPerMinute":30}"#,
            r#"{"host":"http://x/","port":27015,"password":"x","timeoutMs":8000,"maxPerMinute":30}"#,
            r#"{"host":"a b","port":27015,"password":"x","timeoutMs":8000,"maxPerMinute":30}"#,
            r#"{"host":"127.0.0.1","port":0,"password":"x","timeoutMs":8000,"maxPerMinute":30}"#,
            r#"{"host":"127.0.0.1","port":99999,"password":"x","timeoutMs":8000,"maxPerMinute":30}"#,
            r#"{"host":"127.0.0.1","port":27015,"password":"","timeoutMs":8000,"maxPerMinute":30}"#,
            r#"{"host":"127.0.0.1","port":27015,"password":"x","timeoutMs":500,"maxPerMinute":30}"#,
            r#"{"host":"127.0.0.1","port":27015,"password":"x","timeoutMs":8000,"maxPerMinute":0}"#,
            "not json",
        ] {
            assert!(parse(raw).is_err(), "{raw}");
        }
    }

    #[test]
    fn debug_output_redacts_the_password() {
        let settings = parse(VALID).expect("valid");
        let rendered = format!("{:?}", settings.redacted());
        assert!(rendered.contains("127.0.0.1"));
        assert!(!rendered.contains("s3cret"), "{rendered}");
    }
}
