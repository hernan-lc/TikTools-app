import { isAbsolute, join, normalize } from 'node:path';

export const DEFAULT_VOLUME = 1;

/** Sounds outside an absolute path resolve against the library directory. */
export function resolveSoundFile(soundsDir: unknown, file: string): string {
  const path = file.trim();
  if (!path || isAbsolute(path)) return path;
  if (typeof soundsDir !== 'string' || !soundsDir.trim()) return path;
  return normalize(join(soundsDir.trim(), path));
}

/** Action volume wins; the plugin default covers missing values; host clamps. */
export function normalizeVolume(value: unknown, fallback: unknown): number {
  const candidate = typeof value === 'number' && Number.isFinite(value) ? value : toNumber(fallback);
  return clamp(candidate);
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return DEFAULT_VOLUME;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
