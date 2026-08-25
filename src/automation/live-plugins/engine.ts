import type { AutomationCapabilities } from '../capabilities.ts';
import type {
  AutomationEvent,
  AutomationEventType,
  JsonObject,
  JsonValue,
} from '../types.ts';
import {
  CAPABILITY_BY_EMIT_TYPE,
  deriveLivePluginPermissions,
  hostFromUrlTemplate,
  normalizeEmitType,
} from './schema.ts';
import type {
  LivePlugin,
  LivePluginCondition,
  LivePluginRun,
  LivePluginRunStatus,
} from './types.ts';

const MAX_RUNS = 60;
const MAX_EMIT_DEPTH = 3;

export interface LivePluginEngineOptions {
  capabilities: AutomationCapabilities;
  /** Publishes an internal event back onto the automation bus. */
  publish(event: AutomationEvent): void;
  /** Called once per execution, including skipped and failed ones. */
  onRun?(run: LivePluginRun): void;
  now?(): number;
}

/**
 * Runs live plugins. One event in, at most one action out: the filter and the
 * cooldown are checked here rather than being separate steps a user has to
 * wire up.
 */
export class LivePluginEngine {
  readonly #plugins = new Map<string, LivePlugin>();
  readonly #cooldowns = new Map<string, number>();
  readonly #runs: LivePluginRun[] = [];
  readonly #options: LivePluginEngineOptions;
  #runCounter = 0;

  constructor(options: LivePluginEngineOptions) {
    this.#options = options;
  }

  setAll(plugins: LivePlugin[]): void {
    this.#plugins.clear();
    for (const plugin of plugins) this.#plugins.set(plugin.id, plugin);
  }

  upsert(plugin: LivePlugin): void {
    this.#plugins.set(plugin.id, plugin);
    this.#options.capabilities.vm?.clearScope?.(scopeId(plugin));
  }

  remove(id: string): void {
    this.#plugins.delete(id);
    for (const key of [...this.#cooldowns.keys()]) {
      if (key.startsWith(`${id}:`)) this.#cooldowns.delete(key);
    }
  }

  list(): LivePlugin[] {
    return [...this.#plugins.values()];
  }

  recentRuns(limit = MAX_RUNS): LivePluginRun[] {
    return this.#runs.slice(0, Math.max(1, limit));
  }

  /** Bus entry point. Never throws: a broken plugin must not take the stream down. */
  handleEvent(event: AutomationEvent): void {
    const depth = emitDepth(event);
    if (depth >= MAX_EMIT_DEPTH) return;

    for (const plugin of this.#plugins.values()) {
      if (!plugin.enabled || plugin.trigger !== event.type) continue;
      void this.#execute(plugin, event, false).catch(() => undefined);
    }
  }

  /** Runs a plugin on demand from the editor, ignoring the cooldown. */
  async test(plugin: LivePlugin, event: AutomationEvent): Promise<LivePluginRun> {
    return this.#execute(plugin, event, true);
  }

  async #execute(plugin: LivePlugin, event: AutomationEvent, test: boolean): Promise<LivePluginRun> {
    const startedAt = this.#now();
    const logs: string[] = [];

    if (!test) {
      if (plugin.condition && !matchesCondition(plugin.condition, event)) {
        return this.#record(plugin, startedAt, 'skipped', 'filtro no cumplido', logs, test);
      }
      const cooldown = this.#checkCooldown(plugin, event, startedAt);
      if (cooldown !== null) {
        return this.#record(plugin, startedAt, 'skipped', `en espera · ${Math.ceil(cooldown / 1000)} s`, logs, test);
      }
    }

    try {
      const summary = plugin.action.kind === 'code'
        ? await this.#runCode(plugin, event, logs)
        : plugin.action.kind === 'fetch'
          ? await this.#runFetch(plugin, event, logs)
          : await this.#runEmit(plugin, event, logs);
      return this.#record(plugin, startedAt, 'ok', summary, logs, test);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.#record(plugin, startedAt, 'error', message, logs, test, message);
    }
  }

  async #runFetch(plugin: LivePlugin, event: AutomationEvent, logs: string[]): Promise<string> {
    if (plugin.action.kind !== 'fetch') throw new Error('Not a fetch plugin.');
    const http = this.#options.capabilities.http;
    if (!http) throw new Error('La capacidad HTTP no está disponible.');

    const permissions = deriveLivePluginPermissions(plugin);
    const declaredHost = hostFromUrlTemplate(plugin.action.url);
    if (!declaredHost) {
      throw new Error('La URL debe empezar por https:// con un dominio fijo (sin plantilla en el dominio).');
    }

    const url = renderTemplate(plugin.action.url, event);
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(plugin.action.headers)) {
      headers[key] = renderTemplate(value, event);
    }
    const method = plugin.action.method;
    const body = method === 'GET' ? undefined : renderTemplate(plugin.action.body, event);

    const started = this.#now();
    const response = await http.request({
      method,
      url,
      headers,
      body,
      timeoutMs: plugin.action.timeoutMs ?? 5_000,
      responseType: 'auto',
      allowedHosts: [declaredHost],
      allowPrivateNetwork: permissions.localNetwork,
    });
    const elapsed = this.#now() - started;
    logs.push(`${method} ${declaredHost} → ${response.status} (${elapsed} ms)`);

    if (plugin.action.emitResponseAs) {
      this.#emit(plugin, event, plugin.action.emitResponseAs, {
        status: response.status,
        ok: response.ok,
        body: response.body,
      });
      logs.push(`emit ${plugin.action.emitResponseAs}`);
    }

    if (!response.ok) throw new Error(`${response.status} ${statusText(response.status)}`);
    return `${response.status} OK · ${elapsed} ms`;
  }

  async #runEmit(plugin: LivePlugin, event: AutomationEvent, logs: string[]): Promise<string> {
    if (plugin.action.kind !== 'emit') throw new Error('Not an emit plugin.');
    const payload: JsonObject = {};
    for (const [key, value] of Object.entries(plugin.action.data)) {
      payload[key] = renderTemplate(value, event);
    }
    this.#emit(plugin, event, plugin.action.type, payload);
    const detail = await this.#applyCapabilityBinding(plugin.action.type, payload, logs);
    return detail ? `emit ${plugin.action.type} · ${detail}` : `emit ${plugin.action.type}`;
  }

  async #runCode(plugin: LivePlugin, event: AutomationEvent, logs: string[]): Promise<string> {
    if (plugin.action.kind !== 'code') throw new Error('Not a code plugin.');
    const vm = this.#options.capabilities.vm;
    if (!vm) throw new Error('napi-vm no está disponible.');

    const result = vm.evaluate(
      plugin.action.source,
      { event: event as JsonValue, inputs: {} },
      {
        scopeId: scopeId(plugin),
        log: (message) => {
          if (logs.length < 40) logs.push(message);
        },
      },
    );

    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      return 'script sin acciones';
    }

    const intent = result as JsonObject;
    const parts: string[] = [];

    for (const entry of asArray(intent.emit)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const record = entry as JsonObject;
      const type = typeof record.type === 'string' ? normalizeEmitType(record.type) : '';
      if (!type) continue;
      const data = (record.data && typeof record.data === 'object' && !Array.isArray(record.data)
        ? record.data
        : {}) as JsonObject;
      this.#emit(plugin, event, type, data);
      const detail = await this.#applyCapabilityBinding(type, data, logs);
      parts.push(detail ? `emit ${type} · ${detail}` : `emit ${type}`);
    }

    const request = intent.fetch;
    if (request && typeof request === 'object' && !Array.isArray(request)) {
      const summary = await this.#runScriptFetch(plugin, event, request as JsonObject, intent, logs);
      parts.push(summary);
    }

    for (const line of asArray(intent.log)) {
      if (typeof line === 'string' && logs.length < 40) logs.push(line);
    }

    return parts.length > 0 ? parts.join(' · ') : 'script sin acciones';
  }

  async #runScriptFetch(
    plugin: LivePlugin,
    event: AutomationEvent,
    request: JsonObject,
    intent: JsonObject,
    logs: string[],
  ): Promise<string> {
    const http = this.#options.capabilities.http;
    if (!http) throw new Error('La capacidad HTTP no está disponible.');
    const url = typeof request.url === 'string' ? request.url : '';
    const host = hostFromUrlTemplate(url);
    if (!host) throw new Error('fetch necesita una URL https:// con dominio fijo.');

    const allowed = deriveLivePluginPermissions(plugin).network;
    if (!allowed.includes(host)) {
      throw new Error(`El dominio ${host} no está declarado en el manifiesto del plugin.`);
    }

    const method = typeof request.method === 'string' ? request.method.toUpperCase() : 'POST';
    const headers: Record<string, string> = {};
    if (request.headers && typeof request.headers === 'object' && !Array.isArray(request.headers)) {
      for (const [key, value] of Object.entries(request.headers as JsonObject)) {
        headers[key] = typeof value === 'string' ? value : JSON.stringify(value ?? null);
      }
    }
    const body = request.body === undefined || request.body === null
      ? undefined
      : typeof request.body === 'string'
        ? request.body
        : JSON.stringify(request.body);

    const started = this.#now();
    const response = await http.request({
      method,
      url,
      headers,
      body: method === 'GET' ? undefined : body,
      timeoutMs: 5_000,
      responseType: 'auto',
      allowedHosts: [host],
    });
    const elapsed = this.#now() - started;
    logs.push(`${method} ${host} → ${response.status} (${elapsed} ms)`);

    const emitResponseAs = typeof intent.emitResponseAs === 'string' ? intent.emitResponseAs : '';
    if (emitResponseAs) {
      this.#emit(plugin, event, normalizeEmitType(emitResponseAs), {
        status: response.status,
        ok: response.ok,
        body: response.body,
      });
    }

    if (!response.ok) throw new Error(`${response.status} ${statusText(response.status)}`);
    return `fetch ${response.status} · ${elapsed} ms`;
  }

  /**
   * Sound, TTS, and points are emitted events with a well-known name; the host
   * is what turns them into capability calls.
   */
  async #applyCapabilityBinding(type: string, payload: JsonObject, logs: string[]): Promise<string> {
    const capabilities = this.#options.capabilities;

    if (type === 'overlay.sound') {
      const file = stringify(payload.file);
      if (!file) throw new Error('overlay.sound necesita un archivo.');
      if (!capabilities.audio) throw new Error('La capacidad de audio no está disponible.');
      const volume = Number(stringify(payload.volume));
      await capabilities.audio.playFile(file, {
        volume: Number.isFinite(volume) && volume > 0 ? volume : undefined,
        overlap: 'allow',
      });
      return file;
    }

    if (type === 'tts.speak') {
      const text = stringify(payload.text);
      if (!text) return '';
      if (!capabilities.tts) throw new Error('La capacidad de voz no está disponible.');
      const result = await capabilities.tts.synthesize(text, {
        voice: stringify(payload.voice) || 'M1',
        lang: stringify(payload.lang) || 'es',
        format: 'wav',
      });
      const path = typeof result.path === 'string' ? result.path : '';
      if (path && capabilities.audio) {
        await capabilities.audio.playFile(path, { overlap: 'allow' });
        logs.push(`tts → ${path}`);
      }
      return text.slice(0, 40);
    }

    if (type === 'points.add') {
      const uniqueId = stringify(payload.uniqueId);
      const delta = Number(stringify(payload.delta));
      if (!uniqueId) throw new Error('points.add necesita un uniqueId.');
      if (!Number.isFinite(delta) || delta === 0) throw new Error('points.add necesita un delta numérico.');
      if (!capabilities.points) throw new Error('La capacidad de puntos no está disponible.');
      await capabilities.points.adjust(uniqueId, delta);
      return `${uniqueId} ${delta > 0 ? '+' : ''}${delta}`;
    }

    return '';
  }

  #emit(plugin: LivePlugin, source: AutomationEvent, type: string, payload: JsonObject): void {
    const event: AutomationEvent = {
      id: `plg-${(this.#runCounter += 1)}-${this.#now().toString(36)}`,
      type: 'plugin.emit',
      timestamp: this.#now(),
      connectionId: source.connectionId,
      creator: source.creator,
      user: source.user,
      sourceEventId: source.id,
      data: {
        emitType: type,
        pluginId: plugin.id,
        depth: emitDepth(source) + 1,
        payload,
      },
    };
    this.#options.publish(event);
  }

  #checkCooldown(plugin: LivePlugin, event: AutomationEvent, now: number): number | null {
    if (plugin.cooldownMs <= 0) return null;
    const scope = plugin.cooldownScope === 'user' ? event.user?.uniqueId ?? 'anon' : 'global';
    const key = `${plugin.id}:${scope}`;
    const previous = this.#cooldowns.get(key);
    if (previous !== undefined && now - previous < plugin.cooldownMs) {
      return plugin.cooldownMs - (now - previous);
    }
    this.#cooldowns.set(key, now);
    return null;
  }

  #record(
    plugin: LivePlugin,
    startedAt: number,
    status: LivePluginRunStatus,
    summary: string,
    logs: string[],
    test: boolean,
    error?: string,
  ): LivePluginRun {
    const run: LivePluginRun = {
      id: `run-${(this.#runCounter += 1)}-${startedAt.toString(36)}`,
      pluginId: plugin.id,
      pluginName: plugin.name,
      at: startedAt,
      status,
      summary,
      durationMs: Math.max(0, this.#now() - startedAt),
      test,
      logs: logs.slice(0, 40),
      error,
    };
    this.#runs.unshift(run);
    if (this.#runs.length > MAX_RUNS) this.#runs.length = MAX_RUNS;
    this.#options.onRun?.(run);
    return run;
  }

  #now(): number {
    return this.#options.now?.() ?? Date.now();
  }
}

export function renderTemplate(template: string, event: AutomationEvent): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, rawPath: string) => {
    const value = readEventPath(event, rawPath.trim());
    return stringify(value);
  });
}

export function readEventPath(event: AutomationEvent, path: string): JsonValue | undefined {
  const root: JsonObject = {
    event: event as JsonValue,
    data: event.data,
    user: event.user ?? null,
  };
  const parts = path.split('.').map((part) => part.trim()).filter(Boolean);
  let current: JsonValue | undefined = root;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = Array.isArray(current) ? current[Number(part)] : (current as JsonObject)[part];
  }
  return current;
}

export function matchesCondition(condition: LivePluginCondition, event: AutomationEvent): boolean {
  const left = readEventPath(event, condition.path);
  const right = condition.value;
  const leftNumber = Number(stringify(left));
  const rightNumber = Number(right);
  const numeric = Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && right.trim() !== '';

  switch (condition.operator) {
    case 'greater-or-equal':
      return numeric && leftNumber >= rightNumber;
    case 'greater-than':
      return numeric && leftNumber > rightNumber;
    case 'less-or-equal':
      return numeric && leftNumber <= rightNumber;
    case 'less-than':
      return numeric && leftNumber < rightNumber;
    case 'equals':
      return numeric ? leftNumber === rightNumber : stringify(left) === right;
    case 'not-equals':
      return numeric ? leftNumber !== rightNumber : stringify(left) !== right;
    case 'contains':
      return stringify(left).toLowerCase().includes(right.toLowerCase());
    case 'starts-with':
      return stringify(left).toLowerCase().startsWith(right.toLowerCase());
    default:
      return false;
  }
}

/** Used by the editor's test button when no live event has been captured yet. */
export function sampleEventFor(type: AutomationEventType): AutomationEvent {
  const base: AutomationEvent = {
    id: 'sample-event',
    type,
    timestamp: Date.now(),
    user: { uniqueId: 'usuario_demo', nickname: 'Usuario Demo', userId: '0' },
    creator: { uniqueId: 'creador_demo', roomId: '0000000000' },
    data: {},
  };

  switch (type) {
    case 'tiktok.gift':
      return {
        ...base,
        data: {
          giftId: '5655',
          giftName: 'Rosa',
          diamondCount: 1,
          repeatCount: 1,
          comboCount: 1,
          groupId: '0',
          repeatEnd: true,
          streakable: false,
        },
      };
    case 'tiktok.chat':
      return { ...base, data: { comment: 'hola desde la prueba', method: 'chat', isHistory: false } };
    case 'tiktok.like':
      return { ...base, data: { count: 5, total: 120, method: 'like' } };
    case 'points.awarded':
      return {
        ...base,
        data: {
          uniqueId: 'usuario_demo',
          delta: 10,
          totalPoints: 120,
          level: 2,
          currencyName: 'Points',
          reason: 'chat',
        },
      };
    case 'plugin.emit':
      return { ...base, data: { emitType: 'overlay.alert', pluginId: 'demo', depth: 0, payload: {} } };
    default:
      return base;
  }
}

function asArray(value: JsonValue | undefined): JsonValue[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function emitDepth(event: AutomationEvent): number {
  if (event.type !== 'plugin.emit') return 0;
  const data = event.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 0;
  const depth = (data as JsonObject).depth;
  return typeof depth === 'number' && Number.isFinite(depth) ? depth : 0;
}

function stringify(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function scopeId(plugin: LivePlugin): string {
  return `live-plugin:${plugin.id}`;
}

function statusText(status: number): string {
  if (status === 429) return 'Too Many Requests';
  if (status === 404) return 'Not Found';
  if (status === 401 || status === 403) return 'Forbidden';
  if (status >= 500) return 'Server Error';
  return 'Error';
}
