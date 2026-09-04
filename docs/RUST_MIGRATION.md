# Rust host migration

The migration cutover is complete: TikTools is a Rust desktop application,
not a Bun desktop host. The Vue frontend remains intact and Bun is used only
to run the Vite build and frontend tests.

## Current architecture

```text
Winit + Wry + tray-icon
          │
          ▼
    tiktools-core
      ├── Tokio IPC/event bus
      ├── rusqlite persistence
      ├── points and automation services
      ├── capability broker
      ├── runtime plugin manager
      └── native TikTok client
```

The core never imports Winit, Wry, or tray-icon. The desktop crate owns the UI
thread and communicates with core using `HostEmitter` and `EventLoopProxy`.

## Native TikTok path

`tiktools-tiktok` uses the pinned Rust crates from
[`nglmercer/tiktok-signer`](https://github.com/nglmercer/tiktok-signer) for
discovery, embedded signing, reconnecting WebSocket transport, and event
decoding. It exposes stable TikTools event structs instead of generated
protobuf values. No Bun/Node sidecar is needed for live connection.

The signer still needs its configured `webmssdk.js` signing bundle; the bundle
is loaded by the embedded Rust signer backend and is cached outside the
repository.

## Bounded JavaScript path

Automation scripts use the pure-Rust part of
[`nglmercer/napi-vm`](https://github.com/nglmercer/napi-vm). The adapter limits
source/result size and loop iterations, injects JSON-only globals, and exposes
no Node, filesystem, network, process, database, or WebView objects.

JavaScript is an automation language here, not the application runtime.

## Runtime plugins

`tiktools-plugin-loader` scans runtime directories and validates schema-version
2 manifests. There is no compile-time plugin list. The loader supports:

- trusted native dynamic libraries through a small serialized-message C ABI;
- standalone process plugins through length-prefixed JSON stdio;
- an optional WASM runtime slot without adding Wasmtime/Extism to default
  builds.

Native libraries are loaded after application compilation and remain loaded
until shutdown. Installation validates checksums, package-relative paths, and
symlinks before atomic replacement.

## Compatibility retained

- Existing Vue views and styles.
- `PageMessage`/`HostMessage` discriminator and field names.
- Points and automation SQLite filenames, tables, and JSON payload columns.
- Platform app-data migration from checkout-local database files.
- Existing behavior/editor contracts and event samples.

The removed TypeScript host, native addon wrappers, plugin worker, dynamic
plugin runtime, and vendored signer are no longer production paths.
JavaScript plugin source is not silently launched by the Rust host; plugins
must use the versioned native/process/WASM protocol.

## Commands

```bash
bun install
bun run build:web
cargo check -p tiktools-core
cargo test -p tiktools-core
cargo check -p tiktools-desktop
cargo test --workspace
cargo build -p tiktools-desktop --release
```

For frontend iteration:

```bash
bun run serve:web
TIKTOOLS_DEV_URL=http://localhost:3000 cargo run -p tiktools-desktop
```

## Boundaries for future work

Keep window/WebView/tray code in `tiktools-desktop`; keep TikTok protocol code
in `tiktools-tiktok`; keep manifest/ABI/protocol code in the plugin crates; and
keep privileged operations behind core service interfaces. Any future runtime
must be discovered and selected from a manifest rather than compiled into a
host-specific registration list.
