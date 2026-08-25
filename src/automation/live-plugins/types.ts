import type { AutomationEventType, JsonObject, JsonValue } from '../types.ts';

/**
 * A live plugin is one event plus one action. There is no graph, no ports,
 * and no edges: the filter and the cooldown are fields of the same record.
 *
 * Only two output primitives exist. `fetch` performs an HTTP request through
 * the host `HttpService`, and `emit` publishes an internal event. Sound, TTS,
 * and points are templates that emit a well-known event type which the engine
 * binds to a host capability.
 */
export type LivePluginMode = 'template' | 'code';

export type LivePluginOperator =
  | 'greater-or-equal'
  | 'greater-than'
  | 'less-or-equal'
  | 'less-than'
  | 'equals'
  | 'not-equals'
  | 'contains'
  | 'starts-with';

export type LivePluginCooldownScope = 'global' | 'user';

export interface LivePluginCondition {
  /** Dotted path resolved against `{ event, data, user }`. */
  path: string;
  operator: LivePluginOperator;
  /** Compared as a number when both sides parse as numbers, as text otherwise. */
  value: string;
}

export interface LivePluginFetchAction {
  kind: 'fetch';
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** May contain `{{ event.* }}` placeholders. */
  url: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs?: number;
  allowPrivateNetwork?: boolean;
  /** When set, the response is published as this internal event type. */
  emitResponseAs?: string;
}

export interface LivePluginEmitAction {
  kind: 'emit';
  /** Internal event type, e.g. `overlay.sound` or a name you invent. */
  type: string;
  /** Values may contain `{{ event.* }}` placeholders. */
  data: Record<string, string>;
}

export interface LivePluginCodeAction {
  kind: 'code';
  /** JavaScript evaluated by napi-vm. See `LivePluginIntent` for the result. */
  source: string;
}

export type LivePluginAction =
  | LivePluginFetchAction
  | LivePluginEmitAction
  | LivePluginCodeAction;

export interface LivePlugin {
  schemaVersion: 1;
  id: string;
  name: string;
  enabled: boolean;
  /** Catalog entry the plugin was created from; `code` for the editor. */
  templateId: string;
  mode: LivePluginMode;
  trigger: AutomationEventType;
  condition?: LivePluginCondition;
  cooldownMs: number;
  cooldownScope: LivePluginCooldownScope;
  action: LivePluginAction;
}

export interface LivePluginRecord {
  plugin: LivePlugin;
  createdAt: number;
  updatedAt: number;
}

/**
 * Permissions are derived from the saved plugin rather than typed by hand, and
 * are re-checked by the engine on every call.
 */
export interface LivePluginPermissions {
  network: string[];
  capabilities: string[];
  localNetwork: boolean;
}

export type LivePluginRunStatus = 'ok' | 'error' | 'skipped';

export interface LivePluginRun {
  id: string;
  pluginId: string;
  pluginName: string;
  at: number;
  status: LivePluginRunStatus;
  /** Short machine-ish line, e.g. `200 OK · 142 ms` or `emit overlay.sound`. */
  summary: string;
  durationMs: number;
  test: boolean;
  logs: string[];
  error?: string;
}

/**
 * What a code plugin returns. The napi-vm session is synchronous and only
 * exchanges JSON, so scripts describe what should happen and the host performs
 * it against the same capabilities the templates use.
 */
export interface LivePluginIntent extends JsonObject {
  emit?: JsonValue;
  fetch?: JsonValue;
  emitResponseAs?: JsonValue;
  log?: JsonValue;
}
