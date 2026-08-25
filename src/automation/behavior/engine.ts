import type { AutomationCapabilities } from '../capabilities.ts';
import type { AutomationEvent, AutomationEventType, JsonObject, JsonValue } from '../types.ts';
import { findActionType } from './catalog.ts';
import { hostFromUrlTemplate, deriveActionPermissions, normalizeEmitType, readString, readStringMap } from './schema.ts';
import type {
  BehaviorRun,
  EventFilter,
  LiveAction,
  LiveEvent,
  RunStatus,
} from './types.ts';

const MAX_RUNS = 60;
const MAX_EMIT_DEPTH = 3;

export interface BehaviorEngineOptions {
  capabilities: AutomationCapabilities;
  publish(event: AutomationEvent): void;
  onRun?(run: BehaviorRun): void;
  now?(): number;
}

/**
 * Runs behavior. An event matches by trigger, every filter must pass, and then
 * its actions run in order — or one of them at random. Nothing here knows about
 * graphs: the shape of an event record is the shape of the execution.
 */
export class BehaviorEngine {
  readonly #actions = new Map<string, LiveAction>();
  readonly #events = new Map<string, LiveEvent>();
  readonly #cooldowns = new Map<string, number>();
  readonly #runs: BehaviorRun[] = [];
  readonly #options: BehaviorEngineOptions;
  /** Plugin id → usable right now (installed, enabled and dependency present). */
  #pluginReady = new Map<string, boolean>();
  #counter = 0;

  constructor(options: BehaviorEngineOptions) {
    this.#options = options;
  }

  setActions(actions: LiveAction[]): void {
    this.#actions.clear();
    for (const action of actions) this.#actions.set(action.id, action);
  }

  setEvents(events: LiveEvent[]): void {
    this.#events.clear();
    for (const event of events) this.#events.set(event.id, event);
  }

  setPluginReadiness(states: Array<{ id: string; ready: boolean }>): void {
    this.#pluginReady = new Map(states.map((state) => [state.id, state.ready]));
  }

  upsertAction(action: LiveAction): void {
    this.#actions.set(action.id, action);
    this.#options.capabilities.vm?.clearScope?.(`behavior:${action.id}`);
  }

  removeAction(id: string): void {
    this.#actions.delete(id);
    for (const event of this.#events.values()) {
      event.actionIds = event.actionIds.filter((entry) => entry !== id);
    }
  }

  upsertEvent(event: LiveEvent): void {
    this.#events.set(event.id, event);
  }

  removeEvent(id: string): void {
    this.#events.delete(id);
    for (const key of [...this.#cooldowns.keys()]) {
      if (key.startsWith(`${id}:`)) this.#cooldowns.delete(key);
    }
  }

  recentRuns(limit = MAX_RUNS): BehaviorRun[] {
    return this.#runs.slice(0, Math.max(1, limit));
  }

  /** Bus entry point. Never throws: a broken action must not take the stream down. */
  handleEvent(event: AutomationEvent): void {
    if (emitDepth(event) >= MAX_EMIT_DEPTH) return;

    for (const record of this.#events.values()) {
      if (!record.enabled || record.trigger !== event.type) continue;
      void this.#runEvent(record, event).catch(() => undefined);
    }
  }

  /** Runs one action on demand from the editor, ignoring filters and cooldown. */
  async testAction(action: LiveAction, event: AutomationEvent): Promise<BehaviorRun> {
    return this.#runAction(action, event, undefined, true);
  }

  /** Runs a whole event on demand, filters included, so the editor can show why it was skipped. */
  async testEvent(record: LiveEvent, event: AutomationEvent): Promise<BehaviorRun[]> {
    const failing = record.filters.find((filter) => !matchesFilter(filter, event));
    if (failing) {
      return [this.#record(
        { name: record.name, id: undefined },
        record,
        this.#now(),
        'skipped',
        `filtro no cumplido · ${failing.path}`,
        [],
        true,
      )];
    }
    return this.#runActionsOf(record, event, true);
  }

  async #runEvent(record: LiveEvent, event: AutomationEvent): Promise<void> {
    for (const filter of record.filters) {
      if (!matchesFilter(filter, event)) return;
    }

    const now = this.#now();
    if (record.cooldownMs > 0) {
      const scope = record.cooldownScope === 'user' ? event.user?.uniqueId ?? 'anon' : 'global';
      const key = `${record.id}:${scope}`;
      const previous = this.#cooldowns.get(key);
      if (previous !== undefined && now - previous < record.cooldownMs) return;
      this.#cooldowns.set(key, now);
    }

    await this.#runActionsOf(record, event, false);
  }

  async #runActionsOf(record: LiveEvent, event: AutomationEvent, test: boolean): Promise<BehaviorRun[]> {
    const actions = record.actionIds
      .map((id) => this.#actions.get(id))
      .filter((action): action is LiveAction => Boolean(action) && action!.enabled);

    if (actions.length === 0) {
      return [this.#record({ name: '—', id: undefined }, record, this.#now(), 'skipped', 'sin acciones activas', [], test)];
    }

    const selected = record.runMode === 'random'
      ? [actions[Math.floor(Math.random() * actions.length)] as LiveAction]
      : actions;

    const runs: BehaviorRun[] = [];
    for (const action of selected) {
      runs.push(await this.#runAction(action, event, record, test));
    }
    return runs;
  }

  async #runAction(
    action: LiveAction,
    event: AutomationEvent,
    origin: LiveEvent | undefined,
    test: boolean,
  ): Promise<BehaviorRun> {
    const startedAt = this.#now();
    const logs: string[] = [];

    try {
      const type = findActionType(action.typeId);
      if (!type) throw new Error(`El tipo de acción ${action.typeId} ya no existe.`);
      if (type.source.kind === 'plugin' && this.#pluginReady.get(type.source.pluginId) !== true) {
        throw new Error(`El plugin ${type.source.pluginId} no está instalado o está desactivado.`);
      }

      const summary = await this.#execute(action, event, logs);
      return this.#record(action, origin, startedAt, 'ok', summary, logs, test);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.#record(action, origin, startedAt, 'error', message, logs, test, message);
    }
  }

  async #execute(action: LiveAction, event: AutomationEvent, logs: string[]): Promise<string> {
    switch (action.typeId) {
      case 'core.fetch':
        return this.#fetch(action, event, logs);
      case 'core.emit':
        return this.#emitAction(action, event);
      case 'core.points':
        return this.#points(action, event);
      case 'core.delay': {
        const ms = clamp(Number(readString(action.config.ms)) || 0, 0, 60_000);
        await sleep(ms);
        return `espera ${ms} ms`;
      }
      case 'core.log': {
        const message = renderTemplate(readString(action.config.message), event);
        logs.push(message);
        return message.slice(0, 80);
      }
      case 'core.code':
        return this.#code(action, event, logs);
      case 'audio.play':
        return this.#audioPlay(action, event, logs);
      case 'audio.stop': {
        const audio = this.#options.capabilities.audio;
        if (!audio) throw new Error('La capacidad de audio no está disponible.');
        const stopAll = (audio as { stopAll?: () => void }).stopAll;
        if (typeof stopAll === 'function') stopAll.call(audio);
        return 'audio detenido';
      }
      case 'tts.speak':
        return this.#speak(action, event, logs);
      default:
        throw new Error(`El tipo de acción ${action.typeId} no tiene implementación.`);
    }
  }

  async #fetch(action: LiveAction, event: AutomationEvent, logs: string[]): Promise<string> {
    const http = this.#options.capabilities.http;
    if (!http) throw new Error('La capacidad HTTP no está disponible.');

    const configuredUrl = readString(action.config.url);
    const host = hostFromUrlTemplate(configuredUrl);
    if (!host) throw new Error('La URL debe empezar por https:// con un dominio fijo (sin plantilla en el dominio).');

    const method = (readString(action.config.method) || 'POST').toUpperCase();
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(readStringMap(action.config.headers))) {
      headers[key] = renderTemplate(value, event);
    }

    const started = this.#now();
    const response = await http.request({
      method,
      url: renderTemplate(configuredUrl, event),
      headers,
      body: method === 'GET' ? undefined : renderTemplate(readString(action.config.body), event),
      timeoutMs: clamp(Number(readString(action.config.timeoutMs)) || 5_000, 100, 120_000),
      responseType: 'auto',
      allowedHosts: [host],
      allowPrivateNetwork: deriveActionPermissions(action).localNetwork,
    });
    const elapsed = this.#now() - started;
    logs.push(`${method} ${host} → ${response.status} (${elapsed} ms)`);

    const emitAs = readString(action.config.emitResponseAs).trim();
    if (emitAs) {
      this.#publishInternal(event, normalizeEmitType(emitAs), {
        status: response.status,
        ok: response.ok,
        body: response.body,
      });
    }

    if (!response.ok) throw new Error(`${response.status} ${statusText(response.status)}`);
    return `${response.status} OK · ${elapsed} ms`;
  }

  #emitAction(action: LiveAction, event: AutomationEvent): string {
    const type = normalizeEmitType(readString(action.config.type));
    const payload: JsonObject = {};
    for (const [key, value] of Object.entries(readStringMap(action.config.data))) {
      payload[key] = renderTemplate(value, event);
    }
    this.#publishInternal(event, type, payload);
    return `emit ${type}`;
  }

  async #points(action: LiveAction, event: AutomationEvent): Promise<string> {
    const points = this.#options.capabilities.points;
    if (!points) throw new Error('La capacidad de puntos no está disponible.');
    const uniqueId = renderTemplate(readString(action.config.uniqueId), event).trim();
    const delta = Number(readString(action.config.delta));
    if (!uniqueId) throw new Error('La acción de puntos necesita un espectador.');
    if (!Number.isFinite(delta) || delta === 0) throw new Error('La acción de puntos necesita un número distinto de cero.');
    await points.adjust(uniqueId, delta);
    return `${uniqueId} ${delta > 0 ? '+' : ''}${delta}`;
  }

  async #audioPlay(action: LiveAction, event: AutomationEvent, logs: string[]): Promise<string> {
    const audio = this.#options.capabilities.audio;
    if (!audio) throw new Error('La capacidad de audio no está disponible.');
    const file = renderTemplate(readString(action.config.file), event).trim();
    if (!file) throw new Error('Falta el archivo de sonido.');
    const volume = Number(readString(action.config.volume));
    const overlapValue = readString(action.config.overlap);
    const overlap = overlapValue === 'restart' || overlapValue === 'drop' ? overlapValue : 'allow';
    await audio.playFile(file, {
      volume: Number.isFinite(volume) && volume > 0 ? volume : undefined,
      overlap,
    });
    logs.push(`audio · ${file}`);
    return file.split('/').pop() ?? file;
  }

  async #speak(action: LiveAction, event: AutomationEvent, logs: string[]): Promise<string> {
    const tts = this.#options.capabilities.tts;
    if (!tts) throw new Error('La capacidad de voz no está disponible.');
    const text = renderTemplate(readString(action.config.text), event).trim();
    if (!text) return 'sin texto';
    const result = await tts.synthesize(text, {
      voice: readString(action.config.voice) || 'M1',
      lang: readString(action.config.lang) || 'es',
      format: 'wav',
    });
    const path = typeof result.path === 'string' ? result.path : '';
    if (path && this.#options.capabilities.audio) {
      await this.#options.capabilities.audio.playFile(path, { overlap: 'allow' });
      logs.push(`tts → ${path}`);
    }
    return text.slice(0, 60);
  }

  /**
   * Code actions run in the synchronous napi-vm session, which only exchanges
   * JSON, so the script returns what should happen and the host performs it
   * against the same capabilities the other action types use.
   */
  async #code(action: LiveAction, event: AutomationEvent, logs: string[]): Promise<string> {
    const vm = this.#options.capabilities.vm;
    if (!vm) throw new Error('napi-vm no está disponible.');

    const result = vm.evaluate(
      readString(action.config.source),
      { event: event as JsonValue, inputs: {} },
      {
        scopeId: `behavior:${action.id}`,
        log: (message) => {
          if (logs.length < 40) logs.push(message);
        },
      },
    );

    if (!result || typeof result !== 'object' || Array.isArray(result)) return 'script sin acciones';
    const intent = result as JsonObject;
    const parts: string[] = [];

    for (const entry of asArray(intent.emit)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const record = entry as JsonObject;
      const type = typeof record.type === 'string' ? normalizeEmitType(record.type) : '';
      if (!type) continue;
      const data = record.data && typeof record.data === 'object' && !Array.isArray(record.data)
        ? record.data as JsonObject
        : {};
      this.#publishInternal(event, type, data);
      parts.push(`emit ${type}`);
    }

    const request = intent.fetch;
    if (request && typeof request === 'object' && !Array.isArray(request)) {
      parts.push(await this.#codeFetch(action, event, request as JsonObject, intent, logs));
    }

    for (const line of asArray(intent.log)) {
      if (typeof line === 'string' && logs.length < 40) logs.push(line);
    }

    return parts.length > 0 ? parts.join(' · ') : 'script sin acciones';
  }

  async #codeFetch(
    action: LiveAction,
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

    const allowed = deriveActionPermissions(action).network;
    if (!allowed.includes(host)) {
      throw new Error(`El dominio ${host} no aparece en el código, así que no está permitido.`);
    }

    const method = typeof request.method === 'string' ? request.method.toUpperCase() : 'POST';
    const headers: Record<string, string> = {};
    if (request.headers && typeof request.headers === 'object' && !Array.isArray(request.headers)) {
      for (const [key, value] of Object.entries(request.headers as JsonObject)) {
        headers[key] = readString(value);
      }
    }
    const body = request.body === undefined || request.body === null
      ? undefined
      : typeof request.body === 'string' ? request.body : JSON.stringify(request.body);

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

    const emitAs = typeof intent.emitResponseAs === 'string' ? intent.emitResponseAs : '';
    if (emitAs) {
      this.#publishInternal(event, normalizeEmitType(emitAs), {
        status: response.status,
        ok: response.ok,
        body: response.body,
      });
    }

    if (!response.ok) throw new Error(`${response.status} ${statusText(response.status)}`);
    return `fetch ${response.status} · ${elapsed} ms`;
  }

  #publishInternal(source: AutomationEvent, type: string, payload: JsonObject): void {
    this.#options.publish({
      id: `emt-${(this.#counter += 1)}-${this.#now().toString(36)}`,
      type: 'plugin.emit',
      timestamp: this.#now(),
      connectionId: source.connectionId,
      creator: source.creator,
      user: source.user,
      sourceEventId: source.id,
      data: { emitType: type, depth: emitDepth(source) + 1, payload },
    });
  }

  #record(
    action: { name: string; id?: string },
    origin: LiveEvent | undefined,
    startedAt: number,
    status: RunStatus,
    summary: string,
    logs: string[],
    test: boolean,
    error?: string,
  ): BehaviorRun {
    const run: BehaviorRun = {
      id: `run-${(this.#counter += 1)}-${startedAt.toString(36)}`,
      at: startedAt,
      status,
      eventId: origin?.id,
      eventName: origin?.name,
      actionId: action.id,
      actionName: action.name,
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
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, rawPath: string) =>
    readString(readEventPath(event, rawPath.trim())));
}

export function readEventPath(event: AutomationEvent, path: string): JsonValue | undefined {
  const root: JsonObject = { event: event as JsonValue, data: event.data, user: event.user ?? null };
  let current: JsonValue | undefined = root;
  for (const part of path.split('.').map((entry) => entry.trim()).filter(Boolean)) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = Array.isArray(current) ? current[Number(part)] : (current as JsonObject)[part];
  }
  return current;
}

/** Every filter of an event is an AND; the "or" lives inside `in`. */
export function matchesFilter(filter: EventFilter, event: AutomationEvent): boolean {
  const raw = readEventPath(event, filter.path);
  const left = readString(raw);
  const leftNumber = Number(left);
  const rightNumber = Number(filter.value);
  const numeric = Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && filter.value.trim() !== '';

  switch (filter.operator) {
    case 'gte':
      return numeric && leftNumber >= rightNumber;
    case 'gt':
      return numeric && leftNumber > rightNumber;
    case 'lte':
      return numeric && leftNumber <= rightNumber;
    case 'lt':
      return numeric && leftNumber < rightNumber;
    case 'eq':
      return numeric ? leftNumber === rightNumber : left === filter.value;
    case 'neq':
      return numeric ? leftNumber !== rightNumber : left !== filter.value;
    case 'contains':
      return left.toLowerCase().includes(filter.value.toLowerCase());
    case 'starts-with':
      return left.toLowerCase().startsWith(filter.value.toLowerCase());
    case 'in':
      return (filter.values ?? []).some((entry) => entry.trim().toLowerCase() === left.trim().toLowerCase());
    case 'is-true':
      return raw === true || left === 'true' || left === '1';
    case 'is-false':
      return raw === false || left === 'false' || left === '0' || left === '';
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
        data: { uniqueId: 'usuario_demo', delta: 10, totalPoints: 120, level: 2, currencyName: 'Points', reason: 'chat' },
      };
    case 'plugin.emit':
      return { ...base, data: { emitType: 'overlay.alert', depth: 0, payload: {} } };
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function statusText(status: number): string {
  if (status === 429) return 'Too Many Requests';
  if (status === 404) return 'Not Found';
  if (status === 401 || status === 403) return 'Forbidden';
  if (status >= 500) return 'Server Error';
  return 'Error';
}
