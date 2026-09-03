import { realpath, readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import type { PluginIsolation } from './manifest-types.ts';

export type { PluginIsolation } from './manifest-types.ts';

export interface PluginHostRequirement {
  api: string;
  uiApi?: string;
}

export interface PluginUIManifest {
  entry: string;
}

export interface PluginI18nManifest {
  default: string;
  directory: string;
}

export interface PluginAssetsManifest {
  icon?: string;
}

/**
 * Host-rendered settings form. The manifest declares a small JSON Schema
 * subset; the WebView renders it with the host-owned SchemaForm and the
 * values persist in the plugin's own storage file. No plugin code runs
 * in the UI: settings are data only.
 */
export interface PluginSettingsManifest {
  schema: Record<string, unknown>;
  uiHints?: Record<string, unknown>;
}

export interface PluginNativeManifest {
  package?: string;
  targets?: string[];
}

export interface AppPluginManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  description?: string;
  main: string;
  host: PluginHostRequirement;
  type?: string;
  capabilities: string[];
  permissions: string[];
  isolation?: PluginIsolation;
  targets?: string[];
  native?: PluginNativeManifest;
  ui?: PluginUIManifest;
  i18n?: PluginI18nManifest;
  assets?: PluginAssetsManifest;
  settings?: PluginSettingsManifest;
}

export interface ReadPluginManifestOptions {
  hostApiVersion?: string;
  uiApiVersion?: string;
  target?: string;
}

const PLUGIN_ID = /^[a-z0-9][a-z0-9._-]{1,127}$/;
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const LOCALE = /^[a-z]{2}(?:-[A-Z]{2})?$/;
const TOKEN = /^[a-z][a-z0-9._:-]{0,127}$/;

export function assertValidAppPluginManifest(value: unknown): asserts value is AppPluginManifest {
  if (!isAppPluginManifest(value)) throw new Error('Invalid app plugin manifest.');
}

export function isAppPluginManifest(value: unknown): value is AppPluginManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const manifest = value as Record<string, unknown>;
  if (manifest.schemaVersion !== 1) return false;
  if (typeof manifest.id !== 'string' || !PLUGIN_ID.test(manifest.id)) return false;
  if (typeof manifest.name !== 'string' || !manifest.name.trim()) return false;
  if (typeof manifest.version !== 'string' || !VERSION.test(manifest.version)) return false;
  if (!isSafeRelativePath(manifest.main)) return false;
  if (!isHostRequirement(manifest.host)) return false;
  if (!isStringArray(manifest.capabilities) || !manifest.capabilities.every((entry) => TOKEN.test(entry))) return false;
  if (!isStringArray(manifest.permissions) || !manifest.permissions.every((entry) => TOKEN.test(entry))) return false;
  if (manifest.description !== undefined && typeof manifest.description !== 'string') return false;
  if (manifest.type !== undefined && (typeof manifest.type !== 'string' || !TOKEN.test(manifest.type))) return false;
  if (manifest.isolation !== undefined && !['trusted', 'worker', 'process'].includes(manifest.isolation as string)) return false;
  if (manifest.targets !== undefined && (!isStringArray(manifest.targets) || manifest.targets.length === 0)) return false;
  if (manifest.native !== undefined && !isNativeManifest(manifest.native)) return false;
  if (manifest.ui !== undefined && !isUiManifest(manifest.ui)) return false;
  if (manifest.i18n !== undefined && !isI18nManifest(manifest.i18n)) return false;
  if (manifest.assets !== undefined && !isAssetsManifest(manifest.assets)) return false;
  if (manifest.settings !== undefined && !isSettingsManifest(manifest.settings)) return false;
  return true;
}

export function assertHostCompatibility(
  manifest: AppPluginManifest,
  hostApiVersion = '1.0.0',
  uiApiVersion = '1.0.0',
): void {
  if (!satisfiesVersion(hostApiVersion, manifest.host.api)) {
    throw new Error(`Plugin ${manifest.id} requires host API ${manifest.host.api}; host is ${hostApiVersion}.`);
  }
  if (manifest.host.uiApi && !satisfiesVersion(uiApiVersion, manifest.host.uiApi)) {
    throw new Error(`Plugin ${manifest.id} requires UI API ${manifest.host.uiApi}; host is ${uiApiVersion}.`);
  }
}

export function assertTargetCompatibility(manifest: AppPluginManifest, target = currentPluginTarget()): void {
  const targets = [...(manifest.targets ?? []), ...(manifest.native?.targets ?? [])];
  if (targets.length === 0) return;
  if (!targets.some((entry) => entry === target || entry === `${process.platform}-${process.arch}` || entry === process.platform)) {
    throw new Error(`Plugin ${manifest.id} has no native build for ${target}.`);
  }
}

export function currentPluginTarget(): string {
  const abi = process.platform === 'win32' ? 'msvc' : process.platform === 'linux' ? 'gnu' : 'darwin';
  return `${process.platform}-${process.arch}-${abi}`;
}

export function isSafeRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || !value || isAbsolute(value)) return false;
  const normalized = value.replaceAll('\\', '/');
  if (normalized.startsWith('/') || normalized.split('/').some((part) => part === '..' || part === '')) return false;
  return normalized !== '.' && !normalized.includes('\0');
}

export async function resolvePluginPath(rootDirectory: string, relativePath: string, label: string): Promise<string> {
  if (!isSafeRelativePath(relativePath)) throw new Error(`${label} must be relative to the plugin directory.`);
  const root = await realpath(rootDirectory);
  const candidate = await realpath(resolve(root, relativePath));
  const remainder = relative(root, candidate);
  if (!remainder || remainder.startsWith('..') || isAbsolute(remainder)) {
    throw new Error(`${label} must remain inside the plugin directory.`);
  }
  return candidate;
}

export async function readAppPluginManifest(
  manifestPath: string,
  options: ReadPluginManifestOptions = {},
): Promise<AppPluginManifest> {
  const info = await stat(manifestPath);
  if (!info.isFile()) throw new Error('Plugin manifest is not a file.');
  if (info.size > 256 * 1024) throw new Error('Plugin manifest exceeds the 256 KB limit.');
  let value: unknown;
  try {
    value = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown;
  } catch {
    throw new Error('Plugin manifest is not valid JSON.');
  }
  assertValidAppPluginManifest(value);
  assertHostCompatibility(value, options.hostApiVersion, options.uiApiVersion);
  assertTargetCompatibility(value, options.target);
  return value;
}

function isHostRequirement(value: unknown): value is PluginHostRequirement {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const host = value as Record<string, unknown>;
  return typeof host.api === 'string' && host.api.length <= 64
    && (host.uiApi === undefined || (typeof host.uiApi === 'string' && host.uiApi.length <= 64));
}

function isNativeManifest(value: unknown): value is PluginNativeManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const native = value as Record<string, unknown>;
  return (native.package === undefined || (typeof native.package === 'string' && native.package.length <= 160))
    && (native.targets === undefined || isStringArray(native.targets));
}

function isUiManifest(value: unknown): value is PluginUIManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return isSafeRelativePath((value as Record<string, unknown>).entry);
}

function isI18nManifest(value: unknown): value is PluginI18nManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const i18n = value as Record<string, unknown>;
  return typeof i18n.default === 'string' && LOCALE.test(i18n.default)
    && isSafeRelativePath(i18n.directory);
}

function isAssetsManifest(value: unknown): value is PluginAssetsManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const assets = value as Record<string, unknown>;
  return assets.icon === undefined || isSafeRelativePath(assets.icon);
}

const SETTINGS_TYPES = ['string', 'number', 'integer', 'boolean'];
const MAX_SETTINGS_PROPS = 32;
const MAX_SETTINGS_BYTES = 16 * 1024;

function isSettingsManifest(value: unknown): value is PluginSettingsManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const settings = value as Record<string, unknown>;
  if (!isSettingsSchema(settings.schema)) return false;
  if (settings.uiHints !== undefined && (!settings.uiHints || typeof settings.uiHints !== 'object' || Array.isArray(settings.uiHints))) return false;
  try {
    if (JSON.stringify(settings).length > MAX_SETTINGS_BYTES) return false;
  } catch {
    return false;
  }
  return true;
}

function isSettingsSchema(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const schema = value as Record<string, unknown>;
  if (schema.type !== 'object') return false;
  if (!schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) return false;
  const entries = Object.entries(schema.properties as Record<string, unknown>);
  if (entries.length === 0 || entries.length > MAX_SETTINGS_PROPS) return false;
  return entries.every(([key, prop]) => /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(key) && isSettingsProp(prop));
}

function isSettingsProp(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prop = value as Record<string, unknown>;
  if (!SETTINGS_TYPES.includes(prop.type as string)) return false;
  if (prop.enum !== undefined) {
    if (!Array.isArray(prop.enum) || prop.enum.length === 0 || prop.enum.length > 64) return false;
    if (!prop.enum.every((entry) => typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean')) return false;
  }
  if (prop.default !== undefined && !matchesSettingType(prop.default, prop.type as string)) return false;
  if (prop.title !== undefined && typeof prop.title !== 'string' && !isLocalizedText(prop.title)) return false;
  return true;
}

function isLocalizedText(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const text = value as Record<string, unknown>;
  return typeof text.default === 'string' && typeof text.i18key === 'string';
}

function matchesSettingType(value: unknown, type: string): boolean {
  if (type === 'string') return typeof value === 'string';
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === 'number' && Number.isInteger(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function parseVersion(value: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value.trim());
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersion(left: [number, number, number], right: [number, number, number]): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index]! !== right[index]!) return left[index]! > right[index]! ? 1 : -1;
  }
  return 0;
}

/** Small semver subset for host API ranges such as ^1.0.0 and ~1.2.0. */
export function satisfiesVersion(version: string, range: string): boolean {
  const actual = parseVersion(version);
  const normalized = range.trim();
  if (!actual || !normalized) return false;
  if (normalized === '*' || normalized.toLowerCase() === 'latest') return true;
  const match = /^(\^|~|>=|>|<=|<)?\s*(\d+)\.(\d+)\.(\d+)$/.exec(normalized);
  if (!match) return false;
  const requested: [number, number, number] = [Number(match[2]), Number(match[3]), Number(match[4])];
  const comparison = compareVersion(actual, requested);
  switch (match[1] ?? '') {
    case '^': return actual[0]! === requested[0] && comparison >= 0;
    case '~': return actual[0]! === requested[0] && actual[1]! === requested[1] && comparison >= 0;
    case '>=': return comparison >= 0;
    case '>': return comparison > 0;
    case '<=': return comparison <= 0;
    case '<': return comparison < 0;
    default: return comparison === 0;
  }
}
