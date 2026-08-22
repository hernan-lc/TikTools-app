import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import type {
  AutomationCapabilities,
  HttpRedirectMode,
  HttpRequestOptions,
  HttpResponseType,
} from '../capabilities.ts';
import type { JsonObject, JsonValue } from '../types.ts';
import {
  asJsonObject,
  asString,
} from './protocol.ts';
import type { AutomationPluginManifest } from './manifest.ts';

export interface CapabilityBrokerOptions {
  available: AutomationCapabilities;
  getManifest: (pluginId: string) => AutomationPluginManifest | undefined;
  /** Root used to resolve relative file permissions for a plugin package. */
  fileRoot?: string;
}

/**
 * Converts worker capability requests into the small set of trusted host
 * operations. Every request is checked against the plugin manifest before it
 * reaches a native or network provider.
 */
export class PluginCapabilityBroker {
  readonly #available: AutomationCapabilities;
  readonly #getManifest: CapabilityBrokerOptions['getManifest'];
  readonly #fileRoot: string;

  constructor(options: CapabilityBrokerOptions) {
    this.#available = options.available;
    this.#getManifest = options.getManifest;
    this.#fileRoot = options.fileRoot ?? process.cwd();
  }

  async invoke(pluginId: string, name: string, params: JsonValue): Promise<JsonValue> {
    const manifest = this.#getManifest(pluginId);
    if (!manifest) throw new Error(`Plugin is not registered: ${pluginId}`);
    if (!manifest.permissions.capabilities?.includes(name)) {
      throw new Error(`Plugin ${pluginId} has not requested capability: ${name}`);
    }

    switch (name) {
      case 'http.request':
        return this.invokeHttp(manifest, params);
      case 'audio.play':
        return this.invokeAudio(manifest, params);
      case 'tts.synthesize':
        return this.invokeTts(params);
      case 'points.adjust':
        return this.invokePoints(params);
      case 'vm.script':
        return this.invokeScript(pluginId, params);
      default:
        throw new Error(`Unknown automation capability: ${name}`);
    }
  }

  private async invokeHttp(manifest: AutomationPluginManifest, params: JsonValue): Promise<JsonObject> {
    const http = this.#available.http;
    if (!http) throw new Error('HTTP capability is not available to the host.');
    const object = asJsonObject(params, 'http.request parameters');
    const method = asString(object.method, 'http.request method');
    const url = asString(object.url, 'http.request url');
    const parsedUrl = parsePublicUrl(url);
    if (!isNetworkAllowed(parsedUrl, manifest.permissions.network ?? [])) {
      throw new Error(`Plugin network permission does not allow ${parsedUrl.origin}${parsedUrl.pathname}.`);
    }
    const localNetwork = hasLocalNetworkPermission(manifest.permissions.network ?? []);
    const options: HttpRequestOptions = {
      method,
      url,
      headers: readHeaders(object.headers),
      body: object.body === undefined ? undefined : asString(object.body, 'http.request body'),
      timeoutMs: readOptionalNumber(object.timeoutMs),
      maxResponseBytes: readOptionalNumber(object.maxResponseBytes),
      responseType: readResponseType(object.responseType),
      redirect: readRedirect(object.redirect),
      maxRedirects: readOptionalNumber(object.maxRedirects),
      allowedHosts: [parsedUrl.hostname],
      allowedUrlPatterns: manifest.permissions.network,
      allowPrivateNetwork: localNetwork && object.allowPrivateNetwork === true,
    };
    const response = await http.request(options);
    return {
      status: response.status,
      ok: response.ok,
      url: response.url,
      headers: response.headers,
      body: response.body,
    };
  }

  private async invokeAudio(manifest: AutomationPluginManifest, params: JsonValue): Promise<JsonObject> {
    const audio = this.#available.audio;
    if (!audio) throw new Error('Audio capability is not available to the host.');
    const object = asJsonObject(params, 'audio.play parameters');
    const path = asString(object.path, 'audio.play path');
    const safePath = await resolveAllowedFile(path, manifest.permissions.files ?? [], this.#fileRoot);
    const overlap = object.overlap === 'restart' || object.overlap === 'drop' ? object.overlap : 'allow';
    const volume = object.volume === undefined ? undefined : readNumber(object.volume, 'audio.play volume');
    return audio.playFile(safePath, { volume, overlap });
  }

  private async invokeTts(params: JsonValue): Promise<JsonObject> {
    const tts = this.#available.tts;
    if (!tts) throw new Error('TTS capability is not available to the host.');
    const object = asJsonObject(params, 'tts.synthesize parameters');
    const text = asString(object.text, 'tts.synthesize text');
    const options = object.options === undefined ? {} : asJsonObject(object.options, 'tts.synthesize options');
    return tts.synthesize(text, options);
  }

  private async invokePoints(params: JsonValue): Promise<JsonObject> {
    const points = this.#available.points;
    if (!points) throw new Error('Points capability is not available to the host.');
    const object = asJsonObject(params, 'points.adjust parameters');
    const uniqueId = asString(object.uniqueId, 'points.adjust uniqueId');
    const delta = readNumber(object.delta, 'points.adjust delta');
    return await points.adjust(uniqueId, delta);
  }

  private invokeScript(pluginId: string, params: JsonValue): JsonValue {
    const vm = this.#available.vm;
    if (!vm) throw new Error('VM capability is not available to the host.');
    const object = asJsonObject(params, 'vm.script parameters');
    const source = asString(object.source, 'vm.script source');
    const event = object.event;
    const inputs = asJsonObject(object.inputs, 'vm.script inputs');
    const options = object.options === undefined ? {} : asJsonObject(object.options, 'vm.script options');
    return vm.evaluate(source, { event: event ?? null, inputs }, {
      scopeId: `${pluginId}:${typeof options.scopeId === 'string' ? options.scopeId : 'worker'}`,
      loopLimit: readOptionalNumber(options.loopLimit),
    });
  }
}

function parsePublicUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('http.request url is invalid.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http:// and https:// URLs are allowed.');
  }
  if (url.username || url.password) throw new Error('HTTP URLs cannot contain embedded credentials.');
  return url;
}

function isNetworkAllowed(url: URL, permissions: string[]): boolean {
  if (permissions.includes('*')) return true;
  return permissions.some((pattern) => {
    const normalized = pattern.trim();
    if (!normalized || normalized === 'local') return false;
    if (normalized.includes('://')) {
      return matchesUrlPattern(url, normalized);
    }
    return matchesHostPattern(url.hostname, normalized);
  });
}

function matchesUrlPattern(url: URL, pattern: string): boolean {
  let allowed: URL;
  try {
    allowed = new URL(pattern);
  } catch {
    return false;
  }
  if (allowed.protocol !== url.protocol || !matchesHostPattern(url.hostname, allowed.hostname)) return false;
  const pathPattern = new URL(pattern).pathname;
  if (pathPattern.endsWith('*')) return url.pathname.startsWith(pathPattern.slice(0, -1));
  return url.pathname === pathPattern;
}

function matchesHostPattern(host: string, pattern: string): boolean {
  const normalizedHost = host.toLowerCase();
  const normalizedPattern = pattern.toLowerCase().replace(/^https?:\/\//, '').split('/')[0] ?? '';
  if (normalizedPattern === '*') return true;
  if (normalizedPattern.startsWith('*.')) {
    const suffix = normalizedPattern.slice(1);
    return normalizedHost.endsWith(suffix) && normalizedHost !== suffix.slice(1);
  }
  return normalizedHost === normalizedPattern;
}

function hasLocalNetworkPermission(permissions: string[]): boolean {
  return permissions.includes('local') || permissions.includes('*');
}

function readHeaders(value: JsonValue | undefined): Record<string, string> {
  if (value === undefined) return {};
  const object = asJsonObject(value, 'http.request headers');
  const headers: Record<string, string> = {};
  for (const [key, entry] of Object.entries(object)) {
    if (entry !== undefined) headers[key] = asString(entry, `http.request header ${key}`);
  }
  return headers;
}

function readResponseType(value: JsonValue | undefined): HttpRequestOptions['responseType'] {
  if (value === undefined) return 'auto';
  if (value !== 'auto' && value !== 'json' && value !== 'text' && value !== 'bytes') {
    throw new Error('http.request responseType is invalid.');
  }
  return value as HttpResponseType;
}

function readRedirect(value: JsonValue | undefined): HttpRedirectMode | undefined {
  if (value === undefined) return undefined;
  if (value !== 'error' && value !== 'follow') throw new Error('http.request redirect is invalid.');
  return value;
}

function readOptionalNumber(value: JsonValue | undefined): number | undefined {
  return value === undefined ? undefined : readNumber(value, 'numeric capability option');
}

function readNumber(value: JsonValue | undefined, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
  return value;
}

async function resolveAllowedFile(filePath: string, patterns: string[], rootDirectory: string): Promise<string> {
  if (patterns.length === 0) throw new Error('Audio playback requires an explicit files permission.');
  const candidate = await resolveRealPath(filePath, 'Audio file', rootDirectory);
  for (const pattern of patterns) {
    const normalized = pattern.trim();
    if (!normalized) continue;
    if (normalized === '*') return candidate;

    const wildcardIndex = normalized.indexOf('*');
    const rootPattern = wildcardIndex >= 0 ? normalized.slice(0, wildcardIndex) : normalized;
    const root = await resolveRealPath(rootPattern || '.', 'Audio permission path', rootDirectory).catch(() => undefined);
    if (!root) continue;
    const candidateRelative = relative(root, candidate);
    if (candidateRelative === '' || (!candidateRelative.startsWith('..') && !isAbsolute(candidateRelative))) {
      return candidate;
    }
  }
  throw new Error(`Audio file is outside the plugin file permissions: ${filePath}`);
}

async function resolveRealPath(filePath: string, label: string, rootDirectory: string): Promise<string> {
  try {
    return await realpath(isAbsolute(filePath) ? resolve(filePath) : resolve(rootDirectory, filePath));
  } catch {
    throw new Error(`${label} does not exist or cannot be resolved: ${filePath}`);
  }
}
