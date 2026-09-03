import { expect, test } from 'bun:test';

import { PluginTtsCapability } from './capabilities.ts';
import { TTSProviderRegistry } from './registries.ts';

function runtimeWith(provider: Parameters<TTSProviderRegistry['register']>[1]): PluginTtsCapability {
  const registry = new TTSProviderRegistry();
  registry.register('dev.example.tts', provider);
  return new PluginTtsCapability(registry);
}

test('listVoices maps provider voices to id/name pairs', async () => {
  const capability = runtimeWith({
    id: 'fixture-tts',
    name: 'Fixture TTS',
    async synthesize() { return {}; },
    async listVoices() {
      return [{ id: 'M1', name: 'Male 1' }, { id: 'F1' }, { id: '  ' }, null as never];
    },
  });
  expect(await capability.listVoices()).toEqual([{ id: 'M1', name: 'Male 1' }, { id: 'F1', name: undefined }]);
});

test('listVoices is empty without a provider or a voices method', async () => {
  expect(await new PluginTtsCapability(new TTSProviderRegistry()).listVoices()).toEqual([]);
  const capability = runtimeWith({
    id: 'fixture-tts',
    name: 'Fixture TTS',
    async synthesize() { return {}; },
  });
  expect(await capability.listVoices()).toEqual([]);
});

test('listVoices swallows provider failures', async () => {
  const capability = runtimeWith({
    id: 'fixture-tts',
    name: 'Fixture TTS',
    async synthesize() { return {}; },
    async listVoices() { throw new Error('server down'); },
  });
  expect(await capability.listVoices()).toEqual([]);
});
