import { describe, expect, test } from 'bun:test';

import { fieldsForTrigger, findField, operatorsFor } from './fields.ts';
import { matchesFilter, sampleEventFor } from './engine.ts';

describe('condition fields', () => {
  test('every field a trigger offers resolves against that trigger sample event', () => {
    const sample = sampleEventFor('tiktok.gift');
    const paths = fieldsForTrigger('tiktok.gift').map((field) => field.path);

    expect(paths).toContain('event.data.giftName');
    expect(paths).toContain('event.user.uniqueId');
    // The gift sample carries every gift field, so an `eq` against its own
    // value must pass — that is what proves the paths are not typos.
    expect(matchesFilter({ path: 'event.data.giftName', operator: 'eq', value: 'Rosa' }, sample)).toBe(true);
    expect(matchesFilter({ path: 'event.data.diamondCount', operator: 'gte', value: '1' }, sample)).toBe(true);
  });

  test('the operators on offer match the kind of value the field holds', () => {
    expect(operatorsFor('number')).toContain('gte');
    expect(operatorsFor('number')).not.toContain('contains');
    expect(operatorsFor('boolean')).toEqual(['is-true', 'is-false']);
    expect(operatorsFor('gift')).toEqual(['eq', 'neq', 'in']);
    expect(operatorsFor('text')).toContain('starts-with');
  });

  test('a gift field asks for the gift picker and a viewer field for the viewer picker', () => {
    expect(findField('tiktok.gift', 'event.data.giftName')?.kind).toBe('gift');
    expect(findField('tiktok.gift', 'event.user.uniqueId')?.kind).toBe('user');
    expect(findField('tiktok.gift', 'event.data.repeatEnd')?.kind).toBe('boolean');
  });

  test('a hand-written path is unknown, which is what makes the editor fall back to free text', () => {
    expect(findField('tiktok.gift', 'event.data.whatever')).toBeUndefined();
  });

  test('every trigger offers at least one field', () => {
    for (const trigger of ['tiktok.gift', 'tiktok.chat', 'tiktok.like', 'points.awarded', 'tiktok.follow'] as const) {
      expect(fieldsForTrigger(trigger).length).toBeGreaterThan(0);
    }
  });
});
