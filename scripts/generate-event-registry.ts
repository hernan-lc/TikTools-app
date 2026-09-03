/**
 * Type generator for the automation event registry.
 *
 * Reads the canonical TypeScript schemes — `src/automation/types.ts`
 * (normalized AutomationEvent + per-trigger data interfaces) and the TikTok
 * proto shapes in `vendor/tiktok-signer/packages/tiktok-live/src/types.ts`
 * (ChatEvent, GiftEvent, …) — plus the human labels in the behavior
 * translation catalog, and emits `src/automation/event-registry.json`.
 *
 * That JSON is the ONLY source of autocomplete/condition-field data. Nothing
 * in the UI may hardcode `event.data.*` path lists anymore: forms,
 * template suggestions, the condition editor and sample events all derive
 * from the registry, so a new proto field appears everywhere after one
 * `bun run registry:events`.
 *
 * Usage: `bun run registry:events` (see package.json).
 */
import ts from 'typescript';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { BUILTIN_TRANSLATION_CATALOG } from '../src/automation/behavior/catalog.ts';

const ROOT = resolve(import.meta.dir, '..');
const AUTOMATION_TYPES = join(ROOT, 'src/automation/types.ts');
const VENDOR_TYPES = join(ROOT, 'vendor/tiktok-signer/packages/tiktok-live/src/types.ts');
const OUTPUT = join(ROOT, 'src/automation/event-registry.json');

type MemberInfo = { name: string; tsType: string; optional: boolean };

type InterfaceMap = Map<string, MemberInfo[]>;

function parseInterfaces(filePath: string): InterfaceMap {
  const text = readFileSync(filePath, 'utf8');
  const source = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);
  const map: InterfaceMap = new Map();
  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node)) {
      const members: MemberInfo[] = [];
      for (const member of node.members) {
        if (!ts.isPropertySignature(member)) continue;
        const name = member.name.getText(source).replace(/^['"]|['"]$/g, '');
        members.push({
          name,
          tsType: member.type ? member.type.getText(source) : 'unknown',
          optional: Boolean(member.questionToken),
        });
      }
      map.set(node.name.text, members);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return map;
}

type FieldKind = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null' | 'unknown';

const OBJECT_REFS = new Set([
  'AutomationUser',
  'AutomationCreator',
  'AutomationPoints',
  'EventUser',
  'TopViewer',
]);

function normalizeKind(tsType: string): FieldKind {
  const base = tsType.replace(/\s*\|\s*undefined/g, '').replace(/undefined\s*\|\s*/g, '').trim();
  if (base === 'JsonArray' || base.endsWith('[]') || /^Array<.+>$/.test(base)) return 'array';
  if (base === 'string') return 'string';
  if (base === 'number') return 'number';
  if (base === 'boolean') return 'boolean';
  if (base === 'null') return 'null';
  if (base === 'JsonObject') return 'object';
  if (OBJECT_REFS.has(base)) return 'object';
  return 'unknown';
}

function refOf(tsType: string): string | undefined {
  const base = tsType.replace(/\s*\|\s*undefined/g, '').trim();
  return OBJECT_REFS.has(base) ? base : undefined;
}

type NestedSchemas = Record<string, MemberInfo[]>;

function nestedMembers(
  ref: string,
  automation: InterfaceMap,
  vendor: InterfaceMap,
  nested: NestedSchemas,
): MemberInfo[] {
  if (nested[ref]) return nested[ref]!;
  if (ref === 'EventUser') {
    // The automation layer normalizes vendor users via userFromEvent, which
    // drops proto extras (secUid): the registry mirrors what automation
    // events really carry, i.e. AutomationUser.
    const members = automation.get('AutomationUser') ?? [];
    nested[ref] = members;
    return members;
  }
  const found = automation.get(ref) ?? vendor.get(ref);
  nested[ref] = found ?? [];
  return nested[ref]!;
}

export interface RegistryField {
  path: string;
  tsType: string;
  kind: FieldKind;
  optional: boolean;
  i18key?: string;
  label: { en: string; es: string };
  hint?: { en: string; es: string };
  sample?: unknown;
  vendorField?: string;
}

interface EventConfig {
  dataInterface: string;
  vendorInterface: string;
  sampleData: Record<string, unknown>;
  note?: string;
}

const EVENT_CONFIG: Record<string, EventConfig> = {
  'tiktok.chat': {
    dataInterface: 'TikTokChatData',
    vendorInterface: 'ChatEvent',
    sampleData: { comment: 'hola desde la prueba', method: 'chat', msgId: 'msg-1', isHistory: false },
  },
  'tiktok.gift': {
    dataInterface: 'TikTokGiftData',
    vendorInterface: 'GiftEvent',
    sampleData: {
      giftId: '5655', giftName: 'Rosa', diamondCount: 1, repeatCount: 1,
      comboCount: 1, groupId: '0', repeatEnd: true, streakable: false,
      giftIconUrl: 'https://example.com/gift.png',
      toUser: { uniqueId: 'creador_demo', nickname: 'Creador', userId: '1', avatarUrl: 'https://example.com/avatar.jpg' },
    },
  },
  'tiktok.like': {
    dataInterface: 'TikTokLikeData',
    vendorInterface: 'LikeEvent',
    sampleData: { count: 5, total: 120, method: 'like', msgId: 'msg-1' },
  },
  'tiktok.follow': {
    dataInterface: 'TikTokSocialData',
    vendorInterface: 'SocialEvent',
    note: 'SocialEvent with action = SOCIAL_ACTION.follow (1)',
    sampleData: { action: 1, followCount: 3, shareCount: 0, method: 'social', msgId: 'msg-1' },
  },
  'tiktok.share': {
    dataInterface: 'TikTokSocialData',
    vendorInterface: 'SocialEvent',
    note: 'SocialEvent with action = SOCIAL_ACTION.share (3)',
    sampleData: { action: 3, followCount: 0, shareCount: 2, method: 'social', msgId: 'msg-1' },
  },
  'tiktok.join': {
    dataInterface: 'TikTokMemberData',
    vendorInterface: 'MemberEvent',
    sampleData: { memberCount: 1, action: 0, method: 'member', msgId: 'msg-1' },
  },
  'tiktok.social': {
    dataInterface: 'TikTokSocialData',
    vendorInterface: 'SocialEvent',
    sampleData: { action: 0, followCount: 0, shareCount: 0, method: 'social', msgId: 'msg-1' },
  },
  'tiktok.room_stats': {
    dataInterface: 'TikTokRoomStatsData',
    vendorInterface: 'RoomUserEvent',
    sampleData: {
      viewers: 12, totalUsers: 100, popularity: 50, anonymous: 0,
      topViewers: [{ rank: 1, score: 100, delta: 5, user: { uniqueId: 'usuario_demo', nickname: 'Usuario Demo', userId: '0', avatarUrl: 'https://example.com/avatar.jpg' } }],
    },
  },
  'tiktok.connected': {
    dataInterface: 'ConnectionData',
    vendorInterface: 'ClientState',
    sampleData: { uniqueId: 'creador_demo', roomId: '0000000000' },
  },
  'tiktok.disconnected': {
    dataInterface: 'ConnectionData',
    vendorInterface: 'ClientState',
    sampleData: { uniqueId: 'creador_demo', roomId: '0000000000' },
  },
  'points.awarded': {
    dataInterface: 'PointsAwardedData',
    vendorInterface: '-',
    sampleData: { uniqueId: 'usuario_demo', delta: 10, totalPoints: 120, level: 2, currencyName: 'Points', reason: 'chat' },
  },
  'plugin.emit': {
    dataInterface: '-',
    vendorInterface: '-',
    sampleData: { emitType: 'overlay.alert', depth: 0, payload: {} },
  },
};

const SAMPLE_USER = { uniqueId: 'usuario_demo', nickname: 'Usuario Demo', userId: '0', avatarUrl: 'https://example.com/avatar.jpg' };
const SAMPLE_CREATOR = { uniqueId: 'creador_demo', roomId: '0000000000' };

const catalogEn = BUILTIN_TRANSLATION_CATALOG.en ?? {};
const catalogEs = BUILTIN_TRANSLATION_CATALOG.es ?? {};

function humanize(path: string): string {
  const last = path.split('.').pop() ?? path;
  return last.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

function labelsFor(path: string): { i18key?: string; label: { en: string; es: string }; hint?: { en: string; es: string } } {
  const base = `automation.event.field.${path}`;
  const labelKey = `${base}.label`;
  const hintKey = `${base}.hint`;
  const en = catalogEn[labelKey];
  const fallback = humanize(path);
  const label = { en: en ?? fallback, es: catalogEs[labelKey] ?? en ?? fallback };
  const result: ReturnType<typeof labelsFor> = { label };
  if (en) result.i18key = labelKey;
  const hintEn = catalogEn[hintKey];
  if (hintEn) result.hint = { en: hintEn, es: catalogEs[hintKey] ?? hintEn };
  return result;
}

function readSample(root: unknown, path: string): unknown {
  const parts = path.split('.').filter(Boolean);
  if (parts[0] === 'event') parts.shift();
  let current: unknown = root;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    if (Array.isArray(current)) {
      if (part === '0' && current.length > 0) {
        current = current[0];
        continue;
      }
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function pushField(
  out: RegistryField[],
  path: string,
  tsType: string,
  optional: boolean,
  sampleRoot: unknown,
  vendorField?: string,
): void {
  const kind = normalizeKind(tsType);
  const { i18key, label, hint } = labelsFor(path);
  const field: RegistryField = { path, tsType, kind, optional, label };
  if (i18key) field.i18key = i18key;
  if (hint) field.hint = hint;
  const sample = readSample(sampleRoot, path);
  if (sample !== undefined) field.sample = sample;
  if (vendorField) field.vendorField = vendorField;
  out.push(field);
}

function expandObject(
  out: RegistryField[],
  prefix: string,
  ref: string,
  automation: InterfaceMap,
  vendor: InterfaceMap,
  nested: NestedSchemas,
  sampleRoot: unknown,
  vendorPrefix?: string,
): void {
  for (const member of nestedMembers(ref, automation, vendor, nested)) {
    const path = `${prefix}.${member.name}`;
    pushField(out, path, member.tsType, member.optional, sampleRoot, vendorPrefix ? `${vendorPrefix}.${member.name}` : undefined);
    const sub = refOf(member.tsType);
    if (sub && prefix.split('.').length < 3) {
      // One extra level (e.g. event.data.toUser.uniqueId, topViewers.0.user.*).
      expandObject(out, path, sub, automation, vendor, nested, sampleRoot, vendorPrefix ? `${vendorPrefix}.${member.name}` : undefined);
    }
  }
}

function vendorFieldsOf(vendor: InterfaceMap, name: string): Array<{ name: string; tsType: string; optional: boolean }> {
  return (vendor.get(name) ?? [])
    .filter((member) => member.name !== 'type')
    .map((member) => ({ name: member.name, tsType: member.tsType, optional: member.optional }));
}

function main(): void {
  const automation = parseInterfaces(AUTOMATION_TYPES);
  const vendor = parseInterfaces(VENDOR_TYPES);
  const nested: NestedSchemas = {};
  const events: Record<string, unknown> = {};

  for (const [eventType, config] of Object.entries(EVENT_CONFIG)) {
    const sampleData = config.sampleData;
    const sampleEvent: Record<string, unknown> = {
      id: 'sample-event',
      type: eventType,
      timestamp: 0,
      connectionId: 'conn-demo',
      creator: { ...SAMPLE_CREATOR },
      user: { ...SAMPLE_USER },
      data: sampleData,
      points: { delta: 10, total: 120, level: 2 },
      sourceEventId: 'sample-event-source',
    };
    // room_stats / connected style events carry no per-viewer user.
    if (eventType === 'tiktok.room_stats' || eventType === 'tiktok.connected' || eventType === 'tiktok.disconnected') {
      delete sampleEvent.user;
    }

    const fields: RegistryField[] = [];
    // Most-picked first: trigger identity, then payload, then envelope meta.
    pushField(fields, 'event.type', 'string', false, sampleEvent);
    if (sampleEvent.user !== undefined) {
      pushField(fields, 'event.user', 'AutomationUser', true, sampleEvent, 'user');
      expandObject(fields, 'event.user', 'AutomationUser', automation, vendor, nested, sampleEvent, 'user');
    }
    pushField(fields, 'event.creator', 'AutomationCreator', true, sampleEvent);
    expandObject(fields, 'event.creator', 'AutomationCreator', automation, vendor, nested, sampleEvent);
    pushField(fields, 'event.data', 'object', false, sampleEvent);
    const dataMembers = automation.get(config.dataInterface);
    if (dataMembers) {
      for (const member of dataMembers) {
        const path = `event.data.${member.name}`;
        pushField(fields, path, member.tsType, member.optional, sampleEvent, member.name);
        const sub = refOf(member.tsType);
        if (sub) expandObject(fields, path, sub, automation, vendor, nested, sampleEvent, member.name);
        if (normalizeKind(member.tsType) === 'array' && member.name === 'topViewers') {
          // Index the first element so autocomplete shows the element shape.
          const element = nestedMembers('TopViewer', automation, vendor, nested);
          for (const entry of element) {
            const entryPath = `${path}.0.${entry.name}`;
            pushField(fields, entryPath, entry.tsType, entry.optional, sampleEvent, `${member.name}.0.${entry.name}`);
            if (entry.name === 'user') expandObject(fields, entryPath, 'EventUser', automation, vendor, nested, sampleEvent, `${member.name}.0.user`);
          }
        }
      }
    } else if (eventType === 'plugin.emit') {
      for (const name of ['emitType', 'depth', 'payload']) {
        const member = (sampleData as Record<string, unknown>)[name];
        const tsType = typeof member === 'number' ? 'number' : typeof member === 'string' ? 'string' : 'JsonValue';
        pushField(fields, `event.data.${name}`, tsType, false, sampleEvent);
      }
    }
    pushField(fields, 'event.timestamp', 'number', false, sampleEvent);
    pushField(fields, 'event.id', 'string', false, sampleEvent);
    pushField(fields, 'event.connectionId', 'string', true, sampleEvent);
    pushField(fields, 'event.points', 'AutomationPoints', true, sampleEvent);
    expandObject(fields, 'event.points', 'AutomationPoints', automation, vendor, nested, sampleEvent);
    pushField(fields, 'event.sourceEventId', 'string', true, sampleEvent);

    events[eventType] = {
      dataInterface: config.dataInterface,
      vendorInterface: config.vendorInterface,
      ...(config.note ? { note: config.note } : {}),
      sampleEvent,
      fields,
      vendorFields: vendorFieldsOf(vendor, config.vendorInterface),
    };
  }

  const registry = {
    version: 1,
    generatedBy: 'scripts/generate-event-registry.ts — do not edit by hand, run `bun run registry:events`',
    generatedFrom: ['src/automation/types.ts', 'vendor/tiktok-signer/packages/tiktok-live/src/types.ts', 'src/automation/behavior/catalog.ts'],
    events,
  };
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(registry, null, 2)}\n`);

  const totalFields = Object.values(events).reduce((sum: number, entry) => sum + (entry as { fields: unknown[] }).fields.length, 0);
  console.log(`event registry: ${Object.keys(events).length} events, ${totalFields} fields → ${OUTPUT}`);
}

main();
