import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { AppPlugin, PluginContext, TTSProvider, TTSVoice } from '../../../sdk/plugin-api/index.ts';
import { buildBaseUrl, parseVoices } from './settings.ts';

const plugin: AppPlugin = {
  async activate(ctx: PluginContext): Promise<void> {
    if (!ctx.tts) throw new Error('SonicBoom requires the tts.output permission.');
    let child: Bun.Subprocess | undefined;
    // Settings are read on every use, so the Plugins UI applies without a restart.
    const baseUrl = async (): Promise<string> => buildBaseUrl(
      await ctx.storage.get('host'),
      await ctx.storage.get('port'),
    );

    const stop = async (): Promise<void> => {
      const processHandle = child;
      child = undefined;
      if (!processHandle) return;
      processHandle.kill();
      await processHandle.exited.catch(() => undefined);
    };
    const health = async (): Promise<Record<string, unknown>> => {
      const response = await fetch(`${await baseUrl()}/api/status`);
      const body = await response.json() as unknown;
      if (!response.ok || !body || typeof body !== 'object' || Array.isArray(body)) {
        throw new Error(`SonicBoom health check failed with HTTP ${response.status}.`);
      }
      return body as Record<string, unknown>;
    };
    const start = async (): Promise<void> => {
      if (child) return;
      child = Bun.spawn(['SonicBoom'], { stdout: 'ignore', stderr: 'pipe', windowsHide: true });
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        try {
          const status = await health();
          if (status.status === 'ready') return;
          if (status.status === 'failed') throw new Error(String(status.error ?? 'SonicBoom model failed to load.'));
        } catch {
          // The model may need time to load before the endpoint is ready.
        }
        await wait(250);
      }
      await stop();
      throw new Error(`SonicBoom did not become ready at ${await baseUrl()}.`);
    };
    const listVoices = async (): Promise<TTSVoice[]> => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5_000);
        try {
          const response = await fetch(`${await baseUrl()}/v1/voices`, { signal: controller.signal });
          if (!response.ok) return [];
          return parseVoices(await response.json() as unknown);
        } finally {
          clearTimeout(timeout);
        }
      } catch {
        return [];
      }
    };
    const provider: TTSProvider = {
      id: 'sonicboom',
      name: 'SonicBoom',
      priority: 10,
      async synthesize(request) {
        const text = request.text.trim();
        if (!text) throw new Error('TTS text cannot be empty.');
        await start();
        const url = await baseUrl();
        const format = ['wav', 'mp3', 'flac', 'opus'].includes(request.format ?? '') ? request.format : 'wav';
        const query = new URLSearchParams({ voice: request.voice ?? 'M1', lang: request.language ?? request.lang ?? 'en', format });
        const response = await fetch(`${url}/api/tts?${query}`, { method: 'POST', headers: { 'content-type': 'text/plain; charset=utf-8' }, body: text });
        if (!response.ok) throw new Error(`SonicBoom TTS failed with HTTP ${response.status}: ${await response.text()}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const outputDirectory = join(ctx.plugin.dataDir, 'audio');
        await mkdir(outputDirectory, { recursive: true });
        const path = join(outputDirectory, `tts-${Date.now()}-${Math.random().toString(36).slice(2)}.${format}`);
        await Bun.write(path, bytes);
        return { path, format, bytes: bytes.byteLength };
      },
      listVoices,
      stop,
    };
    ctx.tts.registerProvider(provider);
    ctx.logger.info('SonicBoom provider activated.');
  },
};

export default plugin;

function wait(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
