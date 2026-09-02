# TikTools automations

TikTools automations are event-driven workflows. The TikTok client publishes a normalized `AutomationEvent` to the automation bus while the existing UI continues to receive its display-oriented `UiEvent` projection.

```text
TikTok LiveEvent
      |
      v
AutomationEventBus ---> existing feed / points / analytics
      |
      v
WorkflowRuntime
      |
      +-- core nodes
      +-- host capabilities: HTTP / audio / TTS
      +-- trusted plugin nodes
      +-- worker-isolated napi-vm plugins
```

## Behavior: actions and events (current UI)

The Behavior tab replaced the node editor. Behavior is two records, not one:

- an **action** is a configured action type with a name of its own — "Aplausos" —
  and is reused by several events;
- an **event** is a trigger plus optional filters plus the actions it runs.

```text
AutomationEvent -> BehaviorEngine -> filters (all must pass) -> cooldown -> actions
```

Action types come from two places, and the difference is the point:

- **Built-in** types (`src/automation/behavior/catalog.ts`) have no dependencies,
  are always available and cannot be uninstalled: `core.fetch`, `core.emit`,
  `core.points`, `core.delay`, `core.log`, `core.code`.
- **Plugin** types arrive with a plugin, and one plugin may expose several. The
  provider packages are `audio.miniaudio` (the optional `miniaudio_node` binary)
  and `tts.sonicboom` (the SonicBoom child process); they register generic
  audio/TTS providers used by `audio.play`, `audio.stop`, and `tts.speak`.
  Installing or disabling a plugin is what makes its action types appear or
  stop running —
  the engine refuses an action whose plugin is not ready.

Filters are a flat list and every one must pass; there are no nested groups and
no per-row AND/OR. An "or" is expressed inside a single filter with the `in`
operator (`giftName is one of Universo, León`), which is what people actually
ask for. `src/automation/behavior/engine.ts` evaluates them, renders
`{{ event.* }}` placeholders, and performs the action; HTTP goes through
`HttpService` with an allowlist built from the configured URL, so a templated
host is refused: the allowlist has to be knowable before the event arrives.

### The condition editor

Nobody types `event.data.diamondCount`. `src/automation/behavior/fields.ts` is
the catalog of fields each trigger carries — label, icon, and the *kind* of
value it holds (`gift`, `user`, `number`, `text`, `boolean`). That kind decides
two things: which operators the row offers (`operatorsFor`) and which editor the
value gets. `src/web/components/ui/ConditionTable.tsx` renders the table (field
select · comparison · value · remove) and flags a filter whose value is still
empty, because such a filter can never pass.

Values that name real things come from real sources, through
`src/web/components/ui/PickerModal.tsx` — one searchable list with a picture per
row:

- **gifts** (`GiftPicker`) from the room's gift list. The submodule already
  reads it — `Discovery.giftList(roomId)`, an unsigned request the client runs
  on connect through `fetchGifts` — so nothing new was needed there. The
  controller stores that map in the `gift_catalog` table (`storeGiftCatalog`)
  and, when the table is empty, refreshes it from the last known `roomId`
  without connecting (`refreshGiftCatalog`), which is what makes the picker work
  while offline. The filter stores the gift NAME, which is what the event
  carries.
- **viewers** (`UserPicker`) from the points table's leaderboard, plus a plain
  `@` field for someone the app has never seen.

Comparisons are drawn, not typed: `src/web/components/condition-icons.tsx` has
one SVG glyph per operator (`>=`, `!==`, `∈`…) plus the code equivalent shown in
its tooltip, so the symbol is learnable rather than decorative.

Actions, events and plugin state live in the `behavior_actions`,
`behavior_events` and `behavior_plugins` tables of `src/db/automation-db.ts`.
Run history is session-only and lives in the engine, like the live event
snapshot.

Code actions run in the synchronous `napi-vm` session, which only exchanges
JSON, so a script returns what should happen and the host performs it against
the same capabilities the other action types use:

```js
log(`${event.user.uniqueId} · ${event.data.diamondCount}`)

return {
  emit: [{ type: "overlay.rank", data: { nombre: event.user.nickname } }],
  fetch: { url: "https://hooks.example.com/rank", method: "POST", body: "{}" },
  emitResponseAs: "overlay.rank.done",
}
```

`fetch` from a script is checked against the hosts that appear in the script
source, so a plugin cannot reach a domain it does not declare.

The workflow engine below still runs saved graphs and worker-backed plugins; it
no longer has a UI.

## Current implementation

- `src/automation/types.ts` defines JSON-safe events, ports, workflows, node definitions, and execution contexts.
- `src/automation/events.ts` preserves raw TikTok fields such as gift IDs, combo counts, room stats, and user IDs.
- `src/automation/runtime.ts` executes flow edges and data edges with cancellation, per-workflow state, concurrency limits, and a step limit.
- `src/automation/nodes/builtins.ts` contains event triggers, compare, template, synchronous `napi-vm` Script, delay, cooldown, log, HTTP request, play sound, TTS, and points actions.
- `src/web/components/node-editor/` contains the reusable workflow editor library: the creation wizard, node picker, ordered step canvas, and typed configuration forms. It edits the app-owned `WorkflowGraph` directly, so the UI does not depend on a graph engine and no editor-specific objects are persisted.
- `src/db/automation-db.ts` persists graph JSON in SQLite.
- `src/automation/plugins/plugin-manager.ts` can register trusted node implementations and filters their declared host capabilities.
- `src/automation/plugins/plugin-worker-host.ts` launches `index.ts --plugin-worker` in development or `TikTools.exe --plugin-worker` in a compiled release. `src/automation/plugins/plugin-worker.ts` executes sandbox handlers in that separate process over an authenticated loopback JSON protocol.
- `src/automation/plugins/plugin-loader.ts` discovers `plugins/<directory>/plugin.json`, rejects filesystem-trusted entries, and registers only worker-backed sandbox nodes.
- `src/automation/services/napi-vm-language-service.ts` exposes napi-vm diagnostics, hover, and event/input property completions to the Script editor.

The graph editor components remain available under `src/web/components/node-editor/`, but the current navigation exposes the Behavior tab as the user-facing automation editor. The graph runtime and saved workflow format are still host-side extension points. When the graph editor is mounted, **New workflow** opens the wizard, **Add step** appends nodes in order, and **Configure step** edits a local draft with explicit **Apply/Cancel** actions. The editor does not expose a manual JSON configuration field. Script nodes intentionally keep a code editor because JavaScript is the node’s input, but their surrounding workflow configuration remains form-driven.

Text fields that support runtime templates expose event-aware autocomplete. Type `{{` or focus a template field to insert paths such as `event.data.diamondCount` or `event.user.uniqueId`; the value is stored in the same template syntax understood by the runtime. Each built-in input selects a declarative suggestion scope (`message`, `identity`, `text`, `sound-file`, `http-url`, `http-data`, or `compare`) so a sound-file field does not suggest chat comments and a cooldown key does not suggest arbitrary event data. Suggestions are positioned at the current cursor and support mouse, arrow keys, Tab, and Enter. For extensible maps such as HTTP headers, key/value rows are the right UX boundary: regular node settings should stay schema-driven, while headers may contain template values. A generic key/value editor for every node would lose validation and make plugins harder to understand.

While a LIVE connection is active, the host keeps the most recent normalized `AutomationEvent` in memory and sends a throttled snapshot to the WebView. The editor uses that snapshot to show real previews beside template paths and to provide `napi-vm` Script completion/hover values. It is intentionally session-only rather than persisted to SQLite, because it can contain viewer names, chat text, and other live data.

## Example: gift threshold

```text
[Event Trigger: tiktok.gift]
             |
             v
[Compare: event.data.diamondCount >= 100]
             | true
             v
[Cooldown: {{ event.user.uniqueId }}, 5 seconds]
             |
             v
[Play Sound: assets/sounds/big-gift.wav]
```

Flow connections select the next execution branch. Data connections carry values. A `condition.compare` node can read an event path directly or receive a value through a data edge.

## Example: arbitrary API integration

```text
[Event Trigger: tiktok.chat]
             |
             v
[HTTP Request]
             |
       success / error
             v
[Template / Log]
```

The HTTP node is backed by `HttpService`, not by plugin-owned `fetch`. It supports:

- method, headers, body templates, JSON/text/bytes response parsing;
- timeouts and maximum response sizes;
- redirects disabled by default, with bounded redirect-following that revalidates each destination;
- optional host allowlists;
- blocking of localhost, private IP ranges, link-local addresses, and DNS names resolving to private addresses unless local-network access is explicitly enabled.

Secrets and OAuth should be added through a secret capability rather than saved in workflow JSON. The current HTTP node is intentionally a foundation for that broker.

## Script nodes

The built-in Script node runs synchronously through `napi-vm` and receives only JSON globals:

```js
log(`gift value: ${event.data.diamondCount}`)
return event.data.diamondCount >= inputs.minimum
```

It does not expose `require`, filesystem, network, process, or native modules. Scripts return JSON values; privileged work belongs in HTTP, audio, TTS, points, or future capability nodes. The VM is an in-process execution helper for the built-in trusted node; downloaded plugins use the worker process described below.

## Audio and TTS

The host exposes only the provider registries through the generic AppPlugin
runtime. The MiniAudio package keeps the N-API wrapper and platform binary
inside its own directory; the SonicBoom package owns its child process and
localhost HTTP details:

```text
Text to Speech node
       |
       v
SonicBoom /api/tts -> temporary WAV file
       |
       v
Play Sound node -> audio provider registry -> MiniAudio plugin -> N-API
```

This keeps the workflow node contract stable while allowing another audio or
TTS provider to replace either package.

## Plugin boundary

### Declarative plugin actions

Plugins can contribute behavior actions without importing the WebView. The worker SDK supports both `registerNode()` and `registerAction()`:

```js
import { registerAction, capability } from "@tiktools/sdk";

registerAction({
  definition: {
    id: "dev.example.webhook",
    version: 1,
    title: { "default": "Webhook", "i18key": "dev.example.webhook.action.title" },
    description: { "default": "Send an event", "i18key": "dev.example.webhook.action.description" },
    tag: "http",
    source: { kind: "plugin", pluginId: "dev.example.webhook" },
    configSchema: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string", title: { "default": "URL", "i18key": "dev.example.webhook.field.url" } },
        body: { type: "string", format: "json", title: { "default": "JSON body", "i18key": "dev.example.webhook.field.body" } }
      }
    },
    requiredCapabilities: ["http.request"]
  },
  isAsync: true,
  handler: `
    const response = await capability("http.request", {
      method: "POST",
      url: action.config.url,
      body: action.config.body
    });
    return { summary: String(response.status) };
  `
});
```

The host renders the schema in its own modal/form components. `uiHints` can mark fields as templates, advanced fields, conditional fields, or key/value maps. Plugin code cannot inject arbitrary Preact, HTML, or DOM into the WebView.

String templates use `{{ event.* }}` paths. For fields marked as JSON, TikTools renders templates first and parses the final text as JSON; invalid output is rejected before the capability is called. Hosts and domains used for network permissions must remain statically discoverable.

Trusted plugins can register `NodeImplementation` objects through `PluginManager`, but their manifest must declare every capability required by their nodes. They are host code and should be bundled with TikTools or another reviewed native provider.

Downloaded plugins are loaded from `plugins/<id>/plugin.json` only when they declare `executionMode: "sandbox"`. The loader reads the entry source, starts a child worker, and exposes only the SDK module below. A sandbox plugin entry registers descriptors; handler bodies are strings evaluated by `napi-vm` inside the worker:

```json
{
  "manifestVersion": 1,
  "id": "dev.example.webhook",
  "name": "Webhook action",
  "version": "1.0.0",
  "apiVersion": 1,
  "executionMode": "sandbox",
  "entry": "index.js",
  "i18n": {
    "en": "i18n/en.json",
    "es": "i18n/es.json"
  },
  "metadata": {
    "name": { "default": "Webhook action", "i18key": "dev.example.webhook.name" },
    "description": { "default": "Sends an event to a webhook.", "i18key": "dev.example.webhook.description" },
    "dependency": { "default": "Network access", "i18key": "dev.example.webhook.dependency" }
  },
  "permissions": {
    "capabilities": ["http.request"],
    "network": ["hooks.example.com"]
  }
}
```

Locale files are flat JSON key/value maps. Their keys must match the
`i18key` values used by the plugin descriptors and should be namespaced with
the plugin id:

```json
{
  "dev.example.webhook.name": "Acción webhook",
  "dev.example.webhook.description": "Envía un evento a un webhook.",
  "dev.example.webhook.dependency": "Acceso de red",
  "dev.example.webhook.action.title": "Webhook",
  "dev.example.webhook.action.description": "Envía un evento",
  "dev.example.webhook.field.url": "URL",
  "dev.example.webhook.field.body": "Cuerpo JSON"
}
```

`default` is always displayed when a locale file or key is unavailable. The
host loads locale files from inside the plugin directory, validates that they
are flat string maps, and sends them to the WebView with the behavior
snapshot. Plugins cannot override host translations.

```js
import { registerNode } from "@tiktools/sdk";

registerNode({
  definition: {
    type: "webhook.send",
    version: 1,
    title: "Send Webhook",
    category: "Actions",
    kind: "action",
    inputs: [{ name: "flow", title: "Flow", kind: "flow" }],
    outputs: [{ name: "success", title: "Success", kind: "flow" }],
    configSchema: { type: "object", properties: {} },
    requiredCapabilities: ["http.request"]
  },
  isAsync: true,
  handler: `const response = await capability("http.request", {
    method: "POST",
    url: "https://hooks.example.com/live",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event, inputs })
  });
  return { outputs: { response }, next: ["success"] };`
});
```

The `isAsync` spelling is intentional: it avoids an object-literal parsing ambiguity in the current napi-vm release. The worker exposes no Node `require`, filesystem, network, process, native module, or host service. `capability()` sends a JSON request to the parent broker, which checks the manifest again before calling HTTP/audio/TTS/points/VM providers. HTTP network permissions are host/path checked, and private addresses still require an explicit `local` permission. Audio requests additionally require a `files` permission; the broker resolves paths and rejects traversal or symlink escapes outside the declared directory.

Plugins that provide event triggers should set `definition.kind` to `"trigger"` and include `triggerTypes` such as `["tiktok.gift"]`; the runtime uses that list as the worker-safe trigger filter.

The process boundary is a crash/isolation boundary, not a claim of kernel-level sandboxing. A future marketplace should add OS sandboxing, signatures, dependency policy, and resource quotas before treating downloaded code as hostile.

The worker is serialized: asynchronous handlers use `napi-vm.runAsync()` one at a time, while the built-in Script node stays synchronous for high-frequency TikTok events.

The editor sends Script source to `NapiVmLanguageService` through the typed host bridge. It combines napi-vm diagnostics/host metadata with normalized event-shape completions such as `event.data.diamondCount` and `event.user.uniqueId`.

The resulting boundary is:

```text
plugin package -> plugin-worker -> napi-vm -> capability broker
```

The worker protocol exchanges only JSON-safe events, node descriptors, execution results, logs, and named capability requests. It uses an authenticated loopback socket because Bun’s current piped stdin behavior is not incremental in all supported launch modes; this remains child-process IPC and can be replaced with stdio or named pipes without changing node definitions.

The worker is an imported TypeScript module, so `build:host` and `build:binary` do not copy a `plugin-worker.cjs` sidecar. The Windows executable embeds the Bun runtime, frontend, and native modules it needs; its worker child is the same `TikTools.exe` launched with `--plugin-worker`. `TIKTOOLS_HOST_OUTDIR=/path/to/output bun run build:host` changes the development bundle destination.

## Verification

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

`bun run test` is scoped to the app’s tests. Running bare `bun test` also discovers the vendored TikTok signer tests, which currently expect generated `vendor/tiktok-signer/.../dist` files that are not checked in.
