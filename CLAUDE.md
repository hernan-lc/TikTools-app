# TikTools contributor notes

TikTools is a Rust desktop host with a Preact frontend. Do not add Tauri or a
new application framework.

## Rust boundaries

- `tiktools-desktop` owns Winit, Wry, tray-icon, and the UI-thread bridge.
- `tiktools-core` owns IPC routing, services, events, SQLite, points,
  automation, and the capability broker. It must not depend on desktop crates.
- `tiktools-tiktok` owns the native TikTok signer/discovery/WebSocket boundary.
- `tiktools-plugin-api` and `tiktools-plugin-loader` own versioned runtime
  plugin contracts and discovery.

Keep all frontend messages compatible with `src/shared/messages.ts`. Keep
runtime plugins discoverable from manifests; never add a compile-time plugin
list. Native plugin ABIs may exchange only serialized bytes and simple C ABI
values.

## Frontend

Bun is the frontend build/test toolchain, not the application host. Use:

```bash
bun run build:web
bun run typecheck
bun run test
```

Use `.ts`/`.tsx` import extensions consistently. Keep host-only operations out
of the WebView.

## Rust checks

```bash
cargo fmt --all
cargo check -p tiktools-core
cargo test -p tiktools-core
cargo check -p tiktools-desktop
cargo test --workspace
```

Preserve existing SQLite filenames/table layouts and never log session
cookies. Use `apply_patch` for source edits and keep changes focused.
