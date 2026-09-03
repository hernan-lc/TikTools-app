import type { AutomationCapabilities } from '../capabilities.ts';
import type { AutomationEvent, JsonObject, JsonValue } from '../types.ts';
import { ActionRegistry, type ActionExecutionContext } from './action-registry.ts';
import { BUILTIN_ACTION_TYPES, PLUGIN_ACTION_TYPES } from './catalog.ts';
import { deriveActionPermissions, hostFromUrlTemplate, normalizeEmitType, readString, readStringMap } from './schema.ts';
import { renderTemplate } from './templates.ts';

/** Registers reviewed host implementations. The registry is the only runtime lookup. */
export function createBuiltInActionRegistry(): ActionRegistry {
  const registry = new ActionRegistry();
  for (const definition of [...BUILTIN_ACTION_TYPES, ...PLUGIN_ACTION_TYPES]) {
    registry.register({ definition, execute: (context) => executeBuiltIn(context) });
  }
  return registry;
}

async function executeBuiltIn(context: ActionExecutionContext): Promise<{ summary: string }> {
  const { action, event, capabilities, log, publish } = context;
  switch (action.typeId) {
    case 'core.fetch':
      return { summary: await fetchAction(action.config, event, capabilities, log, publish) };
    case 'core.emit':
      return { summary: emitAction(action.config, event, publish) };
    case 'core.points':
      return { summary: await pointsAction(action.config, event, capabilities) };
    case 'core.delay': {
      const ms = clamp(Number(readString(action.config.ms)) || 0, 0, 60_000);
      await sleep(ms);
      return { summary: `espera ${ms} ms` };
    }
    case 'core.log': {
      const message = renderTemplate(readString(action.config.message), event);
      log(message);
      return { summary: message.slice(0, 80) };
    }
    case 'core.code':
      return { summary: await codeAction(action.id, action.config, event, capabilities, log, publish) };
    case 'audio.play':
      return { summary: await audioPlay(action.config, event, capabilities, log) };
    case 'audio.stop': {
      const audio = capabilities.audio;
      if (!audio) throw new Error('La capacidad de audio no está disponible.');
      const stopAll = (audio as { stopAll?: () => void }).stopAll;
      if (typeof stopAll === 'function') stopAll.call(audio);
      return { summary: 'audio detenido' };
    }
    default:
      throw new Error(`El tipo de acción ${action.typeId} no tiene implementación.`);
  }
}

async function fetchAction(config: JsonObject, event: AutomationEvent, capabilities: AutomationCapabilities, log: ActionExecutionContext['log'], publish: ActionExecutionContext['publish']): Promise<string> {
  const http = capabilities.http;
  if (!http) throw new Error('La capacidad HTTP no está disponible.');
  const configuredUrl = readString(config.url);
  const host = hostFromUrlTemplate(configuredUrl);
  if (!host) throw new Error('La URL debe empezar por https:// con un dominio fijo (sin plantilla en el dominio).');
  const method = (readString(config.method) || 'POST').toUpperCase();
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(readStringMap(config.headers))) headers[key] = renderTemplate(value, event);
  const bodyText = method === 'GET' ? undefined : renderTemplate(readString(config.body), event);
  const contentType = Object.entries(headers).find(([key]) => key.toLowerCase() === 'content-type')?.[1] ?? '';
  const body = contentType.toLowerCase().includes('application/json') && bodyText?.trim()
    ? JSON.stringify(parseJsonBody(bodyText))
    : bodyText;
  const started = Date.now();
  const response = await http.request({
    method,
    url: renderTemplate(configuredUrl, event),
    headers,
    body,
    timeoutMs: clamp(Number(readString(config.timeoutMs)) || 5_000, 100, 120_000),
    responseType: 'auto',
    allowedHosts: [host],
    allowPrivateNetwork: deriveActionPermissions({ typeId: 'core.fetch', config } as never).localNetwork,
  });
  const elapsed = Date.now() - started;
  log(`${method} ${host} → ${response.status} (${elapsed} ms)`);
  const emitAs = readString(config.emitResponseAs).trim();
  if (emitAs) publishInternal(publish, event, normalizeEmitType(emitAs), { status: response.status, ok: response.ok, body: response.body });
  if (!response.ok) throw new Error(`${response.status} ${statusText(response.status)}`);
  return `${response.status} OK · ${elapsed} ms`;
}

function emitAction(config: JsonObject, event: AutomationEvent, publish: ActionExecutionContext['publish']): string {
  const type = normalizeEmitType(readString(config.type));
  const payload: JsonObject = {};
  for (const [key, value] of Object.entries(readStringMap(config.data))) payload[key] = renderTemplate(value, event);
  publishInternal(publish, event, type, payload);
  return `emit ${type}`;
}

async function pointsAction(config: JsonObject, event: AutomationEvent, capabilities: AutomationCapabilities): Promise<string> {
  const points = capabilities.points;
  if (!points) throw new Error('La capacidad de puntos no está disponible.');
  const uniqueId = renderTemplate(readString(config.uniqueId), event).trim();
  const delta = Number(readString(config.delta));
  if (!uniqueId) throw new Error('La acción de puntos necesita un espectador.');
  if (!Number.isFinite(delta) || delta === 0) throw new Error('La acción de puntos necesita un número distinto de cero.');
  await points.adjust(uniqueId, delta);
  return `${uniqueId} ${delta > 0 ? '+' : ''}${delta}`;
}

async function audioPlay(config: JsonObject, event: AutomationEvent, capabilities: AutomationCapabilities, log: ActionExecutionContext['log']): Promise<string> {
  const audio = capabilities.audio;
  if (!audio) throw new Error('La capacidad de audio no está disponible.');
  const file = renderTemplate(readString(config.file), event).trim();
  if (!file) throw new Error('Falta el archivo de sonido.');
  const volume = Number(readString(config.volume));
  const overlapValue = readString(config.overlap);
  const overlap = overlapValue === 'restart' || overlapValue === 'drop' ? overlapValue : 'allow';
  await audio.playFile(file, { volume: Number.isFinite(volume) && volume > 0 ? volume : undefined, overlap });
  log(`audio · ${file}`);
  return file.split('/').pop() ?? file;
}

async function codeAction(actionId: string, config: JsonObject, event: AutomationEvent, capabilities: AutomationCapabilities, log: ActionExecutionContext['log'], publish: ActionExecutionContext['publish']): Promise<string> {
  const vm = capabilities.vm;
  if (!vm) throw new Error('napi-vm no está disponible.');
  const result = vm.evaluate(readString(config.source), { event: event as JsonValue, inputs: {} }, {
    scopeId: `behavior:${actionId}`,
    log,
  });
  if (!result || typeof result !== 'object' || Array.isArray(result)) return 'script sin acciones';
  const intent = result as JsonObject;
  const parts: string[] = [];
  for (const entry of asArray(intent.emit)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const record = entry as JsonObject;
    const type = typeof record.type === 'string' ? normalizeEmitType(record.type) : '';
    if (!type) continue;
    const data = record.data && typeof record.data === 'object' && !Array.isArray(record.data) ? record.data as JsonObject : {};
    publishInternal(publish, event, type, data);
    parts.push(`emit ${type}`);
  }
  const request = intent.fetch;
  if (request && typeof request === 'object' && !Array.isArray(request)) parts.push(await codeFetch(config, event, request as JsonObject, intent, capabilities, log, publish));
  for (const line of asArray(intent.log)) if (typeof line === 'string') log(line);
  return parts.length > 0 ? parts.join(' · ') : 'script sin acciones';
}

async function codeFetch(actionConfig: JsonObject, event: AutomationEvent, request: JsonObject, intent: JsonObject, capabilities: AutomationCapabilities, log: ActionExecutionContext['log'], publish: ActionExecutionContext['publish']): Promise<string> {
  const http = capabilities.http;
  if (!http) throw new Error('La capacidad HTTP no está disponible.');
  const url = typeof request.url === 'string' ? request.url : '';
  const host = hostFromUrlTemplate(url);
  if (!host) throw new Error('fetch necesita una URL https:// con dominio fijo.');
  if (!deriveActionPermissions({ typeId: 'core.code', config: actionConfig } as never).network.includes(host)) throw new Error(`El dominio ${host} no aparece en el código, así que no está permitido.`);
  const method = typeof request.method === 'string' ? request.method.toUpperCase() : 'POST';
  const headers: Record<string, string> = {};
  if (request.headers && typeof request.headers === 'object' && !Array.isArray(request.headers)) for (const [key, value] of Object.entries(request.headers as JsonObject)) headers[key] = readString(value);
  const body = request.body === undefined || request.body === null ? undefined : typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
  const started = Date.now();
  const response = await http.request({ method, url, headers, body: method === 'GET' ? undefined : body, timeoutMs: 5_000, responseType: 'auto', allowedHosts: [host] });
  const elapsed = Date.now() - started;
  log(`${method} ${host} → ${response.status} (${elapsed} ms)`);
  const emitAs = typeof intent.emitResponseAs === 'string' ? intent.emitResponseAs : '';
  if (emitAs) publishInternal(publish, event, normalizeEmitType(emitAs), { status: response.status, ok: response.ok, body: response.body });
  if (!response.ok) throw new Error(`${response.status} ${statusText(response.status)}`);
  return `fetch ${response.status} · ${elapsed} ms`;
}

function publishInternal(publish: ActionExecutionContext['publish'], source: AutomationEvent, type: string, payload: JsonObject): void {
  publish({ id: `emt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, type: 'plugin.emit', timestamp: Date.now(), connectionId: source.connectionId, creator: source.creator, user: source.user, sourceEventId: source.id, data: { emitType: type, depth: emitDepth(source) + 1, payload } });
}

function parseJsonBody(value: string): JsonValue {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isJsonValue(parsed)) throw new Error('not JSON-safe');
    return parsed;
  } catch {
    throw new Error('El cuerpo JSON no es válido después de aplicar la plantilla.');
  }
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  return Boolean(value) && typeof value === 'object' && Object.values(value as Record<string, unknown>).every((entry) => entry === undefined || isJsonValue(entry));
}

function asArray(value: JsonValue | undefined): JsonValue[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function emitDepth(event: AutomationEvent): number {
  if (event.type !== 'plugin.emit' || !event.data || typeof event.data !== 'object' || Array.isArray(event.data)) return 0;
  const depth = (event.data as JsonObject).depth;
  return typeof depth === 'number' && Number.isFinite(depth) ? depth : 0;
}

function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
function statusText(status: number): string { return status >= 500 ? 'server error' : status >= 400 ? 'request error' : 'request failed'; }
