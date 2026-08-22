import { lookup } from 'node:dns/promises';

import type {
  HttpCapability,
  HttpRedirectMode,
  HttpRequestOptions,
  HttpResponse,
} from '../capabilities.ts';
import type { JsonObject, JsonValue } from '../types.ts';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;

export class HttpService implements HttpCapability {
  async request(options: HttpRequestOptions): Promise<HttpResponse> {
    let method = options.method.trim().toUpperCase() || 'GET';
    let url = await validateUrl(options.url, options);
    let body = method === 'GET' || method === 'HEAD' ? undefined : options.body;
    const timeoutMs = clamp(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 100, 120_000);
    const maxResponseBytes = clamp(options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES, 1_024, 25 * 1024 * 1024);
    const redirect = options.redirect ?? 'error';
    const maxRedirects = clamp(options.maxRedirects ?? DEFAULT_MAX_REDIRECTS, 0, 10);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      let redirects = 0;
      let response: Response;
      while (true) {
        response = await fetch(url, {
          method,
          headers: options.headers,
          body,
          // Manual handling makes every redirect go back through URL, host,
          // DNS, and private-network validation instead of trusting fetch's
          // automatic follow behavior.
          redirect: 'manual',
          signal: controller.signal,
        });
        const location = response.headers.get('location');
        if (!isRedirect(response.status) || !location) break;
        if (redirect !== 'follow') throw new Error('HTTP redirect blocked by policy.');
        if (redirects >= maxRedirects) throw new Error(`HTTP redirect limit exceeded (${maxRedirects}).`);

        url = await validateUrl(new URL(location, url).href, options);
        redirects += 1;
        if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
          method = 'GET';
          body = undefined;
        }
      }
      const bytes = await readResponseBytes(response, maxResponseBytes);
      const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
      const responseType = options.responseType ?? 'auto';
      const responseBody = decodeBody(bytes, responseType, contentType);
      const headers: JsonObject = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      return {
        status: response.status,
        ok: response.ok,
        url: response.url || url,
        headers,
        body: responseBody,
      };
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`HTTP request timed out after ${timeoutMs} ms.`);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function validateUrl(rawUrl: string, options: HttpRequestOptions): Promise<string> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('HTTP URL is invalid.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http:// and https:// URLs are allowed.');
  }
  if (url.username || url.password) throw new Error('HTTP URLs cannot contain embedded credentials.');

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!matchesAllowedHost(host, options.allowedHosts) && options.allowedHosts?.length) {
    throw new Error(`HTTP host is not allowed: ${host}`);
  }
  if (options.allowedUrlPatterns?.length && !matchesAllowedUrl(url, options.allowedUrlPatterns)) {
    throw new Error(`HTTP URL is not allowed: ${url.origin}${url.pathname}.`);
  }
  if (options.allowPrivateNetwork) return url.href;
  if (isPrivateHostname(host)) throw new Error(`HTTP request to a private host is blocked: ${host}`);

  // DNS names can resolve to private addresses even when the URL itself looks
  // public. Resolve before fetching so plugins cannot use DNS rebinding as an
  // easy route into localhost or the link-local metadata endpoint.
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new Error(`HTTP host could not be resolved: ${host}`);
  }
  if (addresses.some((entry) => isPrivateHostname(entry.address))) {
    throw new Error(`HTTP host resolves to a private address: ${host}`);
  }
  return url.href;
}

async function readResponseBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (declaredLength > maxBytes) throw new Error(`HTTP response exceeds the ${maxBytes}-byte limit.`);
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = result.value;
      total += chunk.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`HTTP response exceeds the ${maxBytes}-byte limit.`);
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function decodeBody(bytes: Uint8Array, responseType: HttpRequestOptions['responseType'], contentType: string): JsonValue {
  if (responseType === 'bytes') return encodeBase64(bytes);
  const text = new TextDecoder().decode(bytes);
  const wantsJson = responseType === 'json' || (responseType === 'auto' && contentType.includes('json'));
  if (wantsJson) {
    try {
      return JSON.parse(text) as JsonValue;
    } catch {
      if (responseType === 'json') throw new Error('HTTP response was not valid JSON.');
    }
  }
  return text;
}

function encodeBase64(bytes: Uint8Array): string {
  let result = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    result += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(result);
}

function matchesAllowedHost(host: string, allowedHosts?: string[]): boolean {
  if (!allowedHosts || allowedHosts.length === 0) return true;
  return allowedHosts.some((allowed) => {
    const normalized = allowed.trim().toLowerCase();
    if (normalized === '*') return true;
    if (normalized.startsWith('*.')) return host.endsWith(normalized.slice(1));
    return host === normalized;
  });
}

function matchesAllowedUrl(url: URL, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const normalized = pattern.trim().toLowerCase();
    if (normalized === '*') return true;
    if (normalized === 'local') return isPrivateHostname(url.hostname);
    if (normalized.includes('://')) {
      let allowed: URL;
      try {
        allowed = new URL(normalized);
      } catch {
        return false;
      }
      if (allowed.protocol !== url.protocol || !matchesAllowedHost(url.hostname, [allowed.hostname])) return false;
      if (allowed.port && allowed.port !== url.port) return false;
      const path = allowed.pathname;
      return path.endsWith('*') ? url.pathname.startsWith(path.slice(0, -1)) : url.pathname === path;
    }
    return matchesAllowedHost(url.hostname, [normalized]);
  });
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function isPrivateHostname(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized.endsWith('.local')
    || normalized === '::1'
    || normalized === '0:0:0:0:0:0:0:1'
    || normalized === '::'
  ) return true;
  if (normalized.includes(':')) return true;

  const octets = normalized.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const first = octets[0] ?? -1;
  const second = octets[1] ?? -1;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
