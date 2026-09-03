import type { TTSVoice } from '../../../sdk/plugin-api/index.ts';

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 3000;

/** Storage-backed connection values fall back to the loopback default. */
export function normalizeHost(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_HOST;
  const host = value.trim();
  if (!host || host.length > 253 || /\s/.test(host)) return DEFAULT_HOST;
  return host;
}

export function normalizePort(value: unknown): number {
  const port = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return DEFAULT_PORT;
  return port;
}

export function buildBaseUrl(host: unknown, port: unknown): string {
  return `http://${normalizeHost(host)}:${normalizePort(port)}`;
}

/**
 * Parses a SonicBoom voice list tolerantly. The documented endpoint is
 * `GET /v1/voices` (OpenAI shape `{ data: [{ id, name? }] }`); plain arrays
 * and `{ voices: [...] }` are accepted too. Anything else yields [].
 */
export function parseVoices(payload: unknown): TTSVoice[] {
  const candidates = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>).data ?? (payload as Record<string, unknown>).voices
      : undefined;
  if (!Array.isArray(candidates)) return [];
  const voices: TTSVoice[] = [];
  for (const entry of candidates.slice(0, 100)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.id !== 'string' || !record.id.trim()) continue;
    const voice: TTSVoice = { id: record.id };
    if (typeof record.name === 'string' && record.name.trim()) voice.name = record.name;
    voices.push(voice);
  }
  return voices;
}
