# Development Guide

This article is for contributors working on the TypeScript host, Preact frontend, automation runtime, or native integration.

## Install and verify

~~~bash
git submodule update --init --recursive
bun install
bun run typecheck
bun run test
bun run test:plugin-worker
~~~

The project uses Bun’s module and bundling behavior. Keep `.ts` and `.tsx` import extensions consistent with the existing source.

## Command reference

| Command | Purpose |
| --- | --- |
| `bun run start` | Start the native desktop app. |
| `bun run typecheck` | Run strict TypeScript checking without emitting files. |
| `bun run test` | Run tests under `src`. |
| `bun run test:plugin-worker` | Run the plugin worker smoke test. |
| `bun run build:plugins` | Build the checked-in MiniAudio and SonicBoom AppPlugin entries. |
| `bun run package:plugin <dir> [file.plugin]` | Package a prebuilt plugin directory with checksums. |
| `bun run install:plugin <file.plugin> [--replace]` | Manually install a validated prebuilt plugin archive. |
| `bun run smoke:compiled` | Launch the built EXE with a fixture plugin and verify app-data paths. |
| `bun run smoke:compiled-worker` | Execute nodes and a capability through the compiled worker process. |
| `bun run smoke:compiled-integration` | Execute a compiled worker through the real host and capability broker. |
| `bun run build:host` | Build a development host bundle in `dist/`. |
| `bun run build:exe` | Build the Windows GUI executable at `dist/TikTools.exe`. |
| `bun run verify:exe` | Build the host and EXE, then run all compiled smoke tests. |

Use `bun test path/to/file.test.ts` when you need to focus on one test file.

## Source ownership

Choose the narrowest layer that owns the behavior:

- Native lifecycle: `src/main.ts`, `src/server.ts`, `src/tray.ts`.
- TikTok connection and host messages: `src/live-controller.ts`, `src/live-events.ts`, `src/bridge.ts`.
- Wire types: `src/shared/messages.ts`.
- Persistence: `src/db/points-db.ts`, `src/db/automation-db.ts`.
- Automation behavior: `src/automation/behavior/`.
- Graph runtime and built-ins: `src/automation/runtime.ts`, `src/automation/nodes/`.
- Plugin security and lifecycle: `src/automation/plugins/`.
- Frontend state: `src/web/app.tsx`.
- Frontend screens: `src/web/views/`.
- Reusable controls: `src/web/components/ui/`.
- CSS tokens and layout: `src/web/styles/`.

Keep host-only concerns out of the WebView. If a new capability needs network, filesystem, audio, TTS, points, or native access, expose a typed host capability and validate it at the bridge or capability boundary.

## Frontend conventions

- Prefer controlled components with `value` and `onValueChange`.
- Reuse components from `src/web/components/ui/` before adding a one-off control.
- Keep layout constraints explicit in flex and grid containers; use `min-width: 0` and `min-height: 0` where a child must be allowed to shrink.
- Keep host translations in `src/web/i18n.ts`. Declarative metadata uses
  `{ default, i18key }`; plugin locale files are flat key/value JSON maps
  declared by `manifest.i18n` and loaded into the behavior snapshot.
- Keep theme tokens in `src/web/styles/variables.css`.
- Use the existing CSS import order in `src/web/styles.css`.

See [UI Kit Usage](UI_KIT_USAGE.md) for component APIs and examples.

## Adding a WebView message

1. Add the page-to-host or host-to-page type in `src/shared/messages.ts`.
2. Parse and validate the page message in `src/bridge.ts`.
3. Handle it in `LiveController.handlePageMessage()`.
4. Send a typed host response where needed.
5. Update the frontend state and view.
6. Add a focused test for validation or behavior where practical.

Do not pass arbitrary page objects into host services. Treat every WebView message as untrusted input.

## Adding an automation action

For the current Behavior UI, add the action type and schema in `src/automation/behavior/`, then update its catalog, localized labels, engine execution, and tests. If it needs a host capability, declare that dependency and enforce it through the capability layer.

New behavior actions should register through `ActionRegistry`. Their configuration is a bounded JSON Schema object with optional UI hints (`kind`, `template`, `advanced`, `showIf`, and localized labels). Use `{ default, i18key }` for labels, titles, and descriptions; the default is the fallback and the key is resolved from the host or plugin key/value catalog. The WebView renders this descriptor through `SchemaForm`; plugins do not ship Preact or DOM code. Built-in actions use the same registry and execution contract as sandbox actions. Existing behavior records with action schema version 1 are normalized to version 2 on read/save; records for missing plugins remain visible but unavailable.

For graph nodes, add the node definition and implementation in `src/automation/nodes/builtins.ts`, then add configuration and suggestions in `src/web/components/node-editor/` as appropriate. Saved workflow graphs must remain JSON-safe and pass graph validation.

## Adding a plugin

A plugin is discovered from `plugins/<directory>/plugin.json`. Its manifest declares an id, version, execution mode, permissions, and optional locale files such as `{ "i18n": { "en": "i18n/en.json", "es": "i18n/es.json" } }`. Locale files are flat key/value JSON maps and should namespace keys with the plugin id. Downloaded plugins should use `executionMode: "sandbox"` and the worker SDK path described in [Automations](AUTOMATIONS.md). A sandbox entry may register both nodes and actions; actions are described with JSON Schema and execute in the worker through the capability broker.

Provider AppPlugins use the separate `schemaVersion: 1` manifest contract in
`src/plugins/` and are loaded with dynamic `import()`. Use that contract for
audio/TTS/native providers; do not add provider-specific imports to the host.
The MiniAudio and SonicBoom package fixtures live under `plugins/` and their
native dependencies are packaged with the plugin rather than the root
`package.json`. See [App plugins](PLUGINS.md).

Trusted plugins are host code and should only be used for reviewed, bundled integrations. A worker process is a crash/isolation boundary, not a full security sandbox.

Sandbox workers are launched as `bun index.ts --plugin-worker --port ... --token ...` during development. In a compiled build, `PluginWorkerHost` uses `process.execPath`, so the child is `TikTools.exe --plugin-worker ...`. The worker does not import or initialize the WebView, tray, or GUI host; it only loads the VM and authenticated localhost protocol. Both launch paths use hidden child-process windows on Windows.

## Testing and build output

Run the full local check before handoff:

~~~bash
bun run typecheck
bun run test
bun run test:plugin-worker
bun run build:host
bun run build:exe
bun run smoke:compiled
bun run smoke:compiled-worker
bun run smoke:compiled-integration
~~~

The executable-only release gate can be run with `bun run verify:exe`. It
builds the host and Windows executable before running all compiled smoke tests.

The build writes generated output to `dist/`; do not edit it by hand. `build:exe` cleans the output directory before producing `TikTools.exe`, so stale worker sidecars cannot be mistaken for release dependencies. The compiled executable statically bundles the frontend and verifies the native N-API modules at runtime when the GUI, databases, tray, and worker features are exercised.

Writable runtime paths are resolved by `src/platform/app-paths.ts`. On Windows they default to `%LOCALAPPDATA%/TikTools/`, not `process.cwd()`. On first startup after this path change, each missing new database is copied from its matching `./data/<name>.db` legacy file without overwriting an existing new database; the migration is logged. Fatal startup errors, plugin worker failures, native warnings, and provider errors are written to `%LOCALAPPDATA%/TikTools/logs/TikTools.log`; credentials and worker tokens are redacted. The log rotates to `TikTools.log.1` at 5 MiB.

For UI changes, run the app and inspect both a normal desktop window and a narrow/resized window. Check scrolling, empty states, disabled controls, light/dark themes, and English/Spanish labels.
