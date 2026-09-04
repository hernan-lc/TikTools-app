# TikTools

TikTools is a Rust desktop host for TikTok LIVE with a Preact WebView. It
connects to live rooms, displays chat and engagement telemetry, awards viewer
points, and runs local automations. Tauri is not used.

## What it includes

- Direct Winit/Wry window and WebView lifecycle, plus a `tray-icon` tray.
- Native Rust TikTok discovery, signing, WebSocket transport, and event decode.
- Existing Preact UI and `PageMessage`/`HostMessage` JSON IPC contract.
- Rust-owned SQLite persistence for points, creators, gifts, workflows, and
  behavior records.
- Bounded JavaScript automation through the pure-Rust `napi-vm` runtime.
- Runtime-discovered native, process, and optional WASM plugins.
- English and Spanish UI translations, themes, points, analytics, and
  automation editors.

## Quick start

Requirements:

- Rust 1.86 or newer and Cargo.
- Bun for the Preact development toolchain and frontend asset build.
- Platform WebView dependencies. Linux uses WebKitGTK; see
  [Getting Started](docs/GETTING_STARTED.md).

From a checkout:

```bash
bun install
bun run typecheck
bun run test
bun run start
```

`start` builds `dist/web` and launches the Rust desktop binary. For fast UI
iteration, run the frontend server and point the Rust host at it:

```bash
bun run serve:web
TIKTOOLS_DEV_URL=http://localhost:3000 cargo run -p tiktools-desktop
```

Release assets are served through the `tiktools://app/...` custom Wry protocol:

```bash
bun run build:web
cargo build -p tiktools-desktop --release
```

## Commands

```bash
bun run start             # Build the Preact assets and run the Rust host
bun run start:rust        # Run the Rust host against existing dist/web assets
bun run dev               # Run the frontend development server
bun run build:web         # Build dist/web
bun run typecheck         # Type-check the Preact/editor source
bun run test              # Run frontend and editor tests
bun run check:rust        # Check every Cargo workspace crate
bun run test:rust         # Run every Rust workspace test
bun run build:desktop     # Build the release desktop executable
```

Install a validated plugin package after the executable has been compiled:

```bash
cargo run -p tiktools-desktop -- --install-plugin ./example.plugin
cargo run -p tiktools-desktop -- --install-plugin ./example.plugin --replace
```

## Project layout

```text
crates/tiktools-desktop/       Winit, Wry, tray, UI-thread bridge
crates/tiktools-core/          IPC router, services, SQLite, points, events
crates/tiktools-plugin-api/    Versioned manifest, protocol, capabilities, ABI
crates/tiktools-plugin-loader/ Runtime discovery and plugin runtimes
crates/tiktools-tiktok/        Native signer, discovery, WebSocket, event model
src/web/                       Preact application and styles
src/shared/messages.ts         Frontend compatibility contract
src/automation/                Editor schemas and native event registry
scripts/build-web.ts           Frontend asset build
scripts/serve-web.ts           Frontend development server
docs/                          Architecture and development documentation
```

`tiktools-core` deliberately has no Winit, Wry, or `tray-icon` dependency. The
desktop crate translates `HostMessage` values into UI-thread commands through
`EventLoopProxy`; the core can therefore be tested without a WebView.

## Runtime plugin model

Plugins are discovered from runtime directories, never from a compile-time
list. The usual locations are:

```text
Windows  %LOCALAPPDATA%/TikTools/plugins
Linux    ~/.local/share/TikTools/plugins
macOS    ~/Library/Application Support/TikTools/plugins
```

Each package contains a `plugin.json` with schema version 2, a runtime kind,
and an entry path. Native libraries use a small serialized-message C ABI and
remain loaded until application shutdown. Process plugins use length-delimited
JSON over stdin/stdout. WASM support is intentionally optional.

Example native manifest:

```json
{
  "schemaVersion": 2,
  "id": "miniaudio",
  "name": "MiniAudio",
  "version": "1.2.0",
  "runtime": "native",
  "entry": "miniaudio.dll",
  "protocolVersion": 1,
  "abiVersion": 1,
  "permissions": ["audio.output"]
}
```

Native plugins are trusted code. Manifest permissions limit the host API for
process/WASM plugins and document the expected access of native plugins.

## Data and privacy

Rust resolves writable paths from platform app-data directories, not the
process working directory. Override them for development with
`TIKTOOLS_HOME`, `TIKTOOLS_DATA_DIR`, `TIKTOOLS_PLUGINS_DIR`,
`TIKTOOLS_PLUGIN_DATA_DIR`, `TIKTOOLS_LOG_DIR`, or `TIKTOOLS_TEMP_DIR`.

Existing `data/tiktok-points.db` and `data/tiktok-automation.db` files are
copied to the platform data directory only when the destination is missing;
the Rust host preserves the existing table names and JSON records.

Session cookies stay in memory and must never be committed or logged.

## Documentation

- [Getting Started](docs/GETTING_STARTED.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Rust migration](docs/RUST_MIGRATION.md)
- [Development Guide](docs/DEVELOPMENT.md)
- [Automations](docs/AUTOMATIONS.md)
- [Plugins](docs/PLUGINS.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [User Guide](docs/USER_GUIDE.md)
- [UI Kit Usage](docs/UI_KIT_USAGE.md)
