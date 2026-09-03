import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { PluginJsonObject, PluginJsonValue, StorageAPI } from './types.ts';

const STORAGE_VERSION = 1;
const MAX_STORAGE_BYTES = 4 * 1024 * 1024;
const KEY_PATTERN = /^[a-zA-Z0-9._-]{1,160}$/;

interface StorageFile {
  version: 1;
  values: PluginJsonObject;
}

export class PluginStorage implements StorageAPI {
  readonly #path: string;
  #loaded: Promise<StorageFile> | undefined;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(dataDirectory: string) {
    this.#path = join(dataDirectory, 'settings.json');
  }

  async get<TValue extends PluginJsonValue = PluginJsonValue>(key: string): Promise<TValue | undefined> {
    assertKey(key);
    const file = await this.#read();
    return file.values[key] as TValue | undefined;
  }

  async set<TValue extends PluginJsonValue = PluginJsonValue>(key: string, value: TValue): Promise<void> {
    assertKey(key);
    assertJsonValue(value);
    const file = await this.#read();
    file.values[key] = value;
    await this.#persist(file);
  }

  /** Reads every stored value. Used by the host settings UI; plugins keep using get/set. */
  async values(): Promise<PluginJsonObject> {
    const file = await this.#read();
    return { ...file.values };
  }

  async delete(key: string): Promise<void> {
    assertKey(key);
    const file = await this.#read();
    delete file.values[key];
    await this.#persist(file);
  }

  async clear(): Promise<void> {
    await this.#persist({ version: STORAGE_VERSION, values: {} });
  }

  async #read(): Promise<StorageFile> {
    this.#loaded ??= this.#load();
    return this.#loaded;
  }

  async #load(): Promise<StorageFile> {
    try {
      const info = await Bun.file(this.#path).stat();
      if (info.size > MAX_STORAGE_BYTES) throw new Error('Plugin storage exceeds the 4 MB limit.');
      const parsed = JSON.parse(await Bun.file(this.#path).text()) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Plugin storage is invalid.');
      const file = parsed as Partial<StorageFile>;
      if (file.version !== STORAGE_VERSION || !file.values || typeof file.values !== 'object' || Array.isArray(file.values)) {
        throw new Error('Plugin storage has an unsupported format.');
      }
      assertJsonValue(file.values as PluginJsonValue);
      return { version: STORAGE_VERSION, values: file.values as PluginJsonObject };
    } catch (error) {
      if (isMissingFile(error)) return { version: STORAGE_VERSION, values: {} };
      throw error;
    }
  }

  async #persist(file: StorageFile): Promise<void> {
    const serialized = JSON.stringify(file);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_STORAGE_BYTES) throw new Error('Plugin storage exceeds the 4 MB limit.');
    this.#writeQueue = this.#writeQueue.then(async () => {
      await mkdir(dirname(this.#path), { recursive: true });
      await writeFile(this.#path, serialized, 'utf8');
    });
    await this.#writeQueue;
    this.#loaded = Promise.resolve(file);
  }
}

function assertKey(key: string): void {
  if (!KEY_PATTERN.test(key)) throw new Error(`Invalid plugin storage key: ${key}`);
}

function assertJsonValue(value: unknown): asserts value is PluginJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return;
  if (Array.isArray(value)) {
    for (const entry of value) assertJsonValue(entry);
    return;
  }
  if (!value || typeof value !== 'object') throw new Error('Plugin storage values must be JSON-safe.');
  for (const entry of Object.values(value as Record<string, unknown>)) {
    if (entry !== undefined) assertJsonValue(entry);
  }
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error) && typeof error === 'object' && (error as { code?: string }).code === 'ENOENT';
}
