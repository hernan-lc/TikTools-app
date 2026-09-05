/**
 * Shared form-control contracts for the TikTools Vue UI kit.
 * Small precise types only — components pick what they actually use.
 */

export type ControlSize = 'sm' | 'md' | 'lg';

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
  /** Tooltip shown on the option title. */
  hint?: string;
};

export function fieldIds(props: { id?: string; name?: string }, fallback: string): { id: string; describedBy: (parts: Array<string | undefined | false>) => string | undefined } {
  const id = props.id ?? (props.name ? `tt-${props.name}` : fallback);
  const describedBy = (parts: Array<string | undefined | false>): string | undefined => {
    const list = parts.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
    return list.length > 0 ? list.join(' ') : undefined;
  };
  return { id, describedBy };
}

export function clampNumber(value: number, min?: number, max?: number): number {
  let out = value;
  if (min !== undefined) out = Math.max(min, out);
  if (max !== undefined) out = Math.min(max, out);
  return out;
}

/** Clamp a dual-range tuple so lower <= upper and both stay in [min,max]. */
export function clampDualRange(value: [number, number], min: number, max: number): [number, number] {
  const low = clampNumber(Math.min(value[0], value[1]), min, max);
  const high = clampNumber(Math.max(value[0], value[1]), min, max);
  return [low, high];
}

/** Normalize a hex color to #rrggbb lowercase, or null when invalid. */
export function normalizeHexColor(value: string): string | null {
  const raw = value.trim().toLowerCase();
  const short = /^#([0-9a-f]{3})$/;
  const full = /^#([0-9a-f]{6})$/;
  const shortMatch = short.exec(raw);
  if (shortMatch) {
    const digits = shortMatch[1] ?? '';
    return `#${digits.split('').map((c) => `${c}${c}`).join('')}`;
  }
  if (full.exec(raw)) return raw;
  return null;
}

/** Split raw tag input into candidate tags (comma-separated, trimmed). */
export function splitTagCandidates(raw: string): string[] {
  return raw.split(',').map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

/** Add candidates to a tag list with dedupe + maxTags + optional validation. */
export function addTags(
  current: string[],
  candidates: string[],
  options: { maxTags?: number; validate?: (tag: string) => boolean } = {},
): { tags: string[]; added: string[] } {
  const seen = new Set(current.map((entry) => entry.toLowerCase()));
  const tags = [...current];
  const added: string[] = [];
  for (const candidate of candidates) {
    const tag = candidate.trim();
    if (!tag || seen.has(tag.toLowerCase())) continue;
    if (options.validate && !options.validate(tag)) continue;
    if (options.maxTags !== undefined && tags.length >= options.maxTags) break;
    seen.add(tag.toLowerCase());
    tags.push(tag);
    added.push(tag);
  }
  return { tags, added };
}

/** Normalize OTP input: keep alphanumerics, enforce mode + length. */
export function normalizeOtpValue(raw: string, length: number, mode: 'numeric' | 'alphanumeric'): string {
  const cleaned = mode === 'numeric' ? raw.replace(/[^0-9]/g, '') : raw.replace(/[^a-zA-Z0-9]/g, '');
  return cleaned.slice(0, length);
}

/** Convert a FileList / File[]-like into a plain File[] for component state. */
export function fileListToArray(list: FileList | File[] | null | undefined): File[] {
  if (!list) return [];
  return Array.from(list as ArrayLike<File>);
}

/** Remove one file by index (pure helper, easy to unit test). */
export function removeFileAt(files: File[], index: number): File[] {
  return files.filter((_, i) => i !== index);
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let size = bytes / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unit]}`;
}

import { filterSuggestions, type AutocompleteItem } from '../autocomplete/autocomplete.ts';

/** Filter plain select options with the shared autocomplete scorer. */
export function filterComboOptions(options: SelectOption[], query: string, limit = 50): SelectOption[] {
  if (!query.trim()) return options.slice(0, limit);
  const items: AutocompleteItem[] = options.map((o) => ({ value: o.value, label: o.label }));
  const scored = filterSuggestions(items, query, limit);
  const byValue = new Map(options.map((o) => [o.value, o]));
  return scored.map((entry) => byValue.get(entry.item.value)).filter((entry): entry is SelectOption => Boolean(entry));
}

/** Filter multi-select options with the shared autocomplete scorer. */
export function filterMultiOptions(options: SelectOption[], query: string, limit = 100): SelectOption[] {
  if (!query.trim()) return options.slice(0, limit);
  const items: AutocompleteItem[] = options.map((o) => ({ value: o.value, label: o.label }));
  const scored = filterSuggestions(items, query, limit);
  const byValue = new Map(options.map((o) => [o.value, o]));
  return scored.map((entry) => byValue.get(entry.item.value)).filter((entry): entry is SelectOption => Boolean(entry));
}
