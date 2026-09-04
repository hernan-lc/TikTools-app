# Development Guide

TikTools has two intentionally separate edit loops: Bun runs Vite/Vue
builds/tests, and Cargo builds/tests the Rust host. The desktop integration
is only needed when changing Winit, Wry, the tray, or the final IPC bridge.

## Fast checks

```bash
cargo check -p tiktools-core
cargo test -p tiktools-core
cargo check -p tiktools-plugin-api
cargo check -p tiktools-tiktok
bun run typecheck
bun run test
```

The core checks do not compile Winit, Wry, GTK, or tray integration. The
workspace feature graph keeps the optional native plugin, persistence, HTTP,
TikTok, and WASM boundaries explicit.

## Desktop loop

```bash
bun run build:web
cargo check -p tiktools-desktop
cargo run -p tiktools-desktop
```

For live frontend changes:

```bash
bun run serve:web
TIKTOOLS_DEV_URL=http://localhost:3000 cargo run -p tiktools-desktop
```

Release builds use the custom `tiktools://app` protocol:

```bash
bun run build:web
cargo build -p tiktools-desktop --release
```

## Source ownership

- `crates/tiktools-desktop`: UI-thread lifecycle, Wry IPC callback, custom
  asset protocol, tray, and platform event-loop setup.
- `crates/tiktools-core`: typed IPC, service graph, event bus, points,
  persistence orchestration, automation, and capability policy.
- `crates/tiktools-tiktok`: native discovery, signing, WebSocket reconnects,
  decode, and stable event values.
- `crates/tiktools-plugin-api`: manifest, protocol, capability names, and C ABI.
- `crates/tiktools-plugin-loader`: runtime scanning, validation, installation,
  dynamic native libraries, process plugins, and the optional WASM boundary.
- `src/web`: Vue presentation only.
- `src/automation`: editor contracts and the native event registry consumed by
  the Vue UI.

Keep Wry/Winit types out of core services. Use `HostEmitter` for outbound UI
messages and `EventLoopProxy` for UI-thread work. Never put database handles,
VM values, native TikTok objects, or plugin instances into an automation JSON
event.

## Adding an IPC message

1. Add the discriminated union member to `src/shared/messages.ts`.
2. Mirror it in `crates/tiktools-core/src/ipc/messages.rs`.
3. Validate bounded input in both the frontend boundary and Rust parser.
4. Route it in `AppCore::handle_page_message`.
5. Add the matching `HostMessage` and update the Vue state handler.
6. Test serialization and invalid-input rejection.

The Rust parser is authoritative at runtime. The TypeScript contract stays in
the repository so the existing Vue build remains compatible.

## Adding an automation action

Host action descriptors belong in the Rust catalog and are sent as JSON in the
behavior snapshot. The Vue editor renders their field metadata; it must not
execute host behavior. An action implementation should:

- validate its JSON configuration;
- request a named capability through the core broker;
- keep network/filesystem access outside the WebView;
- emit JSON-safe results and logs;
- include a Rust unit test.

Plugin actions are declared in a runtime manifest under `actionTypes`; no
plugin id is added to Rust source.

## Adding workflow nodes

Workflow node definitions are JSON-safe data returned by
`get-automation-nodes`. Saved graphs must remain schema version 1 until a
deliberate migration is introduced. New nodes need stable type/version values,
validated ports, bounded configuration, and a migration-compatible execution
implementation in core.

## Plugin development

Use `tiktools-plugin-api` as the small SDK. Native plugins export
`tiktools_plugin_init` and pass serialized bytes through the C ABI. Do not pass
Rust `String`, `Vec`, trait objects, or futures across that boundary. Process
plugins are standalone executables speaking length-prefixed JSON on stdin and
stdout. JavaScript source files are not silently executed by the desktop host.

Install a package after compilation:

```bash
cargo run -p tiktools-desktop -- --install-plugin ./my-plugin.plugin
```

The installer validates manifest schema, checksums, package-relative paths,
symlinks, and atomic replacement before the next runtime scan.

## Paths and databases

Use `AppPaths::from_environment` rather than `current_dir` for runtime data.
The supported overrides are `TIKTOOLS_HOME`, `TIKTOOLS_DATA_DIR`,
`TIKTOOLS_PLUGINS_DIR`, `TIKTOOLS_PLUGIN_DATA_DIR`, `TIKTOOLS_LOG_DIR`,
`TIKTOOLS_TEMP_DIR`, and `TIKTOOLS_WEB_ROOT`.

Do not rename or recreate the existing SQLite tables as part of ordinary
feature work. Add fixtures when a persisted record format changes, and never
overwrite a user's destination database during path migration.

## Verification before commit

```bash
cargo fmt --all -- --check
cargo test --workspace
cargo check -p tiktools-desktop
bun run typecheck
bun run test
bun run build:web
git diff --check
```
