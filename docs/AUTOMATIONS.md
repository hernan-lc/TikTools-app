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

## Current implementation

- `src/automation/types.ts` defines JSON-safe events, ports, workflows, node definitions, and execution contexts.
- `src/automation/events.ts` preserves raw TikTok fields such as gift IDs, combo counts, room stats, and user IDs.
- `src/automation/runtime.ts` executes flow edges and data edges with cancellation, per-workflow state, concurrency limits, and a step limit.
- `src/automation/nodes/builtins.ts` contains event triggers, compare, template, synchronous `napi-vm` Script, delay, cooldown, log, HTTP request, play sound, TTS, and points actions.
- `src/web/components/node-editor/` contains the reusable workflow editor library: the creation wizard, node picker, ordered step canvas, and typed configuration forms. It edits the app-owned `WorkflowGraph` directly, so the UI does not depend on a graph engine and no editor-specific objects are persisted.
- `src/db/automation-db.ts` persists graph JSON in SQLite.
- `src/automation/plugins/plugin-manager.ts` can register trusted node implementations and filters their declared host capabilities.
- `src/automation/plugins/plugin-worker-host.ts` and `plugin-worker.cjs` execute sandbox plugin handlers in a separate process over an authenticated loopback JSON protocol.
- `src/automation/plugins/plugin-loader.ts` discovers `plugins/<directory>/plugin.json`, rejects filesystem-trusted entries, and registers only worker-backed sandbox nodes.
- `src/automation/services/napi-vm-language-service.ts` exposes napi-vm diagnostics, hover, and event/input property completions to the Script editor.

The first UI is available from the Automations tab. Click **New workflow** to open the wizard, enter a name, and choose the TikTok event that starts the workflow. Add actions from **Add step** or the node catalog; each step is appended in order and is connected through its flow port automatically. Select a step and click **Configure step** to open a wide modal with a local draft and explicit **Apply/Cancel** actions. The editor does not expose a manual JSON configuration field. Script nodes intentionally keep a code editor because JavaScript is the node’s input, but their surrounding workflow configuration remains form-driven.

Text fields that support runtime templates expose event-aware autocomplete. Type `{{` or focus a template field to insert paths such as `event.data.diamondCount` or `event.user.uniqueId`; the value is stored in the same template syntax understood by the runtime. For extensible maps such as HTTP headers, key/value rows are the right UX boundary: regular node settings should stay schema-driven, while headers may contain template values. A generic key/value editor for every node would lose validation and make plugins harder to understand.

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

`NativeAudioService` is a trusted host adapter for `miniaudio_node`. It supports local file playback and `allow`, `restart`, and `drop` overlap policies. The native package is loaded only when a Play Sound node executes, so the UI and graph runtime do not import native audio code.

`miniaudio_node` is declared as an optional native dependency because its platform binary may be unavailable on a target OS. The service initializes it lazily on the first Play Sound action and reports a clear capability error instead of preventing the rest of TikTools from starting.

`SonicBoomProvider` owns an optional SonicBoom child process and uses its current localhost HTTP API:

```text
Text to Speech node
       |
       v
SonicBoom /api/tts -> temporary WAV file
       |
       v
Play Sound node -> miniaudio_node
```

This matches SonicBoom’s current server shape. A future stdio worker can implement the same `TtsCapability` without changing workflow nodes.

## Plugin boundary

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
  "permissions": {
    "capabilities": ["http.request"],
    "network": ["hooks.example.com"]
  }
}
```

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

The host bundle has one non-imported runtime asset: `plugin-worker.cjs`. Use `bun run build:host` so the build copies it next to the generated host entrypoint. The worker still needs the installed `napi-vm` package/native assets at runtime; a packaged desktop distribution must include those dependencies alongside the host bundle. `TIKTOOLS_HOST_OUTDIR=/path/to/output bun run build:host` changes the destination.

## Verification

```bash
bun run typecheck
bun run test
bun run test:plugin-worker
bun run build:host
```

`bun run test` is scoped to the app’s tests. Running bare `bun test` also discovers the vendored TikTok signer tests, which currently expect generated `vendor/tiktok-signer/.../dist` files that are not checked in.
