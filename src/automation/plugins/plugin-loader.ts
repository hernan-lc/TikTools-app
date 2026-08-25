import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

import type { AutomationCapabilities } from '../capabilities.ts';
import type { NodeImplementation, NodeExecutionContext } from '../types.ts';
import { PluginCapabilityBroker } from './capability-broker.ts';
import {
  assertValidPluginManifest,
  type AutomationPluginManifest,
} from './manifest.ts';
import { PluginManager } from './plugin-manager.ts';
import { PluginWorkerHost } from './plugin-worker-host.ts';

const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

export interface PluginLoaderOptions {
  rootDirectory: string;
  manager: PluginManager;
  capabilities: AutomationCapabilities;
  log?: (message: string) => void;
  onLoaded?: (manifest: AutomationPluginManifest) => void;
  isInstalled?: (pluginId: string) => boolean | undefined;
}

export interface PluginLoadResult {
  directory: string;
  manifest?: AutomationPluginManifest;
  loaded: boolean;
  error?: string;
}

/**
 * Discovers only directory plugins with a manifest and always routes sandbox
 * entries through PluginWorkerHost. Trusted in-process plugins remain an
 * explicit host integration and are never loaded from this directory.
 */
export class AutomationPluginLoader {
  readonly #options: PluginLoaderOptions;
  readonly #workers = new Map<string, PluginWorkerHost>();
  readonly #discovered = new Map<string, { directory: string; manifest: AutomationPluginManifest }>();
  #loading: Promise<PluginLoadResult[]> | undefined;

  constructor(options: PluginLoaderOptions) {
    this.#options = options;
  }

  loadAll(): Promise<PluginLoadResult[]> {
    if (this.#loading) return this.#loading;
    const loading = this.#loadAll();
    this.#loading = loading;
    void loading.then(
      () => { if (this.#loading === loading) this.#loading = undefined; },
      () => { if (this.#loading === loading) this.#loading = undefined; },
    );
    return loading;
  }

  async #loadAll(): Promise<PluginLoadResult[]> {
    let entries;
    try {
      entries = await readdir(this.#options.rootDirectory, { withFileTypes: true });
    } catch (error) {
      if (isMissingPath(error)) return [];
      throw error;
    }

    const results: PluginLoadResult[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const directory = join(this.#options.rootDirectory, entry.name);
      try {
        results.push(await this.loadDirectory(directory));
      } catch (error) {
        const message = errorMessage(error);
        this.#options.log?.(`Plugin ${entry.name} was not loaded: ${message}`);
        results.push({ directory, loaded: false, error: message });
      }
    }
    return results;
  }

  async loadDirectory(directory: string): Promise<PluginLoadResult> {
    const resolvedDirectory = await realpath(directory);
    const manifestPath = join(resolvedDirectory, 'plugin.json');
    const manifest = await readManifest(manifestPath);
    this.#discovered.set(manifest.id, { directory: resolvedDirectory, manifest });
    if (this.#options.isInstalled?.(manifest.id) === false) {
      return { directory: resolvedDirectory, manifest, loaded: false };
    }
    if (manifest.executionMode !== 'sandbox') {
      throw new Error(`Plugin ${manifest.id} is trusted; install it through a host integration instead.`);
    }
    if (!manifest.entry) throw new Error(`Sandbox plugin ${manifest.id} must declare an entry file.`);
    const entryPath = await resolveContainedFile(resolvedDirectory, manifest.entry);
    const entryStats = await stat(entryPath);
    if (!entryStats.isFile()) throw new Error(`Plugin entry is not a file: ${manifest.entry}`);
    if (entryStats.size > MAX_SOURCE_BYTES) throw new Error(`Plugin ${manifest.id} entry exceeds the 2 MB limit.`);
    const source = await readFile(entryPath, 'utf8');
    const broker = new PluginCapabilityBroker({
      available: this.#options.capabilities,
      getManifest: (pluginId) => this.#options.manager.get(pluginId),
      fileRoot: resolvedDirectory,
    });
    const worker = new PluginWorkerHost({
      manifest,
      source,
      broker,
      log: (entry) => this.#options.log?.(`[${manifest.id}] ${entry.message}`),
    });

    try {
      const loaded = await worker.start();
      const nodes: NodeImplementation[] = loaded.nodes.map((definition) => ({
        definition,
        execute: (context: NodeExecutionContext) => worker.execute(context),
      }));
      const actions = loaded.actions;
      this.#options.manager.registerSandbox({ manifest, nodes, actions }, () => worker.stop());
      this.#workers.set(manifest.id, worker);
      this.#options.onLoaded?.(manifest);
    } catch (error) {
      await worker.stop();
      throw error;
    }

    return { directory: resolvedDirectory, manifest, loaded: true };
  }

  unload(pluginId: string): boolean {
    const unloaded = this.#options.manager.unregister(pluginId);
    this.#workers.delete(pluginId);
    return unloaded;
  }

  listDiscovered(): Array<{ directory: string; manifest: AutomationPluginManifest; loaded: boolean }> {
    return [...this.#discovered.values()]
      .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name))
      .map((entry) => ({ ...entry, loaded: this.#workers.has(entry.manifest.id) }));
  }

  directoryFor(pluginId: string): string | undefined {
    return this.#discovered.get(pluginId)?.directory;
  }

  async stopAll(): Promise<void> {
    try {
      await this.#loading;
    } catch {
      // Individual plugin failures are already returned/logged by loadAll.
    }
    const ids = [...this.#workers.keys()];
    for (const pluginId of ids) {
      await this.#options.manager.unregisterAsync(pluginId);
      this.#workers.delete(pluginId);
    }
  }
}

async function readManifest(path: string): Promise<AutomationPluginManifest> {
  const info = await stat(path);
  if (!info.isFile()) throw new Error('Plugin manifest is not a file.');
  if (info.size > MAX_MANIFEST_BYTES) throw new Error('Plugin manifest exceeds the 256 KB limit.');
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    throw new Error('Plugin manifest is not valid JSON.');
  }
  assertValidPluginManifest(value);
  return value;
}

async function resolveContainedFile(root: string, entry: string): Promise<string> {
  if (isAbsolute(entry)) throw new Error('Plugin entry must be relative to the plugin directory.');
  const candidate = await realpath(resolve(root, entry));
  const relativePath = relative(root, candidate);
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error('Plugin entry must remain inside the plugin directory.');
  }
  return candidate;
}

function isMissingPath(error: unknown): boolean {
  return Boolean(error) && typeof error === 'object' && (error as { code?: string }).code === 'ENOENT';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
