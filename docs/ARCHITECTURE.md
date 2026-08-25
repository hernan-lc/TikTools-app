# Architecture

TikTools is a native host wrapped around a local Preact application. The host owns external I/O, persistence, and privileged capabilities; the WebView owns presentation and user interaction.

## Process shape

~~~text
index.ts
  |
  v
src/main.ts
  +--> src/server.ts ----> src/web/index.html + Preact/CSS
  +--> webview-napi -----> embedded WebView window
  +--> src/tray.ts -------> system-tray icon
  +--> src/live-controller.ts
                              +--> TikTok client
                              +--> SQLite databases
                              +--> automation bus and runtimes
~~~

The server binds to an ephemeral localhost port. The native window loads the bundled WebView page from that server and communicates with the host through the WebView IPC bridge.

## Runtime responsibilities

### Native host

- `src/main.ts` creates the runtime, window, WebView, tray, close guard, and shutdown sequence.
- `src/live-controller.ts` owns connection generations, guest/authenticated session setup, reconnect handling, event conversion, points, behavior, workflows, and host-to-page messages.
- `src/server.ts` serves the frontend entry point.
- `src/tray.ts` manages show and quit commands.
- `src/bridge.ts` parses and validates untrusted page messages before they reach the host.

### Frontend

- `src/web/app.tsx` owns UI state and routes events to the active view.
- `src/web/views/` contains the Feed, Connect, Points, Analytics, Behavior, Plugins, and Settings screens.
- `src/web/components/ui/` contains shared controls such as cards, fields, buttons, tables, and modals.
- `src/web/styles/` contains tokens, layout rules, component styles, and view-specific styles.

The frontend never calls the TikTok client or SQLite directly. It sends JSON messages through `window.ipc.postMessage`.

## Message flow

~~~text
User interaction
      |
      v
Preact view -> window.ipc.postMessage(JSON)
      |
      v
src/bridge.ts -> parsePageMessage()
      |
      v
LiveController.handlePageMessage()
      |
      +--> TikTok client
      +--> SQLite
      +--> automation services
      |
      v
send(HostMessage) -> WebView -> app state update
~~~

The bridge accepts only known message types and validates their fields. Workflow graphs, behavior actions, and behavior events receive additional schema validation before persistence or execution.

## Live event flow

~~~text
TikTok LiveEvent
      |
      v
src/live-events.ts
      |
      +--> display-oriented UiEvent -> Feed
      |
      +--> normalized AutomationEvent -> AutomationEventBus
                                             |
                                             +--> BehaviorEngine
                                             +--> WorkflowRuntime
                                             +--> points capability
~~~

The raw event is normalized once for automation while the feed receives a display-oriented projection. The latest normalized automation event is kept in memory for editor previews and is not written to SQLite.

## Persistence

There are two separate SQLite databases, both created relative to the current working directory:

- `data/tiktok-points.db`: points configuration, viewers, point transactions, creator history, app state, and cached gift catalog.
- `data/tiktok-automation.db`: saved workflow graphs, behavior actions, behavior events, and plugin state.

The WebView uses local storage for non-sensitive preferences. Session cookies are intentionally not persisted.

## Automation and app-plugin boundaries

The automation layer is split into:

- `src/automation/event-bus.ts`: normalized event publication.
- `src/automation/behavior/`: current action/event behavior engine and schema.
- `src/automation/runtime.ts`: saved graph execution.
- `src/automation/nodes/`: built-in workflow node implementations.
- `src/automation/services/`: HTTP, VM, and language services; provider-backed audio/TTS adapters live in `src/plugins/`.
- `src/automation/plugins/`: plugin discovery, manifests, worker host, protocol, and capability broker.
- `src/plugins/`: generic AppPlugin API, dynamic-import runtime, provider registries, scoped storage/i18n/UI APIs, and `.plugin` installation.

Built-in actions run in the host. Sandbox automation handlers execute in a separate worker through JSON messages. Provider plugins are loaded through Bun `import()` and register generic audio/TTS providers; the host never imports provider-native libraries directly. The capability broker and AppPlugin context check declared permissions before plugin code receives host capabilities.

The worker boundary improves isolation and limits access, but it is not an operating-system security sandbox. Treat downloaded plugins as code that requires review.

## Shutdown

A window close request hides the window. A tray quit or process signal performs an orderly shutdown:

1. Stop the live connection.
2. Cancel active workflows.
3. Stop audio and TTS providers.
4. Stop plugin workers and app plugins.
5. Clear VM sessions and language-service state.
6. Close the native window and local server.
7. Exit the runtime.

See [Development Guide](DEVELOPMENT.md) for the safest places to make changes.
