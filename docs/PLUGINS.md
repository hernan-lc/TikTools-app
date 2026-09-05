# Plugins

Plugins are runtime packages. TikTools scans built-in, user, and development
directories when it starts; a plugin does not need to exist when TikTools is
compiled and adding one never requires recompiling the host.

## Package layout

```text
my-plugin/
  plugin.json
  native/my-plugin.dll       # or a standalone process / .wasm entry
  assets/
```

The manifest is versioned and explicit:

```json
{
  "schemaVersion": 2,
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "runtime": "native",
  "entry": "native/my-plugin.dll",
  "protocolVersion": 1,
  "abiVersion": 1,
  "permissions": ["audio.output"],
  "capabilities": ["audio.play"],
  "actionTypes": []
}
```

The same logical plugin protocol is used by the native, process, and optional
WASM runtime implementations. The API is defined in
`crates/tiktools-plugin-api`; runtime loading is isolated in
`crates/tiktools-plugin-loader`.

## Runtime kinds

### Native

Native libraries are loaded with `libloading`. They are trusted code and can
crash the application or access the operating system directly. The C ABI is
deliberately small: plugins exchange pointers, lengths, status values, and
serialized JSON bytes. Rust containers, trait objects, and async futures never
cross the boundary. Libraries remain loaded until shutdown; restart TikTools
after replacing one.

### Process

Process plugins are standalone executables. The host launches the declared
entry and exchanges length-prefixed JSON on stdin/stdout. A process crash is
contained at the process boundary. The host does not interpret or silently
launch JavaScript source files; a JavaScript plugin must be packaged as its own
executable or use the bounded `napi-vm` automation surface.

The example at `examples/audio-process-plugin` demonstrates a complete process
plugin. It returns a `playAudio` intent; it does not open the file itself.

### WASM

WASM is an optional runtime boundary for untrusted or cross-platform logic.
The current workspace exposes the runtime slot without adding Wasmtime or
Extism to normal builds. When enabled, host capabilities are provided as
explicit imports and checked against the manifest.

## Capabilities and permissions

Manifests may declare capabilities and permissions:

```json
{
  "permissions": ["http", "audio.output", "points.read", "points.write"],
  "capabilities": ["http.request", "audio.play"]
}
```

The core capability broker is the policy boundary for capabilities requested
through the host protocol. Native libraries and process executables are still
trusted code with the user's OS permissions; a manifest declaration is never
an OS sandbox for code that can call the operating system directly. Use the
WASM runtime with explicit WASI/host imports for genuinely untrusted code.

## Media and audio

`media.pick` is the public host API for selecting an existing file or
directory. It returns a JSON `MediaSelection` containing a canonical path and
metadata. `audio.play` accepts a `MediaFileRef`, validates it again immediately
before playback, and streams the original file. TikTools does not copy media
bytes into app data or a plugin directory.

Process, WASM, and `napi-vm` code uses a serializable intent instead of a native
audio handle:

```json
{
  "summary": "requested host audio playback",
  "playAudio": {
    "fileRef": {"path": "/music/alert.wav"},
    "volume": 0.8,
    "overlap": "restart"
  }
}
```

The host accepts that intent only from a plugin declaring both
`audio.play` and `audio.output`. It canonicalizes the path, restricts it to
supported audio types, checks the size, and then hands it to the native audio
provider. No plugin receives file bytes or a native file descriptor.

## Actions and settings

An action plugin can declare JSON action descriptors in `actionTypes`. The
Vue UI renders title, fields, JSON schema, and UI hints; it never imports
plugin code. A `settingsSchema` and optional `settingsUiHints` let the host
render plugin settings without allowing arbitrary DOM or script injection.
Numeric fields accept an optional `range` kind with `min`, `max`, and `step`
to render a slider instead of a number input.

Keep action identifiers stable. Protocol and ABI versions are independent:

- protocol version describes JSON messages and capabilities;
- ABI version describes native FFI compatibility.

The host rejects incompatible versions before loading a native library.

## Event triggers

A plugin can declare its own event types (global hotkeys, timers, file
watchers) in `eventTypes`. Declared types appear in the event picker next
to the built-in triggers, work with filters/cooldowns/actions like any
other trigger, and stop matching while the plugin is disabled or
unavailable.

```json
{
  "capabilities": ["events.publish"],
  "eventTypes": [
    {
      "type": "hotkey.pressed",
      "title": {"default": "Hotkey pressed"},
      "fields": [
        {"path": "event.data.key", "kind": "text"}
      ],
      "sample": {"key": "ctrl+k"}
    }
  ]
}
```

Rules:

- type names are dotted lowercase (`hotkey.pressed`, `timer.tick`);
- the `tiktok.`, `points.`, and `plugin.` namespaces stay host-owned, so a
  plugin can never shadow a built-in trigger or the `plugin.emit` channel;
- `title.default` is required; `description`, `fields` (text/number/boolean
  paths under `event.data.*` or `event.user.*`), and a `sample` payload are
  optional and bounded like every other descriptor.
- a field may declare fixed `options: [{value, label?}]` (128 at most).
  Option-backed fields render as a dropdown in behavior conditions instead
  of free text, plus a record button that fills the value from keys pressed
  while it is armed (Escape cancels).

Publishing works two ways. While any action of the plugin runs, its `emit`
response intents may name one of its own declared types instead of falling
back to `plugin.emit`:

```json
{ "emit": [{ "type": "hotkey.pressed", "data": {"key": "ctrl+k"} }] }
```

For spontaneous events the host polls every running plugin that declares
event types once per second with `{"type": "poll"}`. The plugin answers with
the events observed since the previous poll:

```json
{ "events": [{ "type": "hotkey.pressed", "data": {"key": "ctrl+k"} }] }
```

Both paths require the `events.publish` capability and only accept types
from the plugin own manifest. Payloads must be objects under 64 KB (16
events per poll at most); anything else is dropped with a warning. The host
stamps identity, timestamp, chain depth, and connection context, then runs
the normal matching pipeline including the depth guard, so a hotkey can
trigger actions but can never recurse without bound.

## Installation

Create a `.plugin` archive containing `plugin.json` and the declared entry,
then install it through the Rust host:

```bash
cargo run -p tiktools-desktop -- --install-plugin ./my-plugin.plugin
cargo run -p tiktools-desktop -- --install-plugin ./my-plugin.plugin --replace
```

Installation uses a temporary directory, validates the manifest and optional
`checksums.json`, rejects traversal and symlink escapes, and atomically moves
the package into the user plugin directory. The usual runtime directory is
`%LOCALAPPDATA%/TikTools/plugins` on Windows,
`~/.local/share/TikTools/plugins` on Linux, and
`~/Library/Application Support/TikTools/plugins` on macOS.

## SDK guidance

Plugin authors should depend on `tiktools-plugin-api` only. Do not depend on
Wry, Winit, SQLite, or the TikTok client. Keep requests and responses JSON
serializable, cap payload sizes, and make shutdown idempotent.
