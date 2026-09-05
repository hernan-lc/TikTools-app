#![forbid(unsafe_code)]
// Release plugin executables must not allocate a console on Windows; the
// host launches them with CREATE_NO_WINDOW and talks over piped stdio.
#![cfg_attr(
    all(target_os = "windows", not(debug_assertions)),
    windows_subsystem = "windows"
)]

//! Global hotkey / key-sequence process plugin for TikTools.
//!
//! A background listener records every global key press (modifiers, rolling
//! key sequence) and the host picks the batch up through its one-second
//! `poll` call, publishing one `hotkey.pressed` event per press. Behaviors
//! match chords with `eq` on `event.data.key`/`event.data.modifiers` and
//! phrases with `contains` on `event.data.sequence`.
//!
//! The executable is still trusted code with the operating-system permissions
//! of the user; a process boundary is not an OS sandbox. Platform notes:
//! macOS needs an Accessibility grant (silently delivers nothing without it),
//! Linux uses X11 and does not see Wayland sessions, Windows needs nothing
//! beyond a normal user session.

use std::{
    collections::{BTreeSet, VecDeque},
    io::{self, BufReader, BufWriter},
    sync::{Arc, Mutex},
};

use rdev::{listen, Event, EventType};
use serde_json::{json, Value};
use tiktools_plugin_api::{
    read_frame, write_frame, FrameError, PluginRequest, PluginResponse, METHOD_CALL,
    TIKTOOLS_PLUGIN_PROTOCOL_VERSION,
};

/// Rolling history behind `event.data.sequence`.
const MAX_SEQUENCE_KEYS: usize = 8;
/// Backpressure cap; the host additionally caps 16 events per poll tick.
const MAX_PENDING_EVENTS: usize = 64;

#[derive(Debug, Default)]
struct KeyState {
    /// Currently held non-modifier keys (kills auto-repeat duplicates).
    pressed: BTreeSet<String>,
    modifiers: BTreeSet<String>,
    sequence: VecDeque<String>,
}

#[derive(Debug)]
struct PendingEvent {
    key: String,
    modifiers: String,
    sequence: String,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let state = Arc::new(Mutex::new(KeyState::default()));
    let pending: Arc<Mutex<VecDeque<PendingEvent>>> = Arc::new(Mutex::new(VecDeque::new()));

    let listen_state = Arc::clone(&state);
    let listen_pending = Arc::clone(&pending);
    std::thread::spawn(move || {
        if let Err(error) = listen(move |event| {
            on_input_event(&listen_state, &listen_pending, event);
        }) {
            eprintln!("hotkey listener stopped; polls will return no events: {error:?}");
        }
    });

    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = BufReader::new(stdin.lock());
    let mut writer = BufWriter::new(stdout.lock());

    loop {
        let request = match read_frame::<_, PluginRequest>(&mut reader) {
            Ok(request) => request,
            Err(FrameError::Io(error)) if error.kind() == io::ErrorKind::UnexpectedEof => break,
            Err(error) => return Err(error.into()),
        };
        let response = handle(request, &pending);
        write_frame(&mut writer, &response)?;
    }
    Ok(())
}

fn handle(request: PluginRequest, pending: &Mutex<VecDeque<PendingEvent>>) -> PluginResponse {
    if request.protocol_version != TIKTOOLS_PLUGIN_PROTOCOL_VERSION {
        return failure(
            request.id,
            format!("unsupported protocol version {}", request.protocol_version),
        );
    }
    if request.method != METHOD_CALL {
        return failure(request.id, format!("unsupported method `{}`", request.method));
    }
    match request.payload.get("type").and_then(Value::as_str) {
        Some("poll") => poll(request.id, pending),
        Some("action") => ok(
            request.id,
            json!({"summary": "hotkey listener has no actions; configure hotkey.pressed events instead"}),
        ),
        other => failure(
            request.id,
            format!("unsupported call type `{}`", other.unwrap_or("missing")),
        ),
    }
}

/// Drains presses observed since the previous poll into host events.
fn poll(id: String, pending: &Mutex<VecDeque<PendingEvent>>) -> PluginResponse {
    let events: Vec<Value> = pending
        .lock()
        .expect("pending hotkey events poisoned")
        .drain(..)
        .map(|event| {
            json!({
                "type": "hotkey.pressed",
                "data": {
                    "key": event.key,
                    "modifiers": event.modifiers,
                    "sequence": event.sequence,
                }
            })
        })
        .collect();
    ok(id, json!({"events": events}))
}

fn on_input_event(
    state: &Mutex<KeyState>,
    pending: &Mutex<VecDeque<PendingEvent>>,
    event: Event,
) {
    let (key, pressed) = match event.event_type {
        EventType::KeyPress(key) => (key, true),
        EventType::KeyRelease(key) => (key, false),
        _ => return,
    };
    let name = key_name(&key);
    let mut state = state.lock().expect("hotkey state poisoned");
    if is_modifier(&name) {
        if pressed {
            state.modifiers.insert(name);
        } else {
            state.modifiers.remove(&name);
        }
        return;
    }
    if pressed {
        if !state.pressed.insert(name.clone()) {
            return;
        }
        state.sequence.push_back(name.clone());
        while state.sequence.len() > MAX_SEQUENCE_KEYS {
            state.sequence.pop_front();
        }
        let modifiers = canonical_modifiers(&state.modifiers);
        let sequence = state.sequence.iter().cloned().collect::<Vec<_>>().join(" ");
        let mut pending = pending.lock().expect("pending hotkey events poisoned");
        pending.push_back(PendingEvent {
            key: name,
            modifiers,
            sequence,
        });
        while pending.len() > MAX_PENDING_EVENTS {
            pending.pop_front();
        }
    } else {
        state.pressed.remove(&name);
    }
}

fn is_modifier(name: &str) -> bool {
    matches!(name, "shift" | "ctrl" | "alt" | "meta")
}

/// Conventional chord order (ctrl+shift+alt+meta) so recorded combos match
/// what users type in filters, independent of set iteration order.
fn canonical_modifiers(modifiers: &BTreeSet<String>) -> String {
    let mut ordered: Vec<&String> = modifiers.iter().collect();
    ordered.sort_by_key(|name| modifier_rank(name));
    ordered
        .into_iter()
        .cloned()
        .collect::<Vec<_>>()
        .join("+")
}

fn modifier_rank(name: &str) -> u8 {
    match name {
        "ctrl" => 0,
        "shift" => 1,
        "alt" => 2,
        "meta" => 3,
        _ => 4,
    }
}

/// Stable, layout-independent key names derived from the rdev debug label so
/// new `Key` variants degrade to a readable fallback instead of breaking the
/// build or the event stream.
fn key_name(key: &rdev::Key) -> String {
    match format!("{key:?}").as_str() {
        "ShiftLeft" | "ShiftRight" => "shift".to_owned(),
        "ControlLeft" | "ControlRight" => "ctrl".to_owned(),
        "Alt" | "AltGr" => "alt".to_owned(),
        "MetaLeft" | "MetaRight" => "meta".to_owned(),
        "Space" => "space".to_owned(),
        "Return" => "enter".to_owned(),
        "Tab" => "tab".to_owned(),
        "Escape" => "esc".to_owned(),
        "Backspace" => "backspace".to_owned(),
        "Delete" => "delete".to_owned(),
        "Insert" => "insert".to_owned(),
        "Home" => "home".to_owned(),
        "End" => "end".to_owned(),
        "PageUp" => "pageup".to_owned(),
        "PageDown" => "pagedown".to_owned(),
        "UpArrow" => "up".to_owned(),
        "DownArrow" => "down".to_owned(),
        "LeftArrow" => "left".to_owned(),
        "RightArrow" => "right".to_owned(),
        "CapsLock" => "capslock".to_owned(),
        "NumLock" => "numlock".to_owned(),
        "ScrollLock" => "scrolllock".to_owned(),
        "PrintScreen" => "printscreen".to_owned(),
        "Pause" => "pause".to_owned(),
        "Comma" => ",".to_owned(),
        "Dot" => ".".to_owned(),
        "Slash" => "/".to_owned(),
        "SemiColon" => ";".to_owned(),
        "Quote" => "'".to_owned(),
        "LeftBracket" => "[".to_owned(),
        "RightBracket" => "]".to_owned(),
        "BackSlash" => "\\".to_owned(),
        "Minus" => "-".to_owned(),
        "Equal" => "=".to_owned(),
        "BackQuote" => "`".to_owned(),
        "Multiply" => "*".to_owned(),
        "Add" => "+".to_owned(),
        "Subtract" => "-".to_owned(),
        "Decimal" => ".".to_owned(),
        "Divide" => "/".to_owned(),
        "KpReturn" => "enter".to_owned(),
        "KpMinus" => "-".to_owned(),
        "KpPlus" => "+".to_owned(),
        "KpMultiply" => "*".to_owned(),
        "KpDivide" => "/".to_owned(),
        "KpDecimal" => ".".to_owned(),
        "KpEqual" => "=".to_owned(),
        "KpComma" => ",".to_owned(),
        name if name.len() == 4 && name.starts_with("Key") => name[3..].to_lowercase(),
        name if name.len() == 4 && name.starts_with("Num") => name[3..].to_owned(),
        name if name.starts_with('F') && name.len() <= 3 && name[1..].chars().all(|c| c.is_ascii_digit()) => {
            name.to_lowercase()
        }
        name if name.starts_with("Numpad") && name.len() == 7 => name[6..].to_owned(),
        name if name.starts_with("Kp") && name.len() == 3 => name[2..].to_owned(),
        other => other.to_lowercase(),
    }
}

fn ok(id: String, result: Value) -> PluginResponse {
    PluginResponse {
        protocol_version: TIKTOOLS_PLUGIN_PROTOCOL_VERSION,
        id,
        ok: true,
        result: Some(result),
        error: None,
    }
}

fn failure(id: String, error: String) -> PluginResponse {
    PluginResponse {
        protocol_version: TIKTOOLS_PLUGIN_PROTOCOL_VERSION,
        id,
        ok: false,
        result: None,
        error: Some(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sequence_tracks_first_presses_and_ignores_repeats_and_modifiers() {
        let state = Mutex::new(KeyState::default());
        let pending = Mutex::new(VecDeque::new());
        let press = |key: rdev::Key| {
            on_input_event(
                &state,
                &pending,
                Event {
                    time: std::time::SystemTime::now(),
                    unicode: None,
                    event_type: EventType::KeyPress(key),
                    platform_code: 0,
                    position_code: 0,
                    usb_hid: 0,
                    extra_data: Default::default(),
                },
            );
        };
        press(rdev::Key::ControlLeft);
        press(rdev::Key::KeyK);
        press(rdev::Key::KeyK);
        let pending = pending.lock().expect("pending poisoned");
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].key, "k");
        assert_eq!(pending[0].modifiers, "ctrl");
        assert_eq!(pending[0].sequence, "k");
        drop(pending);
        // Canonical chord order regardless of press order.
        let state = Mutex::new(KeyState::default());
        let pending = Mutex::new(VecDeque::new());
        let press = |key: rdev::Key| {
            on_input_event(
                &state,
                &pending,
                Event {
                    time: std::time::SystemTime::now(),
                    unicode: None,
                    event_type: EventType::KeyPress(key),
                    platform_code: 0,
                    position_code: 0,
                    usb_hid: 0,
                    extra_data: Default::default(),
                },
            );
        };
        press(rdev::Key::MetaRight);
        press(rdev::Key::Alt);
        press(rdev::Key::KeyX);
        let pending = pending.lock().expect("pending poisoned");
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].modifiers, "alt+meta");
    }

    #[test]
    fn key_names_stay_stable_and_readable() {
        assert_eq!(key_name(&rdev::Key::KeyA), "a");
        assert_eq!(key_name(&rdev::Key::Space), "space");
        assert_eq!(key_name(&rdev::Key::F12), "f12");
        assert_eq!(key_name(&rdev::Key::MetaRight), "meta");
        assert!(is_modifier(&key_name(&rdev::Key::ShiftLeft)));
        assert!(!is_modifier(&key_name(&rdev::Key::KeyG)));
    }
}
