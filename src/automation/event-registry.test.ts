import { describe, expect, test } from 'bun:test';

import {
  allRegistryFields,
  fieldsForEventType,
  registryEventTypes,
  registryHasPath,
  sampleDataForType,
  sampleEventForType,
} from './event-registry.ts';
import { fieldsForTrigger } from './behavior/fields.ts';
import { matchesFilter } from './behavior/filters.ts';
import { sampleEventFor } from './behavior/samples.ts';
import type { AutomationEventType, JsonValue } from './types.ts';

const ALL_TYPES: AutomationEventType[] = [
  'tiktok.chat',
  'tiktok.gift',
  'tiktok.like',
  'tiktok.follow',
  'tiktok.share',
  'tiktok.join',
  'tiktok.social',
  'tiktok.room_stats',
  'tiktok.connected',
  'tiktok.disconnected',
  'points.awarded',
  'plugin.emit',
];

function readPath(root: JsonValue, path: string): JsonValue | undefined {
  const parts = path.split('.').filter(Boolean);
  if (parts[0] === 'event') parts.shift();
  let current: JsonValue | undefined = root;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
    } else {
      current = (current as Record<string, JsonValue | undefined>)[part];
    }
  }
  return current;
}

describe('event registry', () => {
  test('covers every automation event type', () => {
    expect(registryEventTypes()).toEqual(ALL_TYPES);
  });

  test('every registry path resolves against its own sample event (no drift)', () => {
    for (const type of ALL_TYPES) {
      const sample = sampleEventForType(type);
      for (const field of fieldsForEventType(type)) {
        expect(readPath(sample, field.path), `${type} ${field.path}`).not.toBeUndefined();
      }
    }
  });

  test('every condition-editor field resolves against the trigger sample', () => {
    for (const trigger of ALL_TYPES) {
      const sample = sampleEventFor(trigger);
      for (const field of fieldsForTrigger(trigger)) {
        expect(registryHasPath(trigger, field.path), `${trigger} ${field.path}`).toBe(true);
        expect(readPath(sample, field.path), `${trigger} ${field.path}`).not.toBeUndefined();
      }
    }
  });

  test('gift sample keeps the values condition tests rely on', () => {
    const sample = sampleEventFor('tiktok.gift');
    expect(matchesFilter({ path: 'event.data.giftName', operator: 'eq', value: 'Rosa' }, sample)).toBe(true);
    expect(matchesFilter({ path: 'event.data.diamondCount', operator: 'gte', value: '1' }, sample)).toBe(true);
  });

  test('proto-derived events document their vendor message', () => {
    for (const type of ['tiktok.chat', 'tiktok.gift', 'tiktok.like', 'tiktok.join', 'tiktok.social', 'tiktok.room_stats'] as const) {
      const fields = fieldsForEventType(type);
      expect(fields.length).toBeGreaterThan(5);
      expect(fields.some((field) => field.sourceField)).toBe(true);
    }
  });

  test('data payloads are keyed by field name, not hardcoded lists', () => {
    expect(Object.keys(sampleDataForType('tiktok.gift'))).toContain('giftName');
    expect(Object.keys(sampleDataForType('tiktok.chat'))).toContain('comment');
    expect(allRegistryFields().some((field) => field.path === 'event.user.uniqueId')).toBe(true);
  });
});
