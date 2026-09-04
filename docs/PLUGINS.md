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
  "capabilities": ["audio"],
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
executable or be migrated to the native/WASM protocol.

### WASM

WASM is an optional runtime boundary for untrusted or cross-platform logic.
The current workspace exposes the runtime slot without adding Wasmtime or
Extism to normal builds. When enabled, host capabilities are provided as
explicit imports and checked against the manifest.

## Capabilities and permissions

Manifests may declare capabilities and permissions:

```json
{
  "permissions": ["http", "audio", "points.read", "points.write"],
  "capabilities": ["http.request", "audio.output"]
}
```

The core capability broker is the policy boundary for process/WASM plugins.
Native plugins are trusted and their manifest is documentation plus a limit on
which host APIs the application exposes. A declaration is never a sandbox for
in-process native code.

## Actions and settings

An action plugin can declare JSON action descriptors in `actionTypes`. The
Preact UI renders title, fields, JSON schema, and UI hints; it never imports
plugin code. A `settingsSchema` and optional `settingsUiHints` let the host
render plugin settings without allowing arbitrary DOM or script injection.

Keep action identifiers stable. Protocol and ABI versions are independent:

- protocol version describes JSON messages and capabilities;
- ABI version describes native FFI compatibility.

The host rejects incompatible versions before loading a native library.

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
