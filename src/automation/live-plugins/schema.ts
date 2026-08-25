import type { AutomationEventType } from '../types.ts';
import { findLivePluginTemplate } from './templates.ts';
import type {
  LivePlugin,
  LivePluginAction,
  LivePluginCondition,
  LivePluginCooldownScope,
  LivePluginOperator,
  LivePluginPermissions,
} from './types.ts';

/** Events a plugin can listen to. Kept explicit so the picker cannot offer a type the host never publishes. */
export const LIVE_PLUGIN_TRIGGERS: AutomationEventType[] = [
  'tiktok.chat',
  'tiktok.gift',
  'tiktok.like',
  'tiktok.follow',
  'tiktok.share',
  'tiktok.join',
  'tiktok.social',
  'tiktok.room_stats',
  'points.awarded',
  'plugin.emit',
];

const OPERATORS: LivePluginOperator[] = [
  'greater-or-equal',
  'greater-than',
  'less-or-equal',
  'less-than',
  'equals',
  'not-equals',
  'contains',
  'starts-with',
];

const METHODS = ['GET', 'POST', 'PUT', 'DELETE'] as const;
const MAX_SOURCE_LENGTH = 20_000;
const MAX_BODY_LENGTH = 20_000;

export function assertValidLivePlugin(value: unknown): asserts value is LivePlugin {
  normalizeLivePlugin(value);
}

export function isLivePlugin(value: unknown): value is LivePlugin {
  try {
    normalizeLivePlugin(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parses whatever crossed the bridge or came back from SQLite into a plugin the
 * engine can run. Unknown fields are dropped instead of trusted.
 */
export function normalizeLivePlugin(value: unknown): LivePlugin {
  const raw = asRecord(value, 'plugin');
  const id = text(raw.id, 'id');
  if (!/^[a-z0-9][a-z0-9._-]{1,127}$/i.test(id)) throw new Error(`Invalid plugin id: ${id}`);
  const name = text(raw.name, 'name').slice(0, 120);
  const trigger = raw.trigger;
  if (typeof trigger !== 'string' || !LIVE_PLUGIN_TRIGGERS.includes(trigger as AutomationEventType)) {
    throw new Error(`Unknown plugin trigger: ${String(trigger)}`);
  }
  const templateId = typeof raw.templateId === 'string' && findLivePluginTemplate(raw.templateId)
    ? raw.templateId
    : 'webhook';
  const action = normalizeAction(raw.action);

  return {
    schemaVersion: 1,
    id,
    name,
    enabled: raw.enabled === true,
    templateId,
    mode: action.kind === 'code' ? 'code' : 'template',
    trigger: trigger as AutomationEventType,
    condition: normalizeCondition(raw.condition),
    cooldownMs: clamp(number(raw.cooldownMs, 0), 0, 24 * 60 * 60 * 1000),
    cooldownScope: raw.cooldownScope === 'global' ? 'global' : 'user' as LivePluginCooldownScope,
    action,
  };
}

function normalizeAction(value: unknown): LivePluginAction {
  const raw = asRecord(value, 'action');
  if (raw.kind === 'fetch') {
    const method = METHODS.find((entry) => entry === String(raw.method).toUpperCase()) ?? 'POST';
    const url = text(raw.url, 'action.url').slice(0, 2_048);
    return {
      kind: 'fetch',
      method,
      url,
      headers: normalizeStringMap(raw.headers, 24),
      body: typeof raw.body === 'string' ? raw.body.slice(0, MAX_BODY_LENGTH) : '',
      timeoutMs: raw.timeoutMs === undefined ? undefined : clamp(number(raw.timeoutMs, 5_000), 100, 120_000),
      allowPrivateNetwork: raw.allowPrivateNetwork === true,
      emitResponseAs: typeof raw.emitResponseAs === 'string' && raw.emitResponseAs.trim()
        ? normalizeEmitType(raw.emitResponseAs)
        : undefined,
    };
  }

  if (raw.kind === 'emit') {
    return {
      kind: 'emit',
      type: normalizeEmitType(text(raw.type, 'action.type')),
      data: normalizeStringMap(raw.data, 24),
    };
  }

  if (raw.kind === 'code') {
    const source = typeof raw.source === 'string' ? raw.source : '';
    if (source.length > MAX_SOURCE_LENGTH) throw new Error('Plugin script is too long.');
    return { kind: 'code', source };
  }

  throw new Error(`Unknown plugin action: ${String(raw.kind)}`);
}

function normalizeCondition(value: unknown): LivePluginCondition | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = asRecord(value, 'condition');
  const path = typeof raw.path === 'string' ? raw.path.trim() : '';
  if (!path) return undefined;
  const operator = OPERATORS.find((entry) => entry === raw.operator) ?? 'equals';
  return {
    path: path.replace(/^\{\{\s*|\s*\}\}$/g, '').slice(0, 200),
    operator,
    value: typeof raw.value === 'string' ? raw.value.slice(0, 200) : '',
  };
}

/** Internal event names stay dotted lower-case so they cannot collide with TikTok types by accident. */
export function normalizeEmitType(value: string): string {
  const cleaned = value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
  if (!cleaned) throw new Error('An internal event needs a name.');
  return cleaned.slice(0, 64);
}

/**
 * Permissions are computed from the plugin, never typed by the user: the editor
 * shows exactly what the engine will allow.
 */
export function deriveLivePluginPermissions(plugin: LivePlugin): LivePluginPermissions {
  const network: string[] = [];
  const capabilities: string[] = [];
  let localNetwork = false;

  if (plugin.action.kind === 'fetch') {
    const host = hostFromUrlTemplate(plugin.action.url);
    if (host) network.push(host);
    localNetwork = plugin.action.allowPrivateNetwork === true;
    capabilities.push('http.request');
  }

  if (plugin.action.kind === 'emit') {
    const binding = CAPABILITY_BY_EMIT_TYPE[plugin.action.type];
    if (binding) capabilities.push(binding);
  }

  if (plugin.action.kind === 'code') {
    const source = plugin.action.source;
    if (/\bfetch\b/.test(source)) capabilities.push('http.request');
    if (/\bemit\b/.test(source)) capabilities.push('event.emit');
    for (const host of hostsInSource(source)) network.push(host);
  }

  return { network: unique(network), capabilities: unique(capabilities), localNetwork };
}

/** Well-known internal events the engine forwards to a host capability. */
export const CAPABILITY_BY_EMIT_TYPE: Record<string, string> = {
  'overlay.sound': 'audio.play',
  'tts.speak': 'tts.synthesize',
  'points.add': 'points.write',
};

/**
 * Reads the host out of a URL that may still contain `{{ }}` placeholders. A
 * templated host is refused: the allowlist has to be knowable before the event
 * arrives.
 */
export function hostFromUrlTemplate(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  const match = /^https?:\/\/([^/?#\s]+)/i.exec(trimmed);
  if (!match) return null;
  const host = match[1] ?? '';
  if (!host || host.includes('{{')) return null;
  return host.toLowerCase();
}

function hostsInSource(source: string): string[] {
  const hosts: string[] = [];
  const pattern = /https?:\/\/([a-z0-9.-]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const host = match[1];
    if (host) hosts.push(host.toLowerCase());
  }
  return hosts;
}

function normalizeStringMap(value: unknown, maxEntries: number): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries: Record<string, string> = {};
  let count = 0;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (count >= maxEntries) break;
    const cleanKey = key.trim().slice(0, 120);
    if (!cleanKey) continue;
    entries[cleanKey] = typeof entry === 'string' ? entry.slice(0, 2_048) : String(entry ?? '');
    count += 1;
  }
  return entries;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid ${label}: an object was expected.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid ${label}: text was expected.`);
  return value.trim();
}

function number(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function createLivePluginId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `plg-${Date.now().toString(36)}-${random}`;
}
