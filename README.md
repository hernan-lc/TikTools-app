# TikTools

TikTools is a Bun-powered desktop companion for TikTok LIVE. It connects to a live room, displays chat and engagement telemetry, awards viewer points, and runs configurable automations from an embedded WebView window.

The app is built for people who want a lightweight live dashboard with a local data store, a system-tray workflow, and extensible event-driven behavior.

## What it includes

- TikTok LIVE connection with guest discovery or an authenticated Cookie header.
- Live feed for chat, gifts, likes, joins, follows, shares, and room statistics.
- Local points, levels, subscriber bonuses, viewer leaderboard, and creator history.
- Analytics for the current session.
- Behavior rules that connect events, filters, cooldowns, and actions.
- Built-in HTTP, points, delay, logging, script, audio, and text-to-speech capabilities.
- Optional worker-backed automation plugins with declared permissions.
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
bun run build:host         # Build the Bun host and copy plugin-worker.cjs
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
src/web/                    Preact application, views, components, and styles
vendor/tiktok-signer/       Git submodule containing the upstream TikTok client
data/                       Runtime SQLite files created by the app
docs/                       Project documentation indexed above
scripts/build-host.ts       Host bundle and plugin worker build script
```

## Data and privacy

The app writes local SQLite files under `data/`:

- `tiktok-points.db` stores point rules, viewer totals, point transactions, creator history, app state, and the cached gift catalog.
- `tiktok-automation.db` stores workflows, behavior actions and events, and plugin state.

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
                       (validated bridge)   HTTP / audio / TTS / points / VM
```

The native host owns the TikTok client, persistence, automation runtime, and privileged capabilities. The Preact frontend owns presentation and sends JSON messages through the validated bridge. See [Architecture](docs/ARCHITECTURE.md) for the full message and data flow.

## Contributing

Keep changes focused and type-safe. Before opening a change, run the relevant checks:

```bash
bun run typecheck
bun run test
bun run test:plugin-worker
bun run build:host
```

For UI work, keep reusable controls in `src/web/components/ui/`, shared tokens in `src/web/styles/variables.css`, and view-specific layout in the corresponding stylesheet. Update the relevant article in `docs/` when behavior, setup, or public extension points change.

If anonymous guest bootstrap is rate-limited or rejected, retry later or connect with an authenticated Cookie header. See [Troubleshooting](docs/TROUBLESHOOTING.md) for more diagnostics.
