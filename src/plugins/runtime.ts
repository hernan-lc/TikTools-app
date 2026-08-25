import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { isAbsolute, join, relative, resolve } from 'node:path';

import {
  isAppPluginManifest,
  isSafeRelativePath,
  readAppPluginManifest,
  resolvePluginPath,
  type AppPluginManifest,
} from './manifest.ts';
import { AudioProviderRegistry, TTSProviderRegistry } from './registries.ts';
import { PluginStorage } from './storage.ts';
import type {
  AppPlugin,
  AudioAPI,
  AudioProvider,
  CommandAPI,
  Disposable,
  EventAPI,
  I18nAPI,
  LoggerAPI,
  PluginContext,
  PluginJsonObject,
  PluginJsonValue,
  PluginModule,
  StorageAPI,
  TTSAPI,
  TTSProvider,
  UIAPI,
  UISettingsPanel,
} from './types.ts';

const MAX_LOCALE_BYTES = 256 * 1024;
const MAX_LOCALE_KEYS = 4_096;
const LOCALE_PATTERN = /^[a-z]{2}(?:-[A-Z]{2})?$/;

export type PluginSource = 'builtin' | 'user';
export type PluginState = 'installed' | 'loading' | 'active' | 'disabled' | 'error';

export interface InstalledPlugin {
  id: string;
  version: string;
  directory: string;
  source: PluginSource;
  state: PluginState;
  manifest: AppPluginManifest;
  error?: string;
}

export interface PluginLoadResult {
  directory: string;
  manifest?: AppPluginManifest;
  loaded: boolean;
  error?: string;
}

export interface PluginRuntimeOptions {
  /** User-installed plugins are kept outside the application binary. */
  rootDirectory: string;
  /** Optional reviewed plugins shipped beside the application. */
  builtinDirectory?: string;
  dataDirectory: string;
  hostApiVersion?: string;
  uiApiVersion?: string;
  audioProviders: AudioProviderRegistry;
  ttsProviders: TTSProviderRegistry;
  locale?: () => string;
  isEnabled?: (pluginId: string) => boolean;
  log?: (message: string) => void;
  onLoaded?: (manifest: AppPluginManifest) => void;
  onUnloaded?: (manifest: AppPluginManifest) => void;
}

interface DiscoveredEntry {
  directory: string;
  source: PluginSource;
  manifest: AppPluginManifest;
  state: PluginState;
  error?: string;
}

interface PluginContextState {
  context: PluginContext;
  plugin?: AppPlugin;
  disposables: Disposable[];
}

interface RegisteredCommand {
  owner: string;
  handler: (params: PluginJsonValue) => PluginJsonValue | Promise<PluginJsonValue>;
}

interface RegisteredPanel extends UISettingsPanel {
  owner: string;
  absoluteEntry: string;
}

type EventHandler = (payload: PluginJsonValue) => void | Promise<void>;

/** Small, host-owned command registry. Command ids are always plugin-scoped. */
class PluginCommandRegistry {
  readonly #commands = new Map<string, RegisteredCommand>();

  register(owner: string, name: string, handler: RegisteredCommand['handler']): Disposable {
    const id = scopedName(owner, name, 'command');
    if (this.#commands.has(id)) throw new Error(`Command is already registered: ${id}`);
    const entry = { owner, handler };
    this.#commands.set(id, entry);
    return { dispose: () => { if (this.#commands.get(id) === entry) this.#commands.delete(id); } };
  }

  async invoke(owner: string, name: string, params: PluginJsonValue = {}): Promise<PluginJsonValue> {
    const id = scopedName(owner, name, 'command');
    const entry = this.#commands.get(id);
    if (!entry) throw new Error(`Unknown plugin command: ${id}`);
    return entry.handler(params);
  }

  unregisterOwner(owner: string): void {
    for (const [id, entry] of this.#commands) if (entry.owner === owner) this.#commands.delete(id);
  }
}

class PluginEventRegistry {
  readonly #subscriptions = new Map<string, Array<{ owner: string; handler: EventHandler }>>();

  subscribe(owner: string, event: string, handler: EventHandler): Disposable {
    validateEventName(event);
    const subscribers = this.#subscriptions.get(event) ?? [];
    const entry = { owner, handler };
    subscribers.push(entry);
    this.#subscriptions.set(event, subscribers);
    return {
      dispose: () => {
        const current = this.#subscriptions.get(event);
        if (!current) return;
        const index = current.indexOf(entry);
        if (index >= 0) current.splice(index, 1);
        if (current.length === 0) this.#subscriptions.delete(event);
      },
    };
  }

  publish(event: string, payload: PluginJsonValue): void {
    validateEventName(event);
    for (const { handler } of [...(this.#subscriptions.get(event) ?? [])]) {
      try {
        void Promise.resolve(handler(payload)).catch(() => undefined);
      } catch {
        // An event subscriber must never break the publisher.
      }
    }
  }

  unregisterOwner(owner: string): void {
    for (const [event, subscribers] of this.#subscriptions) {
      const remaining = subscribers.filter((entry) => entry.owner !== owner);
      if (remaining.length === 0) this.#subscriptions.delete(event);
      else this.#subscriptions.set(event, remaining);
    }
  }
}

class PluginUIRegistry {
  readonly #panels = new Map<string, RegisteredPanel>();

  register(owner: string, rootDirectory: string, panel: UISettingsPanel): Disposable {
    if (!/^[a-z0-9][a-z0-9._-]{1,127}$/.test(panel.id)) throw new Error(`Invalid plugin UI id: ${panel.id}`);
    if (!panel.title.trim() || !isSafeRelativePath(panel.entry)) throw new Error(`Invalid plugin UI panel: ${panel.id}`);
    const absoluteEntry = resolve(rootDirectory, panel.entry);
    const remainder = relativePath(rootDirectory, absoluteEntry);
    if (!remainder || remainder.startsWith('..') || isAbsolute(remainder)) {
      throw new Error(`Plugin UI entry must remain inside the plugin directory: ${panel.entry}`);
    }
    const id = `${owner}.${panel.id}`;
    if (this.#panels.has(id)) throw new Error(`Plugin UI panel is already registered: ${id}`);
    const entry = { ...panel, owner, absoluteEntry };
    this.#panels.set(id, entry);
    return { dispose: () => { if (this.#panels.get(id) === entry) this.#panels.delete(id); } };
  }

  unregisterOwner(owner: string): void {
    for (const [id, panel] of this.#panels) if (panel.owner === owner) this.#panels.delete(id);
  }

  list(): RegisteredPanel[] { return [...this.#panels.values()].map((panel) => ({ ...panel })); }
}

export class PluginRuntime {
  readonly #options: PluginRuntimeOptions;
  readonly #entries = new Map<string, DiscoveredEntry>();
  readonly #contexts = new Map<string, PluginContextState>();
  readonly #commands = new PluginCommandRegistry();
  readonly #events = new PluginEventRegistry();
  readonly #ui = new PluginUIRegistry();
  #loading: Promise<PluginLoadResult[]> | undefined;

  constructor(options: PluginRuntimeOptions) {
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
    await this.discover();
    const results: PluginLoadResult[] = [];
    for (const entry of [...this.#entries.values()].sort((left, right) => left.manifest.name.localeCompare(right.manifest.name))) {
      if (this.#options.isEnabled?.(entry.manifest.id) === false) {
        entry.state = 'disabled';
        results.push({ directory: entry.directory, manifest: entry.manifest, loaded: false });
        continue;
      }
      results.push(await this.#loadEntry(entry));
    }
    return results;
  }

  async discover(): Promise<InstalledPlugin[]> {
    const directories: Array<{ directory: string; source: PluginSource }> = [
      ...(this.#options.builtinDirectory ? [{ directory: this.#options.builtinDirectory, source: 'builtin' as const }] : []),
      { directory: this.#options.rootDirectory, source: 'user' },
    ];
    for (const root of directories) {
      let entries;
      try {
        entries = await readdir(root.directory, { withFileTypes: true });
      } catch (error) {
        if (isMissingPath(error)) continue;
        throw error;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const directory = join(root.directory, entry.name);
        let discovered: DiscoveredEntry | undefined;
        try {
          discovered = await this.#readEntry(directory, root.source);
        } catch (error) {
          this.#options.log?.(`Plugin ${entry.name} was not discovered: ${errorMessage(error)}`);
          continue;
        }
        if (!discovered) continue;
        const current = this.#entries.get(discovered.manifest.id);
        // A user package intentionally overrides a bundled package with the same id.
        if (current && current.source === 'user' && discovered.source === 'builtin') continue;
        if (current?.state === 'active') await this.unload(current.manifest.id);
        this.#entries.set(discovered.manifest.id, discovered);
      }
    }
    return this.list();
  }

  async loadDirectory(directory: string): Promise<PluginLoadResult> {
    const source: PluginSource = isPathWithin(this.#options.builtinDirectory, directory) ? 'builtin' : 'user';
    const discovered = await this.#readEntry(directory, source);
    if (!discovered) return { directory, loaded: false };
    const current = this.#entries.get(discovered.manifest.id);
    if (current?.state === 'active') return { directory: current.directory, manifest: current.manifest, loaded: true };
    this.#entries.set(discovered.manifest.id, discovered);
    if (this.#options.isEnabled?.(discovered.manifest.id) === false) {
      discovered.state = 'disabled';
      return { directory: discovered.directory, manifest: discovered.manifest, loaded: false };
    }
    return this.#loadEntry(discovered);
  }

  async #readEntry(directory: string, source: PluginSource): Promise<DiscoveredEntry | undefined> {
    const resolvedDirectory = await realpath(directory);
    const manifestPath = join(resolvedDirectory, 'plugin.json');
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown;
    } catch (error) {
      if (isMissingPath(error)) return undefined;
      throw new Error(`Plugin manifest could not be read in ${directory}.`);
    }
    // The automation worker has a separate manifest contract. Do not make the
    // two loaders fight over the same plugins directory.
    if (!isAppPluginManifest(raw)) return undefined;
    const manifest = await readAppPluginManifest(manifestPath, {
      hostApiVersion: this.#options.hostApiVersion,
      uiApiVersion: this.#options.uiApiVersion,
    });
    return { directory: resolvedDirectory, source, manifest, state: 'installed' };
  }

  async #loadEntry(entry: DiscoveredEntry): Promise<PluginLoadResult> {
    if (entry.state === 'active') return { directory: entry.directory, manifest: entry.manifest, loaded: true };
    entry.state = 'loading';
    try {
      if (entry.manifest.isolation && entry.manifest.isolation !== 'trusted') {
        throw new Error(`Plugin ${entry.manifest.id} requests ${entry.manifest.isolation} isolation; this runtime currently loads trusted plugins only.`);
      }
      const entryPath = await resolvePluginPath(entry.directory, entry.manifest.main, 'Plugin entry');
      const info = await stat(entryPath);
      if (!info.isFile()) throw new Error(`Plugin entry is not a file: ${entry.manifest.main}`);
      if (info.size > 8 * 1024 * 1024) throw new Error(`Plugin ${entry.manifest.id} entry exceeds the 8 MB limit.`);
      await validateOptionalFile(entry.directory, entry.manifest.ui?.entry, 'Plugin UI entry');
      await validateOptionalFile(entry.directory, entry.manifest.assets?.icon, 'Plugin icon');
      const module = await import(`${pathToFileURL(entryPath).href}?plugin=${encodeURIComponent(entry.manifest.version)}`) as PluginModule;
      const plugin = normalizePlugin(module);
      const contextState = await this.#createContext(entry);
      contextState.plugin = plugin;
      try {
        await plugin.activate(contextState.context);
      } catch (error) {
        await disposeContext(entry.manifest.id, contextState, this.#options);
        throw error;
      }
      this.#contexts.set(entry.manifest.id, contextState);
      entry.state = 'active';
      entry.error = undefined;
      try { this.#options.onLoaded?.(entry.manifest); } catch (error) {
        this.#options.log?.(`Plugin ${entry.manifest.id} load notification failed: ${errorMessage(error)}`);
      }
      return { directory: entry.directory, manifest: entry.manifest, loaded: true };
    } catch (error) {
      entry.state = 'error';
      entry.error = errorMessage(error);
      this.#options.log?.(`Plugin ${entry.manifest.id} was not loaded: ${entry.error}`);
      return { directory: entry.directory, manifest: entry.manifest, loaded: false, error: entry.error };
    }
  }

  async #createContext(entry: DiscoveredEntry): Promise<PluginContextState> {
    const manifest = entry.manifest;
    const dataDirectory = join(this.#options.dataDirectory, manifest.id);
    const disposables: Disposable[] = [];
    const logger = createLogger(manifest.id, this.#options.log);
    const storage = new PluginStorage(dataDirectory);
    const commands: CommandAPI = {
      register: (name, handler) => {
        requirePermission(manifest, 'commands.register');
        const disposable = this.#commands.register(manifest.id, name, handler as unknown as RegisteredCommand['handler']);
        disposables.push(disposable);
        return disposable;
      },
    };
    const events: EventAPI = {
      subscribe: (event, handler) => {
        requirePermission(manifest, 'events.subscribe');
        const disposable = this.#events.subscribe(manifest.id, event, handler as EventHandler);
        disposables.push(disposable);
        return disposable;
      },
      publish: (event, payload) => {
        requirePermission(manifest, 'events.publish');
        this.#events.publish(event, payload);
      },
    };
    const ui: UIAPI = {
      registerSettingsPanel: (panel) => {
        requirePermission(manifest, 'ui.settings');
        const disposable = this.#ui.register(manifest.id, entry.directory, panel);
        disposables.push(disposable);
        return disposable;
      },
    };
    const context: PluginContext = {
      plugin: { id: manifest.id, version: manifest.version, dataDir: dataDirectory },
      logger,
      commands,
      events,
      storage,
      ui,
      i18n: await createI18n(entry.directory, manifest, this.#options.locale?.() ?? 'en'),
    };

    if (hasAudioPermission(manifest)) {
      const audio: AudioAPI = {
        registerProvider: (provider) => {
          for (const capability of provider.capabilities) requireCapability(manifest, `audio.${capability}`);
          const disposable = this.#options.audioProviders.register(manifest.id, provider);
          disposables.push(disposable);
          return disposable;
        },
      };
      context.audio = audio;
    }
    if (hasTtsPermission(manifest)) {
      const tts: TTSAPI = {
        registerProvider: (provider) => {
          requireCapability(manifest, 'tts.synthesis');
          const disposable = this.#options.ttsProviders.register(manifest.id, provider);
          disposables.push(disposable);
          return disposable;
        },
      };
      context.tts = tts;
    }

    return { context, disposables };
  }

  async unload(pluginId: string): Promise<boolean> {
    const entry = this.#entries.get(pluginId);
    if (!entry) return false;
    const state = this.#contexts.get(pluginId);
    if (state) {
      try {
        await state.plugin?.deactivate?.();
      } finally {
        await disposeContext(pluginId, state, this.#options);
        this.#contexts.delete(pluginId);
      }
      try { this.#options.onUnloaded?.(entry.manifest); } catch (error) {
        this.#options.log?.(`Plugin ${entry.manifest.id} unload notification failed: ${errorMessage(error)}`);
      }
    }
    entry.state = this.#options.isEnabled?.(pluginId) === false ? 'disabled' : 'installed';
    entry.error = undefined;
    return true;
  }

  async setEnabled(pluginId: string, enabled: boolean): Promise<PluginLoadResult | undefined> {
    const entry = this.#entries.get(pluginId);
    if (!entry) return undefined;
    if (!enabled) {
      await this.unload(pluginId);
      entry.state = 'disabled';
      return { directory: entry.directory, manifest: entry.manifest, loaded: false };
    }
    return this.#loadEntry(entry);
  }

  async invoke(pluginId: string, command: string, params: PluginJsonValue = {}): Promise<PluginJsonValue> {
    if (!this.#contexts.has(pluginId)) throw new Error(`Plugin is not active: ${pluginId}`);
    return this.#commands.invoke(pluginId, command, params);
  }

  /** Delivers a host-owned event to plugins that declared events.subscribe. */
  publishHostEvent(event: string, payload: PluginJsonValue): void {
    this.#events.publish(event, payload);
  }

  isDiscovered(pluginId: string): boolean { return this.#entries.has(pluginId); }
  isActive(pluginId: string): boolean { return this.#contexts.has(pluginId); }
  directoryFor(pluginId: string): string | undefined { return this.#entries.get(pluginId)?.directory; }

  list(): InstalledPlugin[] {
    return [...this.#entries.values()]
      .sort((left, right) => left.manifest.name.localeCompare(right.manifest.name))
      .map((entry) => ({
        id: entry.manifest.id,
        version: entry.manifest.version,
        directory: entry.directory,
        source: entry.source,
        state: entry.state,
        manifest: entry.manifest,
        error: entry.error,
      }));
  }

  translationCatalog(): Record<string, Record<string, string>> {
    const result: Record<string, Record<string, string>> = {};
    for (const [pluginId, state] of this.#contexts) {
      for (const [locale, entries] of Object.entries(state.context.i18n.catalog)) {
        const target = result[locale] ?? (result[locale] = {});
        for (const [key, value] of Object.entries(entries)) {
          const namespaced = `${pluginId}.${key}`;
          if (target[namespaced] === undefined) target[namespaced] = value;
        }
      }
    }
    return result;
  }

  panels(): Array<RegisteredPanel> { return this.#ui.list(); }

  async stopAll(): Promise<void> {
    try { await this.#loading; } catch { /* individual failures are reported in results */ }
    for (const pluginId of [...this.#contexts.keys()]) await this.unload(pluginId);
    await this.#options.audioProviders.stopAll();
    await this.#options.ttsProviders.stopAll();
  }
}

async function disposeContext(pluginId: string, state: PluginContextState, options: PluginRuntimeOptions): Promise<void> {
  await options.audioProviders.stopOwner(pluginId);
  await options.ttsProviders.stopOwner(pluginId);
  for (const disposable of [...state.disposables].reverse()) {
    try { await disposable.dispose(); } catch (error) { options.log?.(`Plugin ${pluginId} cleanup failed: ${errorMessage(error)}`); }
  }
  options.audioProviders.unregisterOwner(pluginId);
  options.ttsProviders.unregisterOwner(pluginId);
}

function normalizePlugin(module: PluginModule): AppPlugin {
  const plugin = 'default' in module ? module.default : module;
  if (!plugin || typeof plugin !== 'object' || typeof plugin.activate !== 'function') {
    throw new Error('Plugin entry must export an AppPlugin or a default AppPlugin.');
  }
  return plugin;
}

function createLogger(pluginId: string, sink?: (message: string) => void): LoggerAPI {
  const write = (level: string, message: string, metadata?: PluginJsonObject): void => {
    const suffix = metadata ? ` ${JSON.stringify(metadata)}` : '';
    sink?.(`[${pluginId}] ${level}: ${message}${suffix}`);
    if (!sink) {
      const line = `[plugin:${pluginId}] ${message}`;
      if (level === 'error') console.error(line, metadata ?? '');
      else if (level === 'warn') console.warn(line, metadata ?? '');
      else console.log(line, metadata ?? '');
    }
  };
  return {
    debug: (message, metadata) => write('debug', message, metadata),
    info: (message, metadata) => write('info', message, metadata),
    warn: (message, metadata) => write('warn', message, metadata),
    error: (message, metadata) => write('error', message, metadata),
  };
}

async function createI18n(rootDirectory: string, manifest: AppPluginManifest, locale: string): Promise<I18nAPI> {
  const catalog: Record<string, Record<string, string>> = {};
  const i18nDirectory = manifest.i18n ? await resolvePluginPath(rootDirectory, manifest.i18n.directory, 'Plugin locale directory') : undefined;
  if (i18nDirectory) {
    const entries = await readdir(i18nDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const language = entry.name.slice(0, -'.json'.length);
      if (!LOCALE_PATTERN.test(language)) continue;
      const path = join(i18nDirectory, entry.name);
      const info = await stat(path);
      if (info.size > MAX_LOCALE_BYTES) throw new Error(`Plugin ${manifest.id} locale exceeds the 256 KB limit: ${entry.name}`);
      const value = JSON.parse(await readFile(path, 'utf8')) as unknown;
      const flat: Record<string, string> = {};
      flattenTranslations(value, '', flat);
      if (Object.keys(flat).length > MAX_LOCALE_KEYS) throw new Error(`Plugin ${manifest.id} locale has too many keys: ${entry.name}`);
      catalog[language] = flat;
    }
  }
  const defaultLocale = manifest.i18n?.default ?? 'en';
  const activeLocale = catalog[locale] ? locale : defaultLocale;
  return {
    locale: activeLocale,
    defaultLocale,
    catalog,
    t: (key, variables) => interpolate(catalog[activeLocale]?.[key] ?? catalog[defaultLocale]?.[key] ?? key, variables),
  };
}

function flattenTranslations(value: unknown, prefix: string, target: Record<string, string>): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'string') target[fullKey] = child;
    else flattenTranslations(child, fullKey, target);
  }
}

function interpolate(value: string, variables?: Record<string, string | number>): string {
  if (!variables) return value;
  return value.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_match, key: string) => String(variables[key] ?? `{${key}}`));
}

function scopedName(owner: string, name: string, kind: string): string {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9._:-]{1,160}$/.test(name)) throw new Error(`Invalid plugin ${kind} name: ${name}`);
  const id = name.includes('.') ? name : `${owner}.${name}`;
  if (!id.startsWith(`${owner}.`)) throw new Error(`Plugin ${kind} must remain within ${owner}.`);
  return id;
}

function validateEventName(event: string): void {
  if (!/^[a-zA-Z0-9._:-]{1,160}$/.test(event)) throw new Error(`Invalid plugin event: ${event}`);
}

function requirePermission(manifest: AppPluginManifest, permission: string): void {
  if (!manifest.permissions.includes(permission)) throw new Error(`Plugin ${manifest.id} has not requested permission: ${permission}`);
}

function requireCapability(manifest: AppPluginManifest, capability: string): void {
  if (!manifest.capabilities.includes(capability)) throw new Error(`Plugin ${manifest.id} has not declared capability: ${capability}`);
}

function hasAudioPermission(manifest: AppPluginManifest): boolean {
  return manifest.permissions.some((permission) => permission === 'audio.output' || permission === 'audio.input' || permission === 'audio.devices');
}

function hasTtsPermission(manifest: AppPluginManifest): boolean {
  return manifest.permissions.some((permission) => permission === 'tts.output' || permission === 'tts.synthesis');
}

async function validateOptionalFile(rootDirectory: string, relativePath: string | undefined, label: string): Promise<void> {
  if (!relativePath) return;
  const path = await resolvePluginPath(rootDirectory, relativePath, label);
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`${label} is not a file: ${relativePath}`);
}

function relativePath(root: string, candidate: string): string {
  return relative(resolve(root), resolve(candidate));
}

function isPathWithin(root: string | undefined, candidate: string): boolean {
  if (!root) return false;
  const remainder = relative(resolve(root), resolve(candidate));
  return remainder === '' || (!remainder.startsWith('..') && !isAbsolute(remainder));
}

function isMissingPath(error: unknown): boolean {
  return Boolean(error) && typeof error === 'object' && (error as { code?: string }).code === 'ENOENT';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
