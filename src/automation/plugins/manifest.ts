import type { JsonObject, NodeImplementation } from '../types.ts';
import type { ActionImplementation } from '../behavior/action-registry.ts';
import type { TranslationCatalog } from '../behavior/types.ts';

export type PluginExecutionMode = 'sandbox' | 'trusted';

export interface PluginPermissions {
  capabilities?: string[];
  network?: string[];
  secrets?: string[];
  /** Absolute paths or paths relative to the plugin directory; directories and `*` are supported. */
  files?: string[];
}

export interface AutomationPluginManifest {
  manifestVersion: 1;
  id: string;
  name: string;
  version: string;
  apiVersion: 1;
  entry?: string;
  executionMode: PluginExecutionMode;
  permissions: PluginPermissions;
  /** Locale -> relative JSON file, for example { "en": "i18n/en.json" }. */
  i18n?: Record<string, string>;
  metadata?: JsonObject;
}

export interface AutomationPlugin {
  manifest: AutomationPluginManifest;
  nodes?: NodeImplementation[];
  actions?: ActionImplementation[];
  translations?: TranslationCatalog;
}

export function assertValidPluginManifest(value: unknown): asserts value is AutomationPluginManifest {
  if (!isPluginManifest(value)) throw new Error('Invalid automation plugin manifest.');
}

export function isPluginManifest(value: unknown): value is AutomationPluginManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const manifest = value as Record<string, unknown>;
  if (manifest.manifestVersion !== 1 || manifest.apiVersion !== 1) return false;
  if (typeof manifest.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{1,127}$/.test(manifest.id)) return false;
  if (typeof manifest.name !== 'string' || !manifest.name.trim()) return false;
  if (typeof manifest.version !== 'string' || !manifest.version.trim()) return false;
  if (manifest.executionMode !== 'sandbox' && manifest.executionMode !== 'trusted') return false;
  if (!isPermissions(manifest.permissions)) return false;
  return (manifest.entry === undefined || typeof manifest.entry === 'string')
    && (manifest.i18n === undefined || isI18nFiles(manifest.i18n));
}

function isPermissions(value: unknown): value is PluginPermissions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const permissions = value as Record<string, unknown>;
  return ['capabilities', 'network', 'secrets', 'files'].every((key) => {
    const entry = permissions[key];
    return entry === undefined || (Array.isArray(entry) && entry.every((item) => typeof item === 'string'));
  });
}

function isI18nFiles(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 32) return false;
  return entries.every(([locale, path]) => /^[a-z]{2}(?:-[A-Z]{2})?$/.test(locale)
    && typeof path === 'string'
    && path.length > 0
    && path.length <= 256);
}
