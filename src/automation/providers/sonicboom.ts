import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { TtsCapability } from '../capabilities.ts';
import type { JsonObject } from '../types.ts';
import { ensureAppPaths } from '../../platform/app-paths.ts';

export interface SonicBoomOptions {
  command?: string;
  args?: string[];
  cwd?: string;
  baseUrl?: string;
  token?: string;
  startupTimeoutMs?: number;
  outputDirectory?: string;
}

/**
 * Trusted host provider for the current SonicBoom HTTP server. The process is
 * owned by TikTools, while plugin code only receives the returned audio path.
 */
export class SonicBoomProvider implements TtsCapability {
  readonly #options: Required<Pick<SonicBoomOptions, 'command' | 'baseUrl' | 'startupTimeoutMs'>> & SonicBoomOptions;
  #process: Bun.Subprocess | undefined;

  constructor(options: SonicBoomOptions = {}) {
    this.#options = {
      command: options.command ?? 'SonicBoom',
      baseUrl: (options.baseUrl ?? 'http://127.0.0.1:3000').replace(/\/$/, ''),
      startupTimeoutMs: options.startupTimeoutMs ?? 30_000,
      ...options,
    };
  }

  async start(): Promise<void> {
    if (this.#process) return;
    const command = this.#options.command;
    this.#process = Bun.spawn([command, ...(this.#options.args ?? [])], {
      cwd: this.#options.cwd,
      stdout: 'ignore',
      stderr: 'pipe',
      windowsHide: true,
    });

    const deadline = Date.now() + this.#options.startupTimeoutMs;
    let failure: Error | undefined;
    while (Date.now() < deadline) {
      try {
        const status = await this.health();
        if (status.status === 'ready') return;
        if (status.status === 'failed') {
          failure = new Error(typeof status.error === 'string' ? status.error : 'SonicBoom model failed to load.');
          break;
        }
      } catch {
        // SonicBoom may need time to load its model and bind the port.
      }
      await wait(250);
    }

    await this.stop();
    if (failure) throw failure;
    throw new Error(`SonicBoom did not become ready at ${this.#options.baseUrl}.`);
  }

  async health(): Promise<JsonObject> {
    const response = await fetch(`${this.#options.baseUrl}/api/status`);
    const body = await response.json() as unknown;
    if (!response.ok || !body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error(`SonicBoom health check failed with HTTP ${response.status}.`);
    }
    return body as JsonObject;
  }

  async synthesize(text: string, options: JsonObject = {}): Promise<JsonObject> {
    if (!text.trim()) throw new Error('TTS text cannot be empty.');
    if (!this.#process) await this.start();

    const voice = typeof options.voice === 'string' ? options.voice : 'M1';
    const lang = typeof options.lang === 'string' ? options.lang : 'en';
    const requestedFormat = typeof options.format === 'string' ? options.format.toLowerCase() : 'wav';
    const format = ['wav', 'mp3', 'flac', 'opus'].includes(requestedFormat) ? requestedFormat : 'wav';
    const query = new URLSearchParams({ voice, lang, format });
    const headers: Record<string, string> = { 'content-type': 'text/plain; charset=utf-8' };
    if (this.#options.token) headers.authorization = `Bearer ${this.#options.token}`;

    const response = await fetch(`${this.#options.baseUrl}/api/tts?${query.toString()}`, {
      method: 'POST',
      headers,
      body: text.trim(),
    });
    if (!response.ok) throw new Error(`SonicBoom TTS failed with HTTP ${response.status}: ${await response.text()}`);

    const bytes = new Uint8Array(await response.arrayBuffer());
    const outputDirectory = this.#options.outputDirectory ?? join(ensureAppPaths().temp, 'automation-audio');
    await mkdir(outputDirectory, { recursive: true });
    const path = join(outputDirectory, `tts-${Date.now()}-${Math.random().toString(36).slice(2)}.${format}`);
    await Bun.write(path, bytes);
    return { path, format, bytes: bytes.byteLength };
  }

  async stop(): Promise<void> {
    const process = this.#process;
    this.#process = undefined;
    if (!process) return;
    process.kill();
    await process.exited.catch(() => undefined);
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
