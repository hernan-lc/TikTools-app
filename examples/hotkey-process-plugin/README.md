# Global hotkey plugin example

A crash-isolated TikTools process plugin that publishes `hotkey.pressed`
events for global shortcuts and key sequences. Behaviors trigger on them
like any other event: match chords with `eq` on `event.data.key` or
`event.data.modifiers`, phrases with `contains` on `event.data.sequence`.

The executable watches the OS keyboard through
[rdev](https://github.com/rustdesk-org/rdev) (the maintained RustDesk fork),
tracks modifiers plus a rolling 8-key sequence, and answers the host `poll`
call with everything observed since the previous tick. It never sends
keystrokes anywhere; it only reports what was pressed. The implementation
itself is `#![forbid(unsafe_code)]` and communicates only through framed
JSON.

Build it outside the application workspace:

```bash
cargo build --release --manifest-path examples/hotkey-process-plugin/Cargo.toml
```

Install a package containing these two files:

```text
hotkeys/
  plugin.json
  tiktools-hotkey-process-plugin
```

The executable must be beside `plugin.json` and have the entry name declared
by the manifest (rename the built binary, adding no extension). After copying
the directory into the user plugin directory, reload the Plugins view or
restart TikTools. No host recompilation or plugin registration is required.

The host accepts only the `events.publish` capability for these events, only
for the `hotkey.pressed` type declared in this manifest, and stamps identity,
depth, and connection context itself.

Example filters on a `hotkey.pressed` event:

```text
event.data.key        eq        k
event.data.modifiers  eq        ctrl
event.data.sequence   contains  g o
```

Platform notes:

- Windows: works in a normal user session, no admin needed.
- macOS: grant the process Accessibility access, otherwise the OS silently
  delivers no events and every poll comes back empty.
- Linux: X11 only. Wayland sessions are invisible to the listener.
