import { describe, expect, test } from 'bun:test';

import type { AutomationEvent } from '../types.ts';
import { defaultActionConfig, normalizeActionConfig, resolveActionConfig, schemaForActionType } from './action-config.ts';
import { renderJsonTemplate } from './templates.ts';
import type { ActionTypeDefinition } from './types.ts';

const definition: ActionTypeDefinition = {
  id: 'test.schema-action',
  version: 1,
  title: { default: 'Schema action', i18key: 'test.schema-action.title' },
  description: { default: 'Test', i18key: 'test.schema-action.description' },
  tag: 'test',
  source: { kind: 'builtin' },
  configSchema: {
    type: 'object',
    required: ['url'],
    properties: {
      url: { type: 'string', title: { default: 'URL', i18key: 'test.schema-action.url' }, default: 'https://example.test' },
      retries: { type: 'integer', title: { default: 'Retries', i18key: 'test.schema-action.retries' }, default: 2, minimum: 0, maximum: 5 },
      enabled: { type: 'boolean', title: { default: 'Enabled', i18key: 'test.schema-action.enabled' }, default: true },
    },
  },
  requiredCapabilities: [],
};

const event: AutomationEvent = {
  id: 'evt-test',
  type: 'tiktok.chat',
  timestamp: 1,
  user: { uniqueId: 'luna', nickname: 'Luna' },
  data: { comment: 'hello' },
};

describe('JSON action configuration', () => {
  test('creates defaults from a JSON schema', () => {
    expect(defaultActionConfig(definition)).toEqual({ url: 'https://example.test', retries: 2, enabled: true });
    expect(schemaForActionType(definition).type).toBe('object');
  });

  test('validates required fields and numeric bounds', () => {
    expect(() => normalizeActionConfig(definition, { retries: 7 })).toThrow('Missing required action field: url');
    expect(() => normalizeActionConfig(definition, { url: 'https://example.test', retries: 7 })).toThrow('above the maximum');
    expect(normalizeActionConfig(definition, { url: 'https://example.test', retries: 3 })).toEqual({ url: 'https://example.test', retries: 3, enabled: true });
  });

  test('renders a template and parses the resulting JSON', () => {
    expect(renderJsonTemplate('{"viewer":"{{ event.user.uniqueId }}","count":2}', event)).toEqual({ viewer: 'luna', count: 2 });
    expect(() => renderJsonTemplate('{"viewer":"{{ event.user.uniqueId }}"', event)).toThrow('valid JSON');
  });

  test('resolves templated and JSON fields immediately before execution', () => {
    const pluginType: ActionTypeDefinition = {
      ...definition,
      id: 'test.runtime-action',
      uiHints: { fields: { url: { template: true }, body: { template: true } } },
      configSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', 'x-tiktools-template': true },
          body: { type: 'string', format: 'json' },
        },
      },
    };
    expect(resolveActionConfig(pluginType, { url: 'https://{{ event.user.uniqueId }}.test', body: '{"user":"{{ event.user.uniqueId }}"}' }, event)).toEqual({ url: 'https://luna.test', body: { user: 'luna' } });
  });
});
