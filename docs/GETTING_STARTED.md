# Getting Started

## Requirements

- Rust 1.86 or newer with Cargo.
- Bun for the frontend build and development server.
- A system WebView supported by Wry:
  - Windows: WebView2.
  - Linux: GTK and WebKitGTK development/runtime packages.
  - macOS: the system WebKit framework.
- Git.

On Debian/Ubuntu, install the GTK/WebKitGTK development packages provided by
your distribution before building the desktop crate. Package names vary with
the distribution release; if Cargo reports a missing GTK or WebKit library,
install its `-dev` package and retry.

## Install and run

```bash
bun install
bun run typecheck
bun run test
bun run start
```

The `start` script builds the Preact assets into `dist/web`, then runs
`tiktools-desktop`. The Rust host reads those assets through the
`tiktools://app/index.html` custom protocol and does not start a production
localhost server.

For UI-only iteration:

```bash
bun run serve:web
TIKTOOLS_DEV_URL=http://localhost:3000 cargo run -p tiktools-desktop
```

The development URL bypasses the custom protocol while retaining the same Wry
IPC bridge.

## First connection

1. Enter a TikTok creator handle; the leading `@` is optional.
2. Leave Cookie empty for anonymous discovery, or enter an authenticated
   Cookie request header when the room requires it.
3. Connect directly or choose the first room returned by live discovery.
4. Use Feed, Points, Analytics, Automations, Plugins, and Settings.

Cookies stay in memory. Do not paste them into source files, issue reports, or
logs.

## Rust commands

```bash
cargo check -p tiktools-core
cargo test -p tiktools-core
cargo check -p tiktools-desktop
cargo test --workspace
cargo build -p tiktools-desktop --release
```

The core-only commands avoid desktop dependencies. `cargo test --workspace`
also exercises SQLite, plugin manifest/ABI, native event normalization, the
bounded `napi-vm` adapter, and the Wry asset handler.

## Frontend commands

```bash
bun run build:web
bun run serve:web
bun run typecheck
bun run test
```

The frontend is still Preact. Its JSON message types live in
`src/shared/messages.ts`; no Rust UI rewrite is required.

## Runtime data

The host uses platform app-data locations:

```text
Windows  %LOCALAPPDATA%/TikTools/
Linux    ~/.local/share/TikTools/
macOS    ~/Library/Application Support/TikTools/
```

Subdirectories are `data/`, `plugins/`, `plugin-data/`, `logs/`, and `temp/`.
For development or tests, set `TIKTOOLS_HOME` or the more specific path
overrides documented in the [Development Guide](DEVELOPMENT.md).

If a checkout contains `data/tiktok-points.db` or
`data/tiktok-automation.db`, the Rust host copies it to the platform data
directory only when the destination does not exist. The original files are
not deleted or modified by that copy.

## Installing a plugin

Build or obtain a validated `.plugin` package, then install it after the app
binary exists:

```bash
cargo run -p tiktools-desktop -- --install-plugin ./my-plugin.plugin
```

The package must contain a schema-version-2 `plugin.json`. The installer
rejects path traversal, unsafe symlinks, invalid checksums, incompatible
protocol/ABI versions, and entries outside the package. Restart the app after
replacing a native library; native hot-unloading is intentionally unsupported.
