#![forbid(unsafe_code)]
// Release plugin executables must not allocate a console on Windows; the
// host launches them with CREATE_NO_WINDOW and talks over piped stdio.
#![cfg_attr(
    all(target_os = "windows", not(debug_assertions)),
    windows_subsystem = "windows"
)]

//! L4D2 Interactive process backend: one RCON command per action call.
//!
//! Dispatch is deliberately thin: load host-managed settings, validate
//! the action config into an exact adapter command line, rate-limit,
//! execute over a fresh RCON connection, and classify the answer.
//! Transport failures are errors; game rejections are honest result
//! summaries; a missing confirmation is an error, never a success.

mod command;
mod config;
mod ratelimit;
mod rcon;

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

use serde_json::Value;
use tiktools_plugin_sdk::prelude::*;

use ratelimit::RateLimiter;

static REQID_COUNTER: AtomicU64 = AtomicU64::new(1);

fn next_reqid() -> String {
    let id = REQID_COUNTER.fetch_add(1, Ordering::SeqCst);
    format!("r{}_{}", std::process::id(), id)
}

#[derive(Debug, Default)]
struct L4d2Plugin {
    limiter: Option<RateLimiter>,
}

impl L4d2Plugin {
    fn check_rate(&mut self, max_per_minute: u64) -> Result<(), String> {
        // The host serializes calls per plugin, so &mut access is enough;
        // no lock needed around the limiter.
        let limiter = self
            .limiter
            .get_or_insert_with(|| RateLimiter::new(max_per_minute));
        // Rebuild when the operator retunes the setting mid-run.
        if limiter.max_per_minute() != max_per_minute {
            *limiter = RateLimiter::new(max_per_minute);
        }
        limiter.check(Instant::now()).map_err(|wait| {
            format!(
                "L4D2 rate limit reached ({} per minute); retry in {}s.",
                max_per_minute,
                wait.as_secs().max(1)
            )
        })
    }

    fn run_action(&mut self, action_type: &str, config: &Value) -> PluginResult<ActionResult> {
        // Unknown actions fail before settings load: no point demanding
        // RCON credentials for a call that could never run.
        if !matches!(
            action_type,
            command::ACTION_TEST_CONNECTION
                | command::ACTION_SPAWN_COMMON
                | command::ACTION_SPAWN_INFECTED
                | command::ACTION_SPAWN_ITEM
        ) {
            return Err(PluginError::unsupported(action_type));
        }
        let settings = config::load().map_err(PluginError::invalid_request)?;
        let built = command::build_command(action_type, config, &next_reqid())?;
        self.check_rate(settings.max_per_minute)
            .map_err(PluginError::other)?;
        // No retries after a timeout: the game may have acted despite the
        // lost reply, and a rerun could double-spawn. One attempt, one truth.
        let body = rcon::execute(
            &settings.host,
            settings.port,
            settings.password(),
            &built.line,
            settings.rcon_timeouts(),
        )
        .map_err(|error| PluginError::other(format!("L4D2 RCON failed: {error}")))?;
        let reqid = built
            .line
            .split_whitespace()
            .nth(1)
            .unwrap_or_default()
            .to_owned();
        let mut result = command::outcome_result(&built, &command::parse_response(&body, &reqid))?;
        // Which server answered (host:port only — the credential never
        // appears in results).
        result
            .logs
            .push(format!("endpoint={}", settings.redacted()));
        Ok(result)
    }
}

impl Plugin for L4d2Plugin {
    fn action(&mut self, _context: &PluginContext, call: ActionCall) -> PluginResult<ActionResult> {
        let action_type = call.action_type().unwrap_or_default();
        let config = Value::Object(call.config().clone());
        self.run_action(action_type, &config)
    }
}

tiktools_process_plugin!(L4d2Plugin);

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn unknown_action_needs_no_settings() {
        let mut plugin = L4d2Plugin::default();
        let error = plugin
            .run_action("l4d2.nope", &json!({}))
            .expect_err("must fail");
        assert!(matches!(error, PluginError::UnsupportedAction(_)));
    }

    #[test]
    fn invalid_config_fails_before_any_socket() {
        let mut plugin = L4d2Plugin::default();
        // Count 99 is rejected by validation without ever reading settings
        // or opening a socket.
        let error = plugin
            .run_action(command::ACTION_SPAWN_COMMON, &json!({"count": 99}))
            .expect_err("must fail");
        assert!(matches!(error, PluginError::InvalidRequest(_)), "{error:?}");
    }

    #[test]
    fn rate_limit_kicks_in_across_calls() {
        let mut plugin = L4d2Plugin::default();
        for _ in 0..3 {
            assert!(plugin.check_rate(3).is_ok());
        }
        assert!(plugin.check_rate(3).is_err());
    }
}
