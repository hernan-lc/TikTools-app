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
uses `tiktools-plugin-sdk` for framing, typed events, and protocol plumbing;
it remains `#![forbid(unsafe_code)]`.

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

Testing notes:

- the host starts this plugin automatically on its first poll tick; no
  manual start is needed after install/enable.
- the editor Run test button checks filters against the manifest sample
  (`key "k"`) or the most recent live press of the same trigger — not
  against keys pressed while the dialog is open. To verify live behavior,
  save the event, press the keys for real, and watch the Runs list.
- a mismatch names the sample data it tested, for example
  `sample data: {"key":"k",...}`, so a wrong guess reads as a data
  problem instead of a broken trigger.

Platform notes:

- Windows: works in a normal user session, no admin needed.
- macOS: grant the process Accessibility access, otherwise the OS silently
  delivers no events and every poll comes back empty.
- Linux: X11 only. Wayland sessions are invisible to the listener.
