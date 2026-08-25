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
| `bun run smoke:compiled` | Launch the built EXE with a fixture plugin and verify app-data paths. |
| `bun run build:host` | Build a development host bundle in `dist/`. |
| `bun run build:exe` | Build the Windows GUI executable at `dist/TikTools.exe`. |

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
- Keep translations in `src/web/i18n.ts`.
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

For graph nodes, add the node definition and implementation in `src/automation/nodes/builtins.ts`, then add configuration and suggestions in `src/web/components/node-editor/` as appropriate. Saved workflow graphs must remain JSON-safe and pass graph validation.

## Adding a plugin

A plugin is discovered from `plugins/<directory>/plugin.json`. Its manifest declares an id, version, execution mode, and permissions. Downloaded plugins should use `executionMode: "sandbox"` and the worker SDK path described in [Automations](AUTOMATIONS.md).

Trusted plugins are host code and should only be used for reviewed, bundled integrations. A worker process is a crash/isolation boundary, not a full security sandbox.

Sandbox workers are launched as `bun index.ts --plugin-worker --port ... --token ...` during development. In a compiled build, `PluginWorkerHost` uses `process.execPath`, so the child is `TikTools.exe --plugin-worker ...`. The worker does not import or initialize the WebView, tray, or GUI host; it only loads the VM and authenticated localhost protocol. Both launch paths use hidden child-process windows on Windows.

## Testing and build output

Run the full local check before handoff:

~~~bash
bun run typecheck
bun run test
bun run test:plugin-worker
bun run smoke:compiled
bun run build:host
bun run build:exe
~~~

The build writes generated output to `dist/`; do not edit it by hand. `build:exe` cleans the output directory before producing `TikTools.exe`, so stale worker sidecars cannot be mistaken for release dependencies. The compiled executable statically bundles the frontend and verifies the native N-API modules at runtime when the GUI, databases, tray, and worker features are exercised.

Writable runtime paths are resolved by `src/platform/app-paths.ts`. On Windows they default to `%LOCALAPPDATA%/TikTools/`, not `process.cwd()`. Fatal startup errors, plugin worker failures, native warnings, and provider errors are written to `%LOCALAPPDATA%/TikTools/logs/TikTools.log`; credentials and worker tokens are redacted.

For UI changes, run the app and inspect both a normal desktop window and a narrow/resized window. Check scrolling, empty states, disabled controls, light/dark themes, and English/Spanish labels.
