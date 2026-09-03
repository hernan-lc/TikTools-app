import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { PluginAudioCapability } from './capabilities.ts';
import { PluginInstaller } from './installer.ts';
import { isAppPluginManifest, satisfiesVersion } from './manifest.ts';
import { packagePlugin } from './packager.ts';
import { AudioProviderRegistry, TTSProviderRegistry } from './registries.ts';
import { PluginRuntime } from './runtime.ts';

describe('generic app plugin runtime', () => {
  test('loads a provider through dynamic import and scopes its APIs', async () => {
    const root = await mkdtemp(join(process.env.TEMP ?? process.cwd(), 'tiktools-app-plugin-'));
    const pluginDirectory = join(root, 'plugins', 'dev.example.provider');
    try {
      await mkdir(join(pluginDirectory, 'locales'), { recursive: true });
      await writeFile(join(pluginDirectory, 'plugin.json'), JSON.stringify({
        schemaVersion: 1,
        id: 'dev.example.provider',
        name: 'Provider fixture',
        version: '1.0.0',
        main: './index.js',
        host: { api: '^1.0.0' },
        type: 'audio',
        capabilities: ['audio.playback'],
        permissions: ['audio.output', 'commands.register'],
        i18n: { default: 'en', directory: './locales' },
      }));
      await writeFile(join(pluginDirectory, 'locales', 'en.json'), JSON.stringify({ settings: { title: 'Fixture settings' } }));
      await writeFile(join(pluginDirectory, 'index.js'), `
        export default {
          async activate(ctx) {
            await ctx.storage.set('ready', true);
            if (!ctx.audio || ctx.tts) throw new Error('Unexpected capability exposure');
            ctx.audio.registerProvider({
              id: 'fixture-audio',
              name: 'Fixture audio',
              capabilities: ['playback'],
              async play(file) { return { file, played: true }; },
            });
            ctx.commands.register('echo', (value) => value);
          },
        };
      `);

      const audioProviders = new AudioProviderRegistry();
      const runtime = new PluginRuntime({
        rootDirectory: join(root, 'plugins'),
        dataDirectory: join(root, 'data'),
        audioProviders,
        ttsProviders: new TTSProviderRegistry(),
      });
      const results = await runtime.loadAll();
      expect(results[0]?.loaded).toBe(true);
      expect(runtime.isActive('dev.example.provider')).toBe(true);
      expect(audioProviders.getProvider()?.id).toBe('fixture-audio');
      expect(await new PluginAudioCapability(audioProviders).playFile('hello.wav')).toEqual({ file: 'hello.wav', played: true });
      expect(await runtime.invoke('dev.example.provider', 'echo', { value: 42 })).toEqual({ value: 42 });
      expect(runtime.translationCatalog().en?.['dev.example.provider.settings.title']).toBe('Fixture settings');
      await runtime.unload('dev.example.provider');
      expect(audioProviders.getProvider()).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('reads and writes JSON-schema settings through shared storage', async () => {
    const root = await mkdtemp(join(process.env.TEMP ?? process.cwd(), 'tiktools-plugin-settings-'));
    const pluginDirectory = join(root, 'plugins', 'dev.example.settings');
    try {
      await mkdir(pluginDirectory, { recursive: true });
      await writeFile(join(pluginDirectory, 'plugin.json'), JSON.stringify({
        schemaVersion: 1,
        id: 'dev.example.settings',
        name: 'Settings fixture',
        version: '1.0.0',
        main: './index.js',
        host: { api: '^1.0.0' },
        capabilities: [],
        permissions: [],
        settings: {
          schema: {
            type: 'object',
            properties: {
              host: { type: 'string', default: '127.0.0.1' },
              port: { type: 'integer', default: 3000 },
            },
          },
        },
      }));
      await writeFile(join(pluginDirectory, 'index.js'), `
        export default {
          async activate(ctx) {
            await ctx.storage.set('port', 4000);
          },
        };
      `);

      const runtime = new PluginRuntime({
        rootDirectory: join(root, 'plugins'),
        dataDirectory: join(root, 'data'),
        audioProviders: new AudioProviderRegistry(),
        ttsProviders: new TTSProviderRegistry(),
      });
      const results = await runtime.loadAll();
      expect(results[0]?.loaded).toBe(true);
      // Defaults merge over stored values; the plugin wrote port 4000 on activate.
      expect(await runtime.readSettings('dev.example.settings')).toEqual({ host: '127.0.0.1', port: 4000 });
      // String numbers coerce; undeclared keys are dropped.
      expect(await runtime.writeSettings('dev.example.settings', { port: '5000', extra: true }))
        .toEqual({ host: '127.0.0.1', port: 5000 });
      await expect(runtime.writeSettings('dev.example.settings', { port: 'not-a-port' })).rejects.toThrow();
      await expect(runtime.readSettings('dev.example.unknown')).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('validates host ranges and rejects paths outside the package', () => {
    expect(satisfiesVersion('1.4.0', '^1.0.0')).toBe(true);
    expect(satisfiesVersion('2.0.0', '^1.0.0')).toBe(false);
    expect(isAppPluginManifest({
      schemaVersion: 1,
      id: 'dev.example.invalid',
      name: 'Invalid',
      version: '1.0.0',
      main: '../outside.js',
      host: { api: '^1.0.0' },
      capabilities: [],
      permissions: [],
    })).toBe(false);
  });
});

describe('plugin package installation', () => {
  test('packages checksums and installs atomically from a .plugin archive', async () => {
    const root = await mkdtemp(join(process.env.TEMP ?? process.cwd(), 'tiktools-plugin-package-'));
    const source = join(root, 'source');
    const staging = join(root, 'staging');
    const output = join(root, 'fixture.plugin');
    const installed = join(root, 'installed');
    try {
      await mkdir(source, { recursive: true });
      await writeFile(join(source, 'plugin.json'), JSON.stringify({
        schemaVersion: 1,
        id: 'dev.example.package',
        name: 'Package fixture',
        version: '1.0.0',
        main: './index.js',
        host: { api: '^1.0.0' },
        capabilities: [],
        permissions: [],
      }));
      await writeFile(join(source, 'index.js'), 'export default { activate() {} };');
      const packaged = await packagePlugin({ sourceDirectory: source, outputFile: output, stagingDirectory: staging });
      expect(packaged.manifest.id).toBe('dev.example.package');
      const result = await new PluginInstaller({
        pluginDirectory: installed,
        stagingDirectory: staging,
      }).install(packaged.outputFile);
      expect(result.manifest.id).toBe('dev.example.package');
      expect(await Bun.file(join(result.directory, 'checksums.json')).exists()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
