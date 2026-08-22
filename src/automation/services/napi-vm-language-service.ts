import { LanguageService } from 'napi-vm';

import type {
  AutomationEventType,
  AutomationScriptAnalysis,
  AutomationScriptCompletion,
  AutomationScriptDiagnostic,
  AutomationScriptHover,
  JsonObject,
  JsonValue,
} from '../types.ts';

const MAX_SOURCE_LENGTH = 128 * 1024;

type Shape =
  | { kind: 'null' | 'unknown' | 'string' | 'number' | 'boolean' }
  | { kind: 'array'; items: Shape }
  | { kind: 'object'; properties: Record<string, Shape> };

/** Host-side adapter for napi-vm's frontend-independent editor intelligence. */
export class NapiVmLanguageService {
  readonly #service = new LanguageService();
  readonly #documents = new Set<string>();

  constructor() {
    this.#service.registerHostFunction(
      'log',
      [{ name: 'message', typeName: 'unknown' }],
      'void',
      'Write a message to the TikTools automation log.',
    );
    this.#service.registerHostFunction(
      'capability',
      [
        { name: 'name', typeName: 'string' },
        { name: 'params', typeName: 'object' },
      ],
      'Promise<object>',
      'Request a manifest-approved host capability from a sandbox plugin.',
      true,
    );
    this.#service.registerModule('@tiktools/sdk', `
      export function log(message) { return undefined; }
      export function capability(name, params) { return undefined; }
    `);
  }

  analyze(
    nodeId: string,
    source: string,
    offset: number,
    eventType: AutomationEventType = 'tiktok.chat',
  ): AutomationScriptAnalysis {
    const boundedSource = source.slice(0, MAX_SOURCE_LENGTH);
    const boundedOffset = Math.max(0, Math.min(offset, boundedSource.length));
    const uri = `file:///tiktools/automation/${encodeURIComponent(nodeId)}.js`;
    const sampleEvent = sampleEventForType(eventType);
    const prelude = `import { log, capability } from '@tiktools/sdk';\nfunction __script(event = ${JSON.stringify(sampleEvent)}, inputs = { value: null }, data = ${JSON.stringify(sampleEvent.data)}) {\n`;
    const document = `${prelude}${boundedSource}\n}`;
    if (this.#documents.has(uri)) this.#service.update(uri, document);
    else {
      this.#service.open(uri, document);
      this.#documents.add(uri);
    }

    const preludeLines = countLines(prelude);
    const diagnostics = this.#service.diagnostics(uri)
      .map((diagnostic): AutomationScriptDiagnostic => ({
        line: Math.max(1, diagnostic.line - preludeLines),
        column: Math.max(1, diagnostic.col),
        message: diagnostic.message,
        severity: diagnostic.severity,
      }))
      .filter((diagnostic) => diagnostic.line <= countLines(boundedSource) + 1);

    const completions = this.#completions(uri, boundedSource, boundedOffset, sampleEvent, prelude.length);
    const hover = this.#hover(uri, boundedSource, boundedOffset, sampleEvent, prelude.length);
    return {
      nodeId,
      source: boundedSource,
      diagnostics,
      completions,
      hover,
    };
  }

  close(nodeId: string): void {
    const uri = `file:///tiktools/automation/${encodeURIComponent(nodeId)}.js`;
    if (this.#documents.delete(uri)) this.#service.close(uri);
  }

  clearAll(): void {
    for (const uri of this.#documents) this.#service.close(uri);
    this.#documents.clear();
  }

  #completions(
    uri: string,
    source: string,
    offset: number,
    event: JsonObject,
    preludeLength: number,
  ): AutomationScriptCompletion[] {
    const own = shapeCompletions(source, offset, {
      event: inferShape(event),
      inputs: inferShape({ value: null }),
      data: inferShape(event.data ?? null),
    });
    if (own.length > 0) return own;
    return this.#service.complete(uri, preludeLength + offset).map((completion) => ({
      label: completion.label,
      kind: completion.kind,
      detail: completion.detail,
    }));
  }

  #hover(
    uri: string,
    source: string,
    offset: number,
    event: JsonObject,
    preludeLength: number,
  ): AutomationScriptHover | undefined {
    const own = shapeHover(source, offset, {
      event: inferShape(event),
      inputs: inferShape({ value: null }),
      data: inferShape(event.data ?? null),
    });
    if (own) return own;
    const hover = this.#service.hover(uri, preludeLength + offset);
    return hover ? { detail: hover.detail, documentation: hover.documentation ?? undefined } : undefined;
  }
}

function shapeCompletions(source: string, offset: number, roots: Record<string, Shape>): AutomationScriptCompletion[] {
  const match = source.slice(0, offset).match(/(?:^|[^A-Za-z0-9_$])((?:event|inputs|data)(?:\.[A-Za-z0-9_$]*)*)$/);
  if (!match || !match[1]?.includes('.')) return [];
  const tokens = match[1].split('.');
  const partial = tokens.pop() ?? '';
  const rootName = tokens.shift() ?? '';
  const root = roots[rootName];
  if (!root) return [];
  const shape = followShape(root, tokens.filter(Boolean));
  if (!shape || shape.kind !== 'object') return [];
  return Object.entries(shape.properties)
    .filter(([name]) => name.startsWith(partial))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([label, value]) => ({ label, kind: 'property', detail: value.kind }));
}

function shapeHover(source: string, offset: number, roots: Record<string, Shape>): AutomationScriptHover | undefined {
  const before = source.slice(0, offset);
  const match = before.match(/(?:^|[^A-Za-z0-9_$])((?:event|inputs|data)(?:\.[A-Za-z0-9_$]+)*)$/);
  if (!match) return undefined;
  const tokens = (match[1] ?? '').split('.');
  const rootName = tokens.shift() ?? '';
  const root = roots[rootName];
  if (!root) return undefined;
  const shape = followShape(root, tokens);
  if (!shape) return undefined;
  return { detail: `${tokens[tokens.length - 1] ?? 'value'}: ${shape.kind}` };
}

function followShape(root: Shape, path: string[]): Shape | undefined {
  let current: Shape | undefined = root;
  for (const part of path) {
    if (!current || current.kind !== 'object') return undefined;
    current = current.properties[part];
  }
  return current;
}

function inferShape(value: JsonValue): Shape {
  if (value === null) return { kind: 'null' };
  if (typeof value === 'string') return { kind: 'string' };
  if (typeof value === 'number') return { kind: 'number' };
  if (typeof value === 'boolean') return { kind: 'boolean' };
  if (Array.isArray(value)) return { kind: 'array', items: value[0] === undefined ? { kind: 'unknown' } : inferShape(value[0]) };
  const properties: Record<string, Shape> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) properties[key] = inferShape(entry);
  }
  return { kind: 'object', properties };
}

function sampleEventForType(type: AutomationEventType): JsonObject {
  const data: JsonObject = type === 'tiktok.gift'
    ? { giftId: '', giftName: '', diamondCount: 0, repeatCount: 0, comboCount: 0, repeatEnd: false, streakable: false }
    : type === 'tiktok.like'
      ? { count: 0, total: 0, method: '' }
      : type === 'tiktok.follow' || type === 'tiktok.share' || type === 'tiktok.social'
        ? { action: 0, followCount: 0, shareCount: 0, method: '' }
        : type === 'tiktok.join'
          ? { memberCount: 0, action: 0, method: '' }
          : type === 'tiktok.room_stats'
            ? { viewers: 0, totalUsers: 0, popularity: 0, anonymous: 0, topViewers: [] }
            : type === 'points.awarded'
              ? { uniqueId: '', delta: 0, totalPoints: 0, level: 1, currencyName: '', reason: '' }
              : { comment: '', method: '', isHistory: false };
  return {
    id: '',
    type,
    timestamp: 0,
    creator: { uniqueId: '', roomId: '' },
    user: { uniqueId: '', userId: '', nickname: '', avatarUrl: '' },
    points: { delta: 0, total: 0, level: 1 },
    data,
  };
}

function countLines(value: string): number {
  return value.split('\n').length - 1;
}
