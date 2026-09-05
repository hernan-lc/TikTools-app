import { describe, expect, test } from 'bun:test';

import { availableEventTypes, findEventType, isBuiltinTrigger } from './triggers.ts';
import type { PluginEventType, PluginStatus } from './types.ts';

function plugin(id: string, installed: boolean, enabled: boolean): PluginStatus {
  return {
    descriptor: {
      id,
      name: { default: id, i18key: 'x' },
      version: '1.0.0',
      description: { default: id, i18key: 'x' },
      dependency: { default: 'process', i18key: 'x' },
      permissions: [],
      actionTypeIds: [],
      eventTypeIds: ['hotkey.pressed'],
    },
    installed,
    enabled,
    available: true,
  };
}

function eventType(type: string, pluginId: string): PluginEventType {
  return {
    type,
    title: { default: type, i18key: 'x' },
    source: { kind: 'plugin', pluginId },
  };
}

describe('plugin event triggers', () => {
  test('builtin triggers are recognized', () => {
    expect(isBuiltinTrigger('tiktok.gift')).toBe(true);
    expect(isBuiltinTrigger('plugin.emit')).toBe(true);
    expect(isBuiltinTrigger('hotkey.pressed')).toBe(false);
    expect(isBuiltinTrigger('')).toBe(false);
  });

  test('findEventType looks up declared types', () => {
    const types = [eventType('hotkey.pressed', 'hotkeys')];
    expect(findEventType(types, 'hotkey.pressed')?.title.default).toBe('hotkey.pressed');
    expect(findEventType(types, 'timer.tick')).toBeUndefined();
  });

  test('only installed and enabled plugins offer their triggers', () => {
    const plugins = [plugin('hotkeys', true, true), plugin('timers', true, false), plugin('dom', false, false)];
    const types = [eventType('hotkey.pressed', 'hotkeys'), eventType('timer.tick', 'timers'), eventType('dom.match', 'dom')];
    expect(availableEventTypes(plugins, types).map((entry) => entry.type)).toEqual(['hotkey.pressed']);
  });
});
