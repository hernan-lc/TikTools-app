import { expect, test } from 'bun:test';

import { isAppPluginManifest } from './manifest.ts';

function baseManifest(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'tts.sonicboom',
    name: 'SonicBoom',
    version: '1.0.0',
    main: './dist/plugin.js',
    host: { api: '^1.0.0' },
    capabilities: ['tts.synthesis'],
    permissions: ['tts.output'],
  };
}

function settingsManifest(settings: unknown): Record<string, unknown> {
  return { ...baseManifest(), settings };
}

test('manifest without settings stays valid', () => {
  expect(isAppPluginManifest(baseManifest())).toBe(true);
});

test('manifest accepts a small settings schema', () => {
  expect(isAppPluginManifest(settingsManifest({
    schema: {
      type: 'object',
      properties: {
        host: { type: 'string', title: 'Host', default: '127.0.0.1' },
        port: { type: 'integer', title: { default: 'Port', i18key: 'tts.sonicboom.settings.port.label' }, default: 3000 },
      },
    },
  }))).toBe(true);
});

test('manifest rejects settings without an object schema', () => {
  expect(isAppPluginManifest(settingsManifest({ schema: { type: 'string' } }))).toBe(false);
  expect(isAppPluginManifest(settingsManifest({}))).toBe(false);
  expect(isAppPluginManifest(settingsManifest({ schema: { type: 'object', properties: {} } }))).toBe(false);
});

test('manifest rejects unknown setting types and bad defaults', () => {
  expect(isAppPluginManifest(settingsManifest({
    schema: { type: 'object', properties: { pick: { type: 'file' } } },
  }))).toBe(false);
  expect(isAppPluginManifest(settingsManifest({
    schema: { type: 'object', properties: { port: { type: 'integer', default: '3000' } } },
  }))).toBe(false);
});

test('manifest rejects oversized settings blocks', () => {
  const properties: Record<string, unknown> = {};
  for (let index = 0; index < 40; index += 1) properties[`key${index}`] = { type: 'string' };
  expect(isAppPluginManifest(settingsManifest({ schema: { type: 'object', properties } }))).toBe(false);
});
