import { describe, expect, test } from 'bun:test';

import type {
  ActionTypeDefinition,
  PluginDescriptor,
  PluginStatus,
} from '../../automation/behavior/types.ts';
import {
  connectionIconFor,
  matchesActionTypeQuery,
  matchesPluginQuery,
  pluginIconTone,
  pluginTags,
  resolveActionTypeIcon,
  resolvePluginIcon,
} from './plugin-cards.ts';

function descriptor(overrides: Partial<PluginDescriptor> = {}): PluginDescriptor {
  return {
    id: 'demo.plugin',
    name: { default: 'Demo', i18key: 'demo.name' },
    version: '1.0.0',
    description: { default: 'Does demo things.', i18key: 'demo.description' },
    dependency: { default: 'process runtime', i18key: 'plugin.dependency' },
    permissions: [],
    actionTypeIds: [],
    eventTypeIds: [],
    ...overrides,
  };
}

function action(id: string, tag: string): ActionTypeDefinition {
  return {
    id,
    title: { default: id, i18key: `${id}.title` },
    description: { default: id, i18key: `${id}.description` },
    tag,
    source: { kind: 'plugin', pluginId: 'demo.plugin' },
    requiredCapabilities: [],
  };
}

function status(entry: PluginDescriptor): PluginStatus {
  return { descriptor: entry, installed: true, enabled: true, available: true };
}

describe('resolvePluginIcon', () => {
  test('declared registry names win over heuristics', () => {
    expect(resolvePluginIcon(descriptor({ id: 'hotkeys', icon: 'voice' }), [])).toBe('voice');
  });

  test('unknown declared names fall back to the heuristic', () => {
    expect(resolvePluginIcon(descriptor({ id: 'hotkeys', icon: 'no-such-icon' }), [])).toBe(
      'keyboard',
    );
  });

  test('matches the four bundled plugins', () => {
    expect(resolvePluginIcon(descriptor({ id: 'audio.play.process' }), [])).toBe('audio');
    expect(resolvePluginIcon(descriptor({ id: 'hotkeys' }), [])).toBe('keyboard');
    expect(resolvePluginIcon(descriptor({ id: 'sonicboom.server' }), [])).toBe('voice');
    expect(
      resolvePluginIcon(descriptor({ id: 'textintel', name: { default: 'Text Intelligence', i18key: 'x' } }), []),
    ).toBe('format');
  });

  test('heuristic reads tags and action tags, not just the id', () => {
    const fromTags = descriptor({ id: 'mystery', tags: ['discord'] });
    expect(resolvePluginIcon(fromTags, [])).toBe('webhook');
    const fromActions = descriptor({ id: 'mystery', actionTypeIds: ['obs.scene'] });
    expect(resolvePluginIcon(fromActions, [action('obs.scene', 'streaming')])).toBe('live');
  });

  test('ignores other plugins actions from the shared catalog', () => {
    const catalog = [
      action('audio.play.process', 'audio'),
      action('hotkey.bind', 'hotkeys'),
      action('sonicboom.server.speak', 'tts'),
    ];
    // Every card resolves from its own actions: with the unfiltered catalog
    // each of these used to collapse to the first matching rule (keyboard).
    expect(
      resolvePluginIcon(
        descriptor({ id: 'audio.play.process', actionTypeIds: ['audio.play.process'] }),
        catalog,
      ),
    ).toBe('audio');
    expect(
      resolvePluginIcon(descriptor({ id: 'hotkeys', actionTypeIds: ['hotkey.bind'] }), catalog),
    ).toBe('keyboard');
    expect(
      resolvePluginIcon(
        descriptor({ id: 'sonicboom.server', actionTypeIds: ['sonicboom.server.speak'] }),
        catalog,
      ),
    ).toBe('voice');
    expect(
      resolvePluginIcon(descriptor({ id: 'unrelated', actionTypeIds: ['unknown.action'] }), catalog),
    ).toBe('plugin');
  });

  test('falls back to the generic plugin glyph', () => {
    expect(resolvePluginIcon(descriptor({ id: 'mystery' }), [])).toBe('plugin');
  });
});

describe('connectionIconFor', () => {
  test('prefers a declared icon and skips generic connection glyphs', () => {
    expect(connectionIconFor(descriptor({ id: 'sonicboom.server', icon: 'voice' }), 'radio')).toBe('voice');
    expect(connectionIconFor(descriptor({ id: 'mystery', icon: 'connected' }), 'radio')).not.toBe('radio');
  });

  test('stays stable and avoids icons already used by the list', () => {
    const first = connectionIconFor(descriptor({ id: 'mystery', icon: 'connected' }), 'radio');
    const stable = connectionIconFor(descriptor({ id: 'mystery', icon: 'connected' }), 'radio');
    const alternate = connectionIconFor(
      descriptor({ id: 'another-mystery', icon: 'connected' }),
      'radio',
      new Set([first]),
    );

    expect(stable).toBe(first);
    expect(alternate).not.toBe(first);
  });
});

describe('pluginIconTone', () => {
  test('maps known icons to fixed accents', () => {
    expect(pluginIconTone(descriptor({ id: 'a' }), 'audio')).toBe('red');
    expect(pluginIconTone(descriptor({ id: 'a' }), 'keyboard')).toBe('teal');
    expect(pluginIconTone(descriptor({ id: 'a' }), 'voice')).toBe('purple');
    expect(pluginIconTone(descriptor({ id: 'a' }), 'format')).toBe('slate');
  });

  test('hashes unmapped icons deterministically per plugin id', () => {
    const first = pluginIconTone(descriptor({ id: 'some.plugin' }), 'dice');
    const second = pluginIconTone(descriptor({ id: 'some.plugin' }), 'dice');
    expect(first).toBe(second);
    expect(['red', 'teal', 'purple', 'cyan', 'amber', 'slate']).toContain(first);
    // A different id may land on a different tone, but always a valid one.
    const other = pluginIconTone(descriptor({ id: 'other.plugin' }), 'dice');
    expect(['red', 'teal', 'purple', 'cyan', 'amber', 'slate']).toContain(other);
  });
});

describe('pluginTags', () => {
  test('declared tags win and are capped', () => {
    const tags = pluginTags(descriptor({ tags: ['a', 'b', 'c', 'd', 'e'] }), []);
    expect(tags).toEqual(['a', 'b', 'c', 'd']);
  });

  test('derives action tags in manifest order without duplicates', () => {
    const entry = descriptor({ actionTypeIds: ['one', 'two', 'three'] });
    const tags = pluginTags(entry, [action('one', 'TTS'), action('two', 'tts'), action('three', 'Chat')]);
    expect(tags).toEqual(['tts', 'chat']);
  });

  test('adds an events hint for trigger-only plugins', () => {
    const entry = descriptor({ eventTypeIds: ['hotkey.pressed'] });
    expect(pluginTags(entry, [])).toEqual(['events']);
  });

  test('returns no chips when there is nothing to derive', () => {
    expect(pluginTags(descriptor(), [])).toEqual([]);
  });
});

describe('resolveActionTypeIcon', () => {
  test('declared registry names win', () => {
    expect(resolveActionTypeIcon({ id: 'minecraft.server.give-item', tag: 'minecraft', icon: 'gift' })).toBe('gift');
    expect(resolveActionTypeIcon({ id: 'minecraft.server.run-command', tag: 'minecraft', icon: 'terminal' })).toBe('terminal');
  });

  test('unknown names fall back instead of drawing a misleading glyph', () => {
    expect(resolveActionTypeIcon({ id: 'mystery.action', tag: 'mystery', icon: 'no-such-icon' })).toBe('plugin');
    expect(resolveActionTypeIcon({ id: 'mystery.action', tag: 'mystery' })).toBe('plugin');
    // Prototype keys never resolve to artwork either.
    expect(resolveActionTypeIcon({ id: 'x', tag: 'y', icon: '__proto__' })).toBe('plugin');
  });

  test('builtin tags and keyword heuristics predate the icon field', () => {
    expect(resolveActionTypeIcon({ id: 'core.fetch', tag: 'fetch' })).toBe('http');
    expect(resolveActionTypeIcon({ id: 'core.delay', tag: 'flow' })).toBe('play');
    expect(resolveActionTypeIcon({ id: 'audio.play', tag: 'audio' })).toBe('audio');
    expect(resolveActionTypeIcon({ id: 'sonicboom.server.speak', tag: 'tts' })).toBe('voice');
  });
});

describe('matchesActionTypeQuery', () => {
  const type: ActionTypeDefinition = {
    id: 'minecraft.server.spawn-mob',
    title: { default: 'Spawn Mob', i18key: 'x' },
    description: { default: 'Spawn a Minecraft entity.', i18key: 'x' },
    tag: 'minecraft',
    category: 'Mobs',
    icon: 'sparkles',
    source: { kind: 'plugin', pluginId: 'minecraft.server' },
    requiredCapabilities: [],
  };

  test('empty query matches everything', () => {
    expect(matchesActionTypeQuery('en', type, '  ')).toBe(true);
  });

  test('matches across title, description, tag, id, category, and plugin', () => {
    expect(matchesActionTypeQuery('en', type, 'spawn')).toBe(true);
    expect(matchesActionTypeQuery('en', type, 'ENTITY')).toBe(true);
    expect(matchesActionTypeQuery('en', type, 'minecraft')).toBe(true);
    expect(matchesActionTypeQuery('en', type, 'spawn-mob')).toBe(true);
    expect(matchesActionTypeQuery('en', type, 'mobs')).toBe(true);
    expect(matchesActionTypeQuery('en', type, 'minecraft.server')).toBe(true);
    expect(matchesActionTypeQuery('en', type, 'discord')).toBe(false);
  });

  test('every word must match somewhere', () => {
    expect(matchesActionTypeQuery('en', type, 'minecraft spawn')).toBe(true);
    expect(matchesActionTypeQuery('en', type, 'minecraft discord')).toBe(false);
  });

  test('older descriptors without icon or category still match', () => {
    const legacy: ActionTypeDefinition = {
      id: 'core.fetch',
      title: { default: 'Call a URL', i18key: 'x' },
      description: { default: 'POST event data.', i18key: 'x' },
      tag: 'fetch',
      source: { kind: 'builtin' },
      requiredCapabilities: [],
    };
    expect(matchesActionTypeQuery('en', legacy, 'call')).toBe(true);
    expect(matchesActionTypeQuery('en', legacy, 'fetch')).toBe(true);
    expect(resolveActionTypeIcon(legacy)).toBe('http');
  });
});

describe('matchesPluginQuery', () => {
  const plugin = status(
    descriptor({
      id: 'sonicboom.server',
      name: { default: 'SonicBoom Server', i18key: 'x' },
      description: { default: 'Speak chat through TTS.', i18key: 'x' },
      tags: ['tts', 'voice'],
    }),
  );

  test('empty query matches everything', () => {
    expect(matchesPluginQuery('en', plugin, [], '  ')).toBe(true);
  });

  test('matches across name, description, id, and tags', () => {
    expect(matchesPluginQuery('en', plugin, [], 'sonic')).toBe(true);
    expect(matchesPluginQuery('en', plugin, [], 'TTS')).toBe(true);
    expect(matchesPluginQuery('en', plugin, [], 'voice')).toBe(true);
    expect(matchesPluginQuery('en', plugin, [], 'speak chat')).toBe(true);
    expect(matchesPluginQuery('en', plugin, [], 'discord')).toBe(false);
  });

  test('every word must match somewhere', () => {
    expect(matchesPluginQuery('en', plugin, [], 'sonic discord')).toBe(false);
  });
});
