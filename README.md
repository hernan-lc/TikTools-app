# TikTools

TikTools is a Bun-powered desktop companion for TikTok LIVE. It connects to a live room, displays chat and engagement telemetry, awards viewer points, and runs configurable automations from an embedded WebView window.

The app is built for people who want a lightweight live dashboard with a local data store, a system-tray workflow, and extensible event-driven behavior.

## What it includes

- TikTok LIVE connection with guest discovery or an authenticated Cookie header.
- Live feed for chat, gifts, likes, joins, follows, shares, and room statistics.
- Local points, levels, subscriber bonuses, viewer leaderboard, and creator history.
- Analytics for the current session.
- Behavior rules that connect events, filters, cooldowns, and actions.
- Built-in HTTP, points, delay, logging, and script capabilities, plus plugin-backed audio and text-to-speech providers.
- Optional worker-backed automation plugins with declared permissions.
- Dynamic AppPlugins for native audio/TTS providers, with scoped APIs and prebuilt `.plugin` installation.
- English and Spanish UI translations with dark and light themes.
- A system-tray icon that hides the window instead of immediately quitting the app.

## Documentation index

The root README is the index for the project documentation. Start with the article that matches your task:

| Article | Use it when you need to… |
| --- | --- |
| [Getting Started](docs/GETTING_STARTED.md) | Install dependencies and launch the desktop app. |
| [User Guide](docs/USER_GUIDE.md) | Connect to a room and understand the dashboard tabs. |
| [Architecture](docs/ARCHITECTURE.md) | Understand the native host, WebView, bridge, live controller, and databases. |
| [Development Guide](docs/DEVELOPMENT.md) | Work on the codebase, run checks, and build a host bundle. |
| [Troubleshooting](docs/TROUBLESHOOTING.md) | Diagnose connection, native dependency, data, or plugin issues. |
| [Automations](docs/AUTOMATIONS.md) | Build behavior rules, workflows, scripts, and plugins. |
| [App plugins](docs/PLUGINS.md) | Build and install dynamic provider plugins such as MiniAudio and SonicBoom. |
| [UI Kit Usage](docs/UI_KIT_USAGE.md) | Use the shared Preact components and UI conventions. |

## Quick start

Requirements:

- [Bun](https://bun.sh/) with a version that supports the dependencies in `package.json`.
- Git, including submodule support.
- The native WebView and tray dependencies required by your operating system. Linux users should see [Getting Started](docs/GETTING_STARTED.md).

From a fresh checkout:

```bash
git submodule update --init --recursive
bun install
bun run typecheck
bun run start
```

The app starts a local Bun server on an ephemeral port and opens that URL in the embedded native WebView. No separate frontend server or fixed port is required.

For a release executable, run `bun run build:binary`, which compiles for the machine
you are on and writes `dist/TikTools-<platform>-<arch>` (`.exe` on Windows). Name
targets explicitly to cross-compile, for example `bun run build:binary windows-x64
linux-arm64`, or `bun run build:binary:all` for every supported target
(`windows-x64`, `windows-arm64`, `linux-x64`, `linux-arm64`). Bun
downloads the target runtime and embeds the matching native addons, so a Linux
machine can produce the Windows build. macOS targets build only when named
explicitly: `tray-icon-node` ships no macOS binary yet, so they fail at tray
startup.

Each executable includes the Bun runtime and bundled frontend and self-hosts
sandbox plugin workers; Bun and Node.js are not required on the target machine.
The system WebView is: WebView2 on Windows, WebKitGTK on Linux, WKWebView on
macOS. The `smoke:compiled*` gates run against the host build only, so releases
for other platforms should be verified on a runner for that platform.

## First connection

1. Choose a language and theme.
2. Enter a TikTok creator handle. The leading `@` is optional.
3. Leave the Cookie field empty to try anonymous guest mode, or paste an authenticated TikTok Cookie request header when the room requires it.
4. Connect directly, or use automatic live selection.
5. Use the navigation rail to open Feed, Points, Analytics, Behavior, Plugins, or Settings.

The creator handle, recent handles, language, and theme are stored in WebView local storage. Session cookies are kept in memory only; they are not saved to the repository or the local databases.

## Common commands

```bash
bun run start              # Start the desktop app
bun run typecheck          # Type-check the application
bun run test               # Run the app test suite
bun run test:plugin-worker # Run the plugin worker smoke test
bun run smoke:compiled     # Smoke-test the built executable and self-hosted plugin
bun run smoke:compiled-worker # Execute a node and capability through the compiled worker
bun run smoke:compiled-integration # Execute through the compiled host and capability broker
bun run build               # Build the binary for this platform
bun run build:host          # Build a development host bundle
bun run build:binary        # Build the binary for this platform
bun run build:binary:all    # Build binaries for every supported target
bun run build:all           # Build plugins, host bundle, and every supported binary
bun run clean               # Remove dist/ build output
bun run verify:binary       # Build and run the complete compiled release gate
```

`bun run test` intentionally runs tests under `src`. A bare `bun test` also discovers tests inside the vendored signer submodule, which may require generated distribution files that are not checked into this repository.

## Project layout

```text
index.ts                    Application entry point
src/main.ts                 Native window, WebView, tray, and shutdown lifecycle
src/server.ts               Ephemeral Bun server for the WebView frontend
src/live-controller.ts      TikTok connection, event conversion, persistence, and host actions
src/bridge.ts               Runtime validation for WebView-to-host messages
src/live-events.ts          TikTok event normalization and UI projections
src/db/                     SQLite databases for points and automations
src/automation/             Event bus, behavior engine, workflows, capabilities, and plugins
src/platform/               Central app-data paths and hidden-console logging
src/web/                    Preact application, views, components, and styles
vendor/tiktok-signer/       Git submodule containing the upstream TikTok client
scripts/build.ts            Unified build CLI (binary/host/plugins/all/clean/list)
scripts/build-lib.ts        Shared binary/host/plugin build tasks
scripts/build-binary.ts     Standalone binary build (wraps build-lib)
scripts/build-host.ts       Host bundle build (wraps build-lib)
docs/                       Project documentation indexed above
```

## Data and privacy

On Windows, durable app data is stored under `%LOCALAPPDATA%/TikTools/`:

```text
%LOCALAPPDATA%/TikTools/
  data/       SQLite databases
  plugins/    sandbox plugin packages
  logs/       TikTools.log
  temp/       generated automation audio
```

The app does not derive writable data from its current working directory. For development or tests, override paths with `TIKTOOLS_HOME`, `TIKTOOLS_DATA_DIR`, `TIKTOOLS_PLUGINS_DIR`, `TIKTOOLS_LOG_DIR`, or `TIKTOOLS_TEMP_DIR`.

The databases are:

- `data/tiktok-points.db` stores point rules, viewer totals, point transactions, creator history, app state, and the cached gift catalog.
- `data/tiktok-automation.db` stores workflows, behavior actions and events, and plugin state.

SonicBoom text-to-speech remains an optional external integration. TikTools itself works without SonicBoom; if it is unavailable, the TTS action reports an error and does not open a visible terminal. Generated audio is written under the app `temp` directory.

Authenticated Cookie headers are sensitive credentials. Do not log, commit, paste, or share them. Use the app only with rooms and accounts you are authorized to monitor, and follow TikTok’s terms and applicable policies.

## Architecture at a glance

```text
TikTok LIVE
    |
    v
LiveController -> AutomationEventBus -> BehaviorEngine / WorkflowRuntime
    |                       |                    |
    v                       v                    v
SQLite databases       WebView messages     host capabilities
                       (validated bridge)   HTTP / points / VM + plugin providers
```

The native host owns the TikTok client, persistence, automation runtime, and privileged capabilities. The Preact frontend owns presentation and sends JSON messages through the validated bridge. See [Architecture](docs/ARCHITECTURE.md) for the full message and data flow.

Sandbox plugins run in a separate `TikTools --plugin-worker` process in a compiled release, or in `bun index.ts --plugin-worker ...` during development. The worker keeps the token-authenticated localhost IPC, VM loop limit, source and message size limits, manifest permissions, and capability broker.

Audio and TTS providers are AppPlugins loaded with Bun `import()`. Their native
dependencies stay inside the plugin package, and the root host has no direct
MiniAudio or SonicBoom import.

## Contributing

Keep changes focused and type-safe. Before opening a change, run the relevant checks:

```bash
bun run typecheck
bun run test
bun run test:plugin-worker
bun run build:host
bun run build:binary
bun run smoke:compiled
bun run smoke:compiled-worker
bun run smoke:compiled-integration
```

For UI work, keep reusable controls in `src/web/components/ui/`, shared tokens in `src/web/styles/variables.css`, and view-specific layout in the corresponding stylesheet. Update the relevant article in `docs/` when behavior, setup, or public extension points change.

If anonymous guest bootstrap is rate-limited or rejected, retry later or connect with an authenticated Cookie header. See [Troubleshooting](docs/TROUBLESHOOTING.md) for more diagnostics.
