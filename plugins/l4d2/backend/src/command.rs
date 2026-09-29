//! Adapter command construction and response classification.
//!
//! Every action config is validated against strict allowlists before any
//! byte reaches the socket: tokens must match exactly (no partial parses,
//! no quoting games — the values that reach RCON are either exact
//! allowlist hits or bounded integers), so a hostile config can at worst
//! be rejected, never smuggle a second command.
//!
//! Responses are classified, never assumed: only a `TT_OK`/`TT_ERR` line
//! carrying our reqid counts as an answer. Anything else — including a
//! transport that worked fine but carried no confirmation — is
//! [`AdapterOutcome::Unknown`], which the caller reports as unconfirmed
//! rather than as a success.

use serde_json::Value;
use tiktools_plugin_sdk::{ActionResult, PluginError};

pub const ACTION_TEST_CONNECTION: &str = "l4d2.test_connection";
pub const ACTION_SPAWN_COMMON: &str = "l4d2.spawn_common";
pub const ACTION_SPAWN_INFECTED: &str = "l4d2.spawn_infected";
pub const ACTION_SPAWN_ITEM: &str = "l4d2.spawn_item";

pub const CLASSES: [&str; 8] = [
    "tank", "witch", "smoker", "boomer", "hunter", "spitter", "jockey", "charger",
];
pub const ITEMS: [&str; 6] = [
    "first_aid_kit",
    "pain_pills",
    "adrenaline",
    "pipe_bomb",
    "molotov",
    "defibrillator",
];

/// Transport-level bounds (the adapter enforces its own caps on top and
/// reports the actual spawn count, which is what we surface).
const COMMON_MAX: i64 = 25;
const SPECIAL_MAX: i64 = 8;
const ITEM_MAX: i64 = 5;

/// A validated command line plus the metadata the caller needs to report
/// an honest outcome.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BuiltCommand {
    /// Exact line sent over RCON, e.g. `tt_spawn_common r12 5`.
    pub line: String,
    /// Short human label for summaries, e.g. `Spawn common horde`.
    pub label: String,
    pub is_tank: bool,
}

fn config_text(config: &Value, key: &str) -> Option<String> {
    config
        .get(key)
        .and_then(Value::as_str)
        .map(|text| text.trim().to_owned())
        .filter(|text| !text.is_empty())
}

fn config_count(config: &Value, key: &str, max: i64) -> Result<i64, PluginError> {
    let count = config
        .get(key)
        .and_then(Value::as_i64)
        .ok_or_else(|| PluginError::invalid_request(format!("`{key}` must be a whole number.")))?;
    if !(1..=max).contains(&count) {
        return Err(PluginError::invalid_request(format!(
            "`{key}` must be 1..={max}."
        )));
    }
    Ok(count)
}

fn check_reqid(reqid: &str) -> Result<(), PluginError> {
    let valid = !reqid.is_empty()
        && reqid.len() <= 32
        && reqid
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-');
    if valid {
        Ok(())
    } else {
        Err(PluginError::invalid_request(
            "internal request id is malformed.",
        ))
    }
}

/// Builds the exact RCON line for an action call. Unknown actions,
/// unknown tokens, and out-of-range counts are rejected here — nothing
/// reaches the socket unless it is fully valid.
pub fn build_command(
    action_type: &str,
    config: &Value,
    reqid: &str,
) -> Result<BuiltCommand, PluginError> {
    check_reqid(reqid)?;
    match action_type {
        ACTION_TEST_CONNECTION => Ok(BuiltCommand {
            line: format!("tt_status {reqid}"),
            label: "Test connection".into(),
            is_tank: false,
        }),
        ACTION_SPAWN_COMMON => {
            let count = config_count(config, "count", COMMON_MAX)?;
            Ok(BuiltCommand {
                line: format!("tt_spawn_common {reqid} {count}"),
                label: "Spawn common horde".into(),
                is_tank: false,
            })
        }
        ACTION_SPAWN_INFECTED => {
            let class = config_text(config, "class").ok_or_else(|| {
                PluginError::invalid_request("`class` must be a special infected name.")
            })?;
            if !CLASSES.contains(&class.as_str()) {
                return Err(PluginError::invalid_request(format!(
                    "unknown infected class `{class}`."
                )));
            }
            let count = config_count(config, "count", SPECIAL_MAX)?;
            if class == "tank" && count != 1 {
                return Err(PluginError::invalid_request("tank count is always 1."));
            }
            Ok(BuiltCommand {
                line: format!("tt_spawn_infected {reqid} {class} {count}"),
                label: format!("Spawn {class}"),
                is_tank: class == "tank",
            })
        }
        ACTION_SPAWN_ITEM => {
            let item = config_text(config, "item")
                .ok_or_else(|| PluginError::invalid_request("`item` must be an item name."))?;
            if !ITEMS.contains(&item.as_str()) {
                return Err(PluginError::invalid_request(format!(
                    "unknown item `{item}`."
                )));
            }
            let count = config_count(config, "count", ITEM_MAX)?;
            Ok(BuiltCommand {
                line: format!("tt_spawn_item {reqid} {item} {count}"),
                label: format!("Spawn {item}"),
                is_tank: false,
            })
        }
        _ => Err(PluginError::unsupported(action_type)),
    }
}

/// Classified adapter answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AdapterOutcome {
    /// `TT_OK|<reqid>|...`: the game confirmed. Fields are the raw
    /// `key=value` pairs (e.g. `spawned`, `requested`, `map`).
    Confirmed(Vec<(String, String)>),
    /// `TT_ERR|<reqid>|CODE|detail`: the game refused or failed.
    Rejected { code: String, detail: String },
    /// No protocol line for our reqid: the transport may have worked,
    /// but nothing confirms the game acted. Must never be reported as
    /// a success.
    Unknown,
}

/// Scans a raw RCON body for our protocol line. Server output can carry
/// echoes or unrelated console lines, so only an exact `TT_*|<reqid>|`
/// prefix match counts — and only the first such line.
pub fn parse_response(body: &str, reqid: &str) -> AdapterOutcome {
    let ok_prefix = format!("TT_OK|{reqid}|");
    let err_prefix = format!("TT_ERR|{reqid}|");
    for line in body.lines() {
        let line = line.trim();
        if let Some(payload) = line.strip_prefix(&ok_prefix) {
            let fields = payload
                .split('|')
                .filter_map(|pair| {
                    let (key, value) = pair.split_once('=')?;
                    if key.is_empty() {
                        return None;
                    }
                    Some((key.to_owned(), value.to_owned()))
                })
                .collect();
            return AdapterOutcome::Confirmed(fields);
        }
        if let Some(payload) = line.strip_prefix(&err_prefix) {
            let (code, detail) = payload
                .split_once('|')
                .map(|(code, detail)| (code.to_owned(), detail.to_owned()))
                .unwrap_or((payload.to_owned(), String::new()));
            if code.is_empty() {
                continue;
            }
            return AdapterOutcome::Rejected { code, detail };
        }
    }
    AdapterOutcome::Unknown
}

fn field<'a>(fields: &'a [(String, String)], key: &str) -> Option<&'a str> {
    fields
        .iter()
        .find(|(name, _)| name == key)
        .map(|(_, value)| value.as_str())
}

/// Turns a classified answer into the user-facing result. Rejections are
/// returned as `Ok` results with honest summaries (the action ran; the
/// game said no), while [`AdapterOutcome::Unknown`] becomes an error so a
/// missing confirmation can never look like a success.
pub fn outcome_result(
    built: &BuiltCommand,
    outcome: &AdapterOutcome,
) -> Result<ActionResult, PluginError> {
    match outcome {
        AdapterOutcome::Confirmed(fields) => {
            let summary = if built.line.starts_with("tt_status ") {
                format!(
                    "Connected: map {} ({} survivors, {} commons, {}/{} entities).",
                    field(fields, "map").unwrap_or("?"),
                    field(fields, "survivors").unwrap_or("?"),
                    field(fields, "commons").unwrap_or("?"),
                    field(fields, "entities").unwrap_or("?"),
                    field(fields, "entities_max").unwrap_or("?"),
                )
            } else {
                let spawned = field(fields, "spawned").unwrap_or("?");
                let requested = field(fields, "requested").unwrap_or("?");
                let mut summary = if spawned == requested {
                    format!("{}: game confirmed {spawned}/{requested}.", built.label)
                } else {
                    format!(
                        "{}: game confirmed only {spawned}/{requested} (see logs).",
                        built.label
                    )
                };
                // The adapter reports fallback=N when director spawn areas
                // were unavailable and it placed specials near a survivor
                // instead. Surface it: placement differs from the normal path.
                if field(fields, "fallback").is_some_and(|n| n != "0") {
                    summary.push_str(
                        " (fallback positioning: director spawn areas unavailable).",
                    );
                }
                summary
            };
            let mut result = ActionResult::summary(summary);
            result.logs.push(format!("sent: {}", built.line));
            for (key, value) in fields {
                result.logs.push(format!("{key}={value}"));
            }
            Ok(result)
        }
        AdapterOutcome::Rejected { code, detail } => {
            let mut result = ActionResult::summary(rejected_summary(built, code, detail));
            result.logs.push(format!("sent: {}", built.line));
            result.logs.push(format!("adapter: TT_ERR {code} {detail}"));
            Ok(result)
        }
        AdapterOutcome::Unknown => Err(PluginError::other(format!(
            "{}: no confirmation from the game (transport ok, no TT_OK/TT_ERR for this request). Check that the adapter plugin is loaded.",
            built.label
        ))),
    }
}

fn rejected_summary(built: &BuiltCommand, code: &str, detail: &str) -> String {
    match code {
        "TANK_COOLDOWN" => format!("{}: tank is on cooldown ({}).", built.label, detail),
        "COOLDOWN" => format!("{}: rate limited by the game ({}).", built.label, detail),
        "NO_SURVIVOR" => format!("{}: no alive survivor to anchor the spawn.", built.label),
        "ENTITY_CAP" => format!("{}: server entity cap reached ({}).", built.label, detail),
        "NO_NATIVES" => format!(
            "{}: game adapter is missing Left4DHooks or spawn_infected_nolimit ({}).",
            built.label, detail
        ),
        _ => format!("{}: rejected by the game ({code} {detail}).", built.label),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn builds_all_four_commands() {
        let status = build_command(ACTION_TEST_CONNECTION, &json!({}), "r1").expect("status");
        assert_eq!(status.line, "tt_status r1");
        let common =
            build_command(ACTION_SPAWN_COMMON, &json!({"count": 5}), "r2").expect("common");
        assert_eq!(common.line, "tt_spawn_common r2 5");
        let special = build_command(
            ACTION_SPAWN_INFECTED,
            &json!({"class": "hunter", "count": 2}),
            "r3",
        )
        .expect("special");
        assert_eq!(special.line, "tt_spawn_infected r3 hunter 2");
        assert!(!special.is_tank);
        let tank = build_command(
            ACTION_SPAWN_INFECTED,
            &json!({"class": "tank", "count": 1}),
            "r4",
        )
        .expect("tank");
        assert!(tank.is_tank);
        let item = build_command(
            ACTION_SPAWN_ITEM,
            &json!({"item": "molotov", "count": 2}),
            "r5",
        )
        .expect("item");
        assert_eq!(item.line, "tt_spawn_item r5 molotov 2");
    }

    #[test]
    fn rejects_unknown_actions_tokens_and_counts() {
        assert!(build_command("l4d2.nope", &json!({}), "r1").is_err());
        assert!(build_command(ACTION_SPAWN_COMMON, &json!({"count": 0}), "r1").is_err());
        assert!(build_command(ACTION_SPAWN_COMMON, &json!({"count": 26}), "r1").is_err());
        assert!(build_command(ACTION_SPAWN_COMMON, &json!({"count": "5"}), "r1").is_err());
        assert!(build_command(ACTION_SPAWN_COMMON, &json!({}), "r1").is_err());
        assert!(build_command(
            ACTION_SPAWN_INFECTED,
            &json!({"class": "tank", "count": 2}),
            "r1"
        )
        .is_err());
        assert!(build_command(
            ACTION_SPAWN_INFECTED,
            &json!({"class": " zombie ", "count": 1}),
            "r1"
        )
        .is_err());
        assert!(build_command(
            ACTION_SPAWN_ITEM,
            &json!({"item": "grenade", "count": 1}),
            "r1"
        )
        .is_err());
    }

    #[test]
    fn rejects_command_injection_shapes() {
        // Nothing but exact allowlist hits and bounded integers may pass;
        // separators, flags, and paths never reach the socket.
        for class in [
            "tank;quit",
            "tank quit",
            "tank|tt_status",
            "../tank",
            "tank\x00",
        ] {
            assert!(
                build_command(
                    ACTION_SPAWN_INFECTED,
                    &json!({"class": class, "count": 1}),
                    "r1"
                )
                .is_err(),
                "{class:?}"
            );
        }
        for item in [
            "molotov;quit",
            "molotov quit",
            "weapon_molotov",
            "molotov|rm",
        ] {
            assert!(
                build_command(ACTION_SPAWN_ITEM, &json!({"item": item, "count": 1}), "r1").is_err(),
                "{item:?}"
            );
        }
        for reqid in ["", "r 1", "r|1", "r;quit", &"r".repeat(33)] {
            assert!(
                build_command(ACTION_TEST_CONNECTION, &json!({}), reqid).is_err(),
                "{reqid:?}"
            );
        }
    }

    #[test]
    fn parses_ok_err_and_noise() {
        let ok = parse_response("noise\nTT_OK|r7|spawned=3|requested=3\n", "r7");
        assert_eq!(
            ok,
            AdapterOutcome::Confirmed(vec![
                ("spawned".into(), "3".into()),
                ("requested".into(), "3".into())
            ])
        );
        let err = parse_response("TT_ERR|r7|TANK_COOLDOWN|retry_in_s=42", "r7");
        assert_eq!(
            err,
            AdapterOutcome::Rejected {
                code: "TANK_COOLDOWN".into(),
                detail: "retry_in_s=42".into()
            }
        );
        // Wrong reqid, bare TT_OK, and empty bodies are all unknown.
        assert_eq!(
            parse_response("TT_OK|r8|spawned=1", "r7"),
            AdapterOutcome::Unknown
        );
        assert_eq!(
            parse_response("TT_OK|spawned=1", "r7"),
            AdapterOutcome::Unknown
        );
        assert_eq!(parse_response("", "r7"), AdapterOutcome::Unknown);
        assert_eq!(parse_response("ok done", "r7"), AdapterOutcome::Unknown);
    }

    #[test]
    fn outcomes_report_actuals_and_never_claim_unknown() {
        let built = build_command(ACTION_SPAWN_COMMON, &json!({"count": 5}), "r1").expect("cmd");
        let full = outcome_result(
            &built,
            &AdapterOutcome::Confirmed(vec![
                ("spawned".into(), "5".into()),
                ("requested".into(), "5".into()),
            ]),
        )
        .expect("ok");
        assert!(full.summary.unwrap().contains("5/5"));
        let short = outcome_result(
            &built,
            &AdapterOutcome::Confirmed(vec![
                ("spawned".into(), "2".into()),
                ("requested".into(), "5".into()),
            ]),
        )
        .expect("ok");
        assert!(short.summary.unwrap().contains("only 2/5"));
        let rejected = outcome_result(
            &built,
            &AdapterOutcome::Rejected {
                code: "NO_SURVIVOR".into(),
                detail: String::new(),
            },
        )
        .expect("rejection is a result");
        assert!(rejected.summary.unwrap().contains("no alive survivor"));
        // Unknown is an error, never a success.
        assert!(outcome_result(&built, &AdapterOutcome::Unknown).is_err());
    }

    #[test]
    fn fallback_positioning_is_surfaced_in_summary() {
        let built = build_command(
            ACTION_SPAWN_INFECTED,
            &json!({"class": "hunter", "count": 1}),
            "r1",
        )
        .expect("cmd");
        let via_fallback = outcome_result(
            &built,
            &AdapterOutcome::Confirmed(vec![
                ("class".into(), "hunter".into()),
                ("spawned".into(), "1".into()),
                ("requested".into(), "1".into()),
                ("fallback".into(), "1".into()),
            ]),
        )
        .expect("ok");
        assert!(via_fallback
            .summary
            .unwrap()
            .contains("fallback positioning"));
        let direct = outcome_result(
            &built,
            &AdapterOutcome::Confirmed(vec![
                ("class".into(), "hunter".into()),
                ("spawned".into(), "1".into()),
                ("requested".into(), "1".into()),
                ("fallback".into(), "0".into()),
            ]),
        )
        .expect("ok");
        assert!(!direct.summary.unwrap().contains("fallback positioning"));
    }
}
