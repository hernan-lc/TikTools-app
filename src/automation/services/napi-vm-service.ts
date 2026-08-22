import { createVm, type Vm } from 'napi-vm';

import type { ScriptCapability, ScriptEnvironment } from '../capabilities.ts';
import type { JsonObject, JsonValue } from '../types.ts';

type VmSession = {
  vm: Vm;
  source: string;
  log?: (message: string) => void;
};

/**
 * Synchronous napi-vm adapter for high-frequency Script nodes. It exposes
 * only JSON globals and a narrow log callback; network, files, process, and
 * native modules stay in host capabilities instead.
 */
export class NapiVmService implements ScriptCapability {
  readonly #sessions = new Map<string, VmSession>();

  evaluate(
    source: string,
    environment: ScriptEnvironment,
    options: { scopeId?: string; loopLimit?: number; log?: (message: string) => void } = {},
  ): JsonValue {
    const code = source.trim();
    if (!code) return null;
    const scopeId = options.scopeId ?? 'default';
    const session = this.#session(scopeId, code);
    session.log = options.log;
    session.vm.setLoopLimit(clamp(options.loopLimit ?? 1_000_000, 1_000, 10_000_000));
    session.vm.setGlobal('event', environment.event);
    session.vm.setGlobal('inputs', environment.inputs);
    session.vm.setGlobal('data', environment.event && typeof environment.event === 'object' && !Array.isArray(environment.event)
      ? (environment.event as JsonObject).data ?? null
      : null);

    const raw = session.vm.run(`JSON.stringify((function () {\n${code}\n})())`);
    if (raw === 'undefined') return null;
    let value: unknown;
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      throw new Error('Script node returned a value that is not valid JSON.');
    }
    if (!isJsonValue(value)) throw new Error('Script node returned a non-JSON value.');
    return value;
  }

  clearScope(scopeId: string): void {
    this.#sessions.delete(scopeId);
  }

  clearAll(): void {
    this.#sessions.clear();
  }

  #session(scopeId: string, source: string): VmSession {
    const existing = this.#sessions.get(scopeId);
    if (existing && existing.source === source) return existing;

    const vm = createVm();
    const session: VmSession = { vm, source };
    vm.exposeFunction('log', (...args: unknown[]) => {
      session.log?.(args.map((arg) => stringify(arg)).join(' '));
      return null;
    });
    this.#sessions.set(scopeId, session);
    return session;
  }
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== 'object') return false;
  return Object.values(value).every((entry) => entry === undefined || isJsonValue(entry));
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
