import type { AudioCapability, TtsCapability } from '../automation/capabilities.ts';
import type { JsonObject } from '../automation/types.ts';
import type { AudioPlayOptions, TTSRequest } from './types.ts';
import { AudioProviderRegistry, TTSProviderRegistry } from './registries.ts';

/** Adapts the generic provider registry to the existing automation contracts. */
export class PluginAudioCapability implements AudioCapability {
  constructor(private readonly registry: AudioProviderRegistry) {}

  async playFile(path: string, options?: AudioPlayOptions): Promise<JsonObject> {
    const provider = this.registry.getPlaybackProvider();
    if (!provider) throw new Error('No audio provider is active. Install and enable an audio plugin.');
    return await provider.play(path, options) as JsonObject;
  }

  stopAll(): void {
    void this.registry.stopAll().catch(() => undefined);
  }
}

export class PluginTtsCapability implements TtsCapability {
  constructor(private readonly registry: TTSProviderRegistry) {}

  async synthesize(text: string, options: JsonObject = {}): Promise<JsonObject> {
    const provider = this.registry.getProvider();
    if (!provider) throw new Error('No TTS provider is active. Install and enable a TTS plugin.');
    const request: TTSRequest = {
      text,
      voice: typeof options.voice === 'string' ? options.voice : undefined,
      model: typeof options.model === 'string' ? options.model : undefined,
      language: typeof options.language === 'string' ? options.language : undefined,
      lang: typeof options.lang === 'string' ? options.lang : undefined,
      speed: typeof options.speed === 'number' ? options.speed : undefined,
      format: normalizeFormat(options.format),
    };
    return await provider.synthesize(request) as JsonObject;
  }

  async listVoices(): Promise<Array<{ id: string; name?: string }>> {
    const provider = this.registry.getProvider();
    if (!provider?.listVoices) return [];
    try {
      const voices = await provider.listVoices();
      return voices
        .filter((voice) => voice && typeof voice.id === 'string' && voice.id.trim())
        .slice(0, 100)
        .map((voice) => ({ id: voice.id, name: typeof voice.name === 'string' ? voice.name : undefined }));
    } catch {
      return [];
    }
  }
}

function normalizeFormat(value: unknown): TTSRequest['format'] {
  if (value === 'wav' || value === 'mp3' || value === 'ogg' || value === 'flac' || value === 'opus') return value;
  return undefined;
}
