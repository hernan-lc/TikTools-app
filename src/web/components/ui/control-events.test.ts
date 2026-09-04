import { describe, expect, test } from 'bun:test';
import { normalizeControlString, readFormValues } from './control-events.ts';

describe('control value normalization', () => {
  test('unwraps Vue-style refs before writing to a native control', () => {
    expect(normalizeControlString({ __v_isRef: true, value: 'viewer-name' })).toBe('viewer-name');
  });

  test('never renders ordinary objects as [object Object]', () => {
    expect(normalizeControlString({ viewer: 'viewer-name' })).toBe('{"viewer":"viewer-name"}');
    expect(normalizeControlString(null)).toBe('');
  });

  test('reads named controls with one schema contract', () => {
    const named = (name: string) => (attribute: string) => attribute === 'name' ? name : null;
    const controls = [
      { tagName: 'INPUT', type: 'text', value: 'viewer', checked: false, getAttribute: named('creator') },
      { tagName: 'INPUT', type: 'number', value: '7', checked: false, getAttribute: named('points') },
      { tagName: 'INPUT', type: 'checkbox', value: 'on', checked: true, getAttribute: named('enabled') },
      { tagName: 'TEXTAREA', type: '', value: '{"mode":"live"}', checked: false, getAttribute: named('settings') },
    ];
    const root = { querySelectorAll: () => controls } as unknown as ParentNode;
    expect(readFormValues(root, {
      creator: 'string',
      points: 'number',
      enabled: 'boolean',
      settings: 'json',
    })).toEqual({ creator: 'viewer', points: 7, enabled: true, settings: { mode: 'live' } });
  });
});
