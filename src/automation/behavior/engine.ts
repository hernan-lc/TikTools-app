import type { AutomationCapabilities } from '../capabilities.ts';
import type { AutomationEvent, AutomationEventType, JsonValue } from '../types.ts';
import { ActionRegistry } from './action-registry.ts';
import { createBuiltInActionRegistry } from './builtins.ts';
import { resolveActionConfig } from './action-config.ts';
import { readEventPath, renderTemplate } from './templates.ts';
import type { BehaviorRun, EventFilter, LiveAction, LiveEvent, RunStatus } from './types.ts';

export { readEventPath, renderTemplate } from './templates.ts';

const MAX_RUNS = 60;
const MAX_EMIT_DEPTH = 3;

export interface BehaviorEngineOptions {
  capabilities: AutomationCapabilities;
  actionRegistry?: ActionRegistry;
  publish(event: AutomationEvent): void;
  onRun?(run: BehaviorRun): void;
  now?(): number;
}

/** Runs matching/cooldown logic; registered action modules own execution. */
export class BehaviorEngine {
  readonly #actions = new Map<string, LiveAction>();
  readonly #events = new Map<string, LiveEvent>();
  readonly #cooldowns = new Map<string, number>();
  readonly #runs: BehaviorRun[] = [];
  readonly #options: BehaviorEngineOptions;
  readonly #actionRegistry: ActionRegistry;
  #pluginReady = new Map<string, boolean>();
  #counter = 0;

  constructor(options: BehaviorEngineOptions) {
    this.#options = options;
    this.#actionRegistry = options.actionRegistry ?? createBuiltInActionRegistry();
  }

  setActions(actions: LiveAction[]): void { this.#actions.clear(); for (const action of actions) this.#actions.set(action.id, action); }
  setEvents(events: LiveEvent[]): void { this.#events.clear(); for (const event of events) this.#events.set(event.id, event); }
  setPluginReadiness(states: Array<{ id: string; ready: boolean }>): void { this.#pluginReady = new Map(states.map((state) => [state.id, state.ready])); }
  upsertAction(action: LiveAction): void { this.#actions.set(action.id, action); this.#options.capabilities.vm?.clearScope?.(`behavior:${action.id}`); }
  upsertEvent(event: LiveEvent): void { this.#events.set(event.id, event); }
  recentRuns(limit = MAX_RUNS): BehaviorRun[] { return this.#runs.slice(0, Math.max(1, limit)); }

  removeAction(id: string): void {
    this.#actions.delete(id);
    for (const event of this.#events.values()) event.actionIds = event.actionIds.filter((entry) => entry !== id);
  }

  removeEvent(id: string): void {
    this.#events.delete(id);
    for (const key of [...this.#cooldowns.keys()]) if (key.startsWith(`${id}:`)) this.#cooldowns.delete(key);
  }

  handleEvent(event: AutomationEvent): void {
    if (emitDepth(event) >= MAX_EMIT_DEPTH) return;
    for (const record of this.#events.values()) {
      if (!record.enabled || record.trigger !== event.type) continue;
      void this.#runEvent(record, event).catch(() => undefined);
    }
  }

  async testAction(action: LiveAction, event: AutomationEvent): Promise<BehaviorRun> { return this.#runAction(action, event, undefined, true); }

  async testEvent(record: LiveEvent, event: AutomationEvent): Promise<BehaviorRun[]> {
    const failing = record.filters.find((filter) => !matchesFilter(filter, event));
    if (failing) return [this.#record({ name: record.name }, record, this.#now(), 'skipped', `filtro no cumplido · ${failing.path}`, [], true)];
    return this.#runActionsOf(record, event, true);
  }

  async #runEvent(record: LiveEvent, event: AutomationEvent): Promise<void> {
    for (const filter of record.filters) if (!matchesFilter(filter, event)) return;
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
    const actions = record.actionIds.map((id) => this.#actions.get(id)).filter((action): action is LiveAction => action !== undefined && action.enabled);
    if (actions.length === 0) return [this.#record({ name: '—' }, record, this.#now(), 'skipped', 'sin acciones activas', [], test)];
    const randomAction = actions[Math.floor(Math.random() * actions.length)];
    const selected: LiveAction[] = record.runMode === 'random' ? (randomAction ? [randomAction] : []) : actions;
    const runs: BehaviorRun[] = [];
    for (const action of selected) runs.push(await this.#runAction(action, event, record, test));
    return runs;
  }

  async #runAction(action: LiveAction, event: AutomationEvent, origin: LiveEvent | undefined, test: boolean): Promise<BehaviorRun> {
    const startedAt = this.#now();
    const logs: string[] = [];
    try {
      const implementation = this.#actionRegistry.get(action.typeId);
      if (!implementation) throw new Error(`El tipo de acción ${action.typeId} ya no existe.`);
      if (implementation.definition.source.kind === 'plugin' && this.#pluginReady.get(implementation.definition.source.pluginId) !== true) {
        const pluginId = implementation.definition.source.pluginId;
        const legacyId = pluginId === 'audio.miniaudio' ? 'audio-native' : pluginId === 'tts.sonicboom' ? 'sonicboom-tts' : undefined;
        const label = legacyId ? `${pluginId} (${legacyId})` : pluginId;
        throw new Error(`El plugin ${label} no está instalado o está desactivado.`);
      }
      const result = await implementation.execute({
        action: { ...action, config: resolveActionConfig(implementation.definition, action.config, event) },
        event,
        capabilities: this.#options.capabilities,
        log: (message, metadata) => {
          if (logs.length < 40) logs.push(metadata ? `${message} ${JSON.stringify(metadata)}` : message);
        },
        publish: this.#options.publish,
      });
      return this.#record(action, origin, startedAt, 'ok', result.summary, logs, test);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.#record(action, origin, startedAt, 'error', message, logs, test, message);
    }
  }

  #record(action: { name: string; id?: string }, origin: LiveEvent | undefined, startedAt: number, status: RunStatus, summary: string, logs: string[], test: boolean, error?: string): BehaviorRun {
    const run: BehaviorRun = {
      id: `run-${++this.#counter}-${startedAt.toString(36)}`, at: startedAt, status,
      eventId: origin?.id, eventName: origin?.name, actionId: action.id, actionName: action.name,
      summary, durationMs: Math.max(0, this.#now() - startedAt), test, logs: logs.slice(0, 40), error,
    };
    this.#runs.unshift(run);
    if (this.#runs.length > MAX_RUNS) this.#runs.length = MAX_RUNS;
    this.#options.onRun?.(run);
    return run;
  }

  #now(): number { return this.#options.now?.() ?? Date.now(); }
}

/** Every filter of an event is an AND; the "or" lives inside `in`. */
export function matchesFilter(filter: EventFilter, event: AutomationEvent): boolean {
  const raw = readEventPath(event, filter.path);
  const left = readString(raw);
  const leftNumber = Number(left);
  const rightNumber = Number(filter.value);
  const numeric = Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && filter.value.trim() !== '';
  switch (filter.operator) {
    case 'gte': return numeric && leftNumber >= rightNumber;
    case 'gt': return numeric && leftNumber > rightNumber;
    case 'lte': return numeric && leftNumber <= rightNumber;
    case 'lt': return numeric && leftNumber < rightNumber;
    case 'eq': return numeric ? leftNumber === rightNumber : left === filter.value;
    case 'neq': return numeric ? leftNumber !== rightNumber : left !== filter.value;
    case 'contains': return left.toLowerCase().includes(filter.value.toLowerCase());
    case 'starts-with': return left.toLowerCase().startsWith(filter.value.toLowerCase());
    case 'in': return (filter.values ?? []).some((entry) => entry.trim().toLowerCase() === left.trim().toLowerCase());
    case 'is-true': return raw === true || left === 'true' || left === '1';
    case 'is-false': return raw === false || left === 'false' || left === '0' || left === '';
    default: return false;
  }
}

export function sampleEventFor(type: AutomationEventType): AutomationEvent {
  const base: AutomationEvent = {
    id: 'sample-event', type, timestamp: Date.now(),
    user: { uniqueId: 'usuario_demo', nickname: 'Usuario Demo', userId: '0' },
    creator: { uniqueId: 'creador_demo', roomId: '0000000000' }, data: {},
  };
  switch (type) {
    case 'tiktok.gift': return { ...base, data: { giftId: '5655', giftName: 'Rosa', diamondCount: 1, repeatCount: 1, comboCount: 1, groupId: '0', repeatEnd: true, streakable: false } };
    case 'tiktok.chat': return { ...base, data: { comment: 'hola desde la prueba', method: 'chat', isHistory: false } };
    case 'tiktok.like': return { ...base, data: { count: 5, total: 120, method: 'like' } };
    case 'points.awarded': return { ...base, data: { uniqueId: 'usuario_demo', delta: 10, totalPoints: 120, level: 2, currencyName: 'Points', reason: 'chat' } };
    case 'plugin.emit': return { ...base, data: { emitType: 'overlay.alert', depth: 0, payload: {} } };
    default: return base;
  }
}

function readString(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function emitDepth(event: AutomationEvent): number {
  if (event.type !== 'plugin.emit' || !event.data || typeof event.data !== 'object' || Array.isArray(event.data)) return 0;
  const depth = event.data.depth;
  return typeof depth === 'number' && Number.isFinite(depth) ? depth : 0;
}
