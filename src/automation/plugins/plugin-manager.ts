import { NodeRegistry } from '../node-registry.ts';
import { ActionRegistry, type ActionImplementation } from '../behavior/action-registry.ts';
import type { AutomationCapabilities } from '../capabilities.ts';
import type { NodeImplementation } from '../types.ts';
import type { TranslationCatalog } from '../behavior/types.ts';
import {
  assertValidPluginManifest,
  type AutomationPlugin,
  type AutomationPluginManifest,
} from './manifest.ts';

export class PluginManager {
  readonly #registry: NodeRegistry;
  readonly #actions: ActionRegistry;
  readonly #plugins = new Map<string, AutomationPluginManifest>();
  readonly #pluginNodeTypes = new Map<string, string[]>();
  readonly #pluginActionTypes = new Map<string, string[]>();
  readonly #pluginTranslations = new Map<string, TranslationCatalog>();
  readonly #pluginDisposers = new Map<string, () => void | Promise<void>>();

  constructor(registry: NodeRegistry, actions = new ActionRegistry()) {
    this.#registry = registry;
    this.#actions = actions;
  }

  register(plugin: AutomationPlugin): void {
    assertValidPluginManifest(plugin.manifest);
    const { manifest } = plugin;
    if (manifest.executionMode !== 'trusted') throw new Error(`Sandbox plugin ${manifest.id} must use registerSandbox().`);
    this.#register(plugin);
  }

  registerSandbox(plugin: AutomationPlugin, onUnload?: () => void | Promise<void>): void {
    assertValidPluginManifest(plugin.manifest);
    if (plugin.manifest.executionMode !== 'sandbox') {
      throw new Error(`Trusted plugin ${plugin.manifest.id} must use register().`);
    }
    this.#register(plugin, onUnload);
  }

  #register(plugin: AutomationPlugin, onUnload?: () => void | Promise<void>): void {
    const { manifest } = plugin;
    if (this.#plugins.has(manifest.id)) throw new Error(`Automation plugin is already registered: ${manifest.id}`);
    const nodes = plugin.nodes ?? [];
    const actions = plugin.actions ?? [];
    if (nodes.length === 0 && actions.length === 0) throw new Error(`Automation plugin has no contributions: ${manifest.id}`);

    validatePluginNodes(nodes, manifest);
    validatePluginActions(actions, manifest);
    for (const node of nodes) {
      if (this.#registry.get(node.definition.type)) {
        throw new Error(`Plugin ${manifest.id} conflicts with node type: ${node.definition.type}`);
      }
    }
    for (const action of actions) {
      if (this.#actions.get(action.definition.id)) {
        throw new Error(`Plugin ${manifest.id} conflicts with action type: ${action.definition.id}`);
      }
    }

    const registered: string[] = [];
    const registeredActions: string[] = [];
    try {
      for (const node of nodes) {
        this.#registry.register(node);
        registered.push(node.definition.type);
      }
      for (const action of actions) {
        this.#actions.register(action);
        registeredActions.push(action.definition.id);
      }
    } catch (error) {
      for (const type of registered) this.#registry.unregister(type);
      for (const type of registeredActions) this.#actions.unregister(type);
      throw error;
    }

    this.#plugins.set(manifest.id, manifest);
    this.#pluginNodeTypes.set(manifest.id, registered);
    this.#pluginActionTypes.set(manifest.id, registeredActions);
    this.#pluginTranslations.set(manifest.id, plugin.translations ?? {});
    if (onUnload) this.#pluginDisposers.set(manifest.id, onUnload);
  }

  unregister(pluginId: string): boolean {
    const disposer = this.#detach(pluginId);
    if (disposer === undefined) return false;
    if (disposer) {
      try {
        void Promise.resolve(disposer()).catch((error: unknown) => {
          console.error(`[automation-plugin:${pluginId}] unload failed:`, error);
        });
      } catch (error) {
        console.error(`[automation-plugin:${pluginId}] unload failed:`, error);
      }
    }
    return true;
  }

  async unregisterAsync(pluginId: string): Promise<boolean> {
    const disposer = this.#detach(pluginId);
    if (disposer === undefined) return false;
    if (disposer) await disposer();
    return true;
  }

  get(pluginId: string): AutomationPluginManifest | undefined {
    return this.#plugins.get(pluginId);
  }

  list(): AutomationPluginManifest[] {
    return [...this.#plugins.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  actionDefinitions(pluginId?: string) {
    const definitions = this.#actions.definitions();
    if (!pluginId) return definitions;
    return definitions.filter((definition) => definition.source.kind === 'plugin' && definition.source.pluginId === pluginId);
  }

  /** Return a deterministic, flat locale catalog for the WebView. */
  translations(): TranslationCatalog {
    const catalog: TranslationCatalog = {};
    for (const translations of this.#pluginTranslations.values()) {
      for (const [locale, entries] of Object.entries(translations)) {
        const target = catalog[locale] ?? (catalog[locale] = {});
        for (const [key, value] of Object.entries(entries)) {
          if (target[key] === undefined) target[key] = value;
        }
      }
    }
    return catalog;
  }

  hasPermission(pluginId: string, capability: string): boolean {
    return this.#plugins.get(pluginId)?.permissions.capabilities?.includes(capability) ?? false;
  }

  capabilitiesFor(pluginId: string, available: AutomationCapabilities): AutomationCapabilities {
    const manifest = this.#plugins.get(pluginId);
    if (!manifest) return {};
    const allowed = (capability: string): boolean => manifest.permissions.capabilities?.includes(capability) ?? false;
    return {
      http: allowed('http.request') ? available.http : undefined,
      audio: allowed('audio.play') ? available.audio : undefined,
      tts: allowed('tts.synthesize') ? available.tts : undefined,
      points: allowed('points.adjust') ? available.points : undefined,
      vm: allowed('vm.script') ? available.vm : undefined,
    };
  }

  #detach(pluginId: string): (() => void | Promise<void>) | null | undefined {
    if (!this.#plugins.has(pluginId)) return undefined;
    for (const type of this.#pluginNodeTypes.get(pluginId) ?? []) this.#registry.unregister(type);
    for (const type of this.#pluginActionTypes.get(pluginId) ?? []) this.#actions.unregister(type);
    const disposer = this.#pluginDisposers.get(pluginId) ?? null;
    this.#pluginDisposers.delete(pluginId);
    this.#pluginNodeTypes.delete(pluginId);
    this.#pluginActionTypes.delete(pluginId);
    this.#pluginTranslations.delete(pluginId);
    this.#plugins.delete(pluginId);
    return disposer;
  }
}

function validatePluginNodes(nodes: NodeImplementation[], manifest: AutomationPluginManifest): void {
  const seen = new Set<string>();
  for (const node of nodes) {
    const definition = node.definition;
    if (seen.has(definition.type)) throw new Error(`Plugin ${manifest.id} declares duplicate node type: ${definition.type}`);
    seen.add(definition.type);
    if (definition.pluginId !== manifest.id) {
      throw new Error(`Node ${definition.type} must declare pluginId=${manifest.id}.`);
    }
    for (const capability of definition.requiredCapabilities ?? []) {
      if (!manifest.permissions.capabilities?.includes(capability)) {
        throw new Error(`Plugin ${manifest.id} has not requested capability: ${capability}`);
      }
    }
  }
}

function validatePluginActions(actions: ActionImplementation[], manifest: AutomationPluginManifest): void {
  const seen = new Set<string>();
  for (const action of actions) {
    const definition = action.definition;
    if (seen.has(definition.id)) throw new Error(`Plugin ${manifest.id} declares duplicate action type: ${definition.id}`);
    seen.add(definition.id);
    if (definition.source.kind !== 'plugin' || definition.source.pluginId !== manifest.id) {
      throw new Error(`Action ${definition.id} must declare pluginId=${manifest.id}.`);
    }
    for (const capability of definition.requiredCapabilities ?? []) {
      if (!manifest.permissions.capabilities?.includes(capability)) {
        throw new Error(`Plugin ${manifest.id} has not requested capability: ${capability}`);
      }
    }
  }
}
