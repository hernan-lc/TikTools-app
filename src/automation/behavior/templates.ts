import type { AutomationEvent, JsonObject, JsonValue } from '../types.ts';

export function renderTemplate(template: string, event: AutomationEvent): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, rawPath: string) => readString(readEventPath(event, rawPath.trim())));
}

export function renderJsonTemplate(template: string, event: AutomationEvent): JsonValue {
  const rendered = renderTemplate(template, event);
  try {
    const parsed = JSON.parse(rendered) as unknown;
    if (!isJsonValue(parsed)) throw new Error('JSON value is not safe.');
    return parsed;
  } catch {
    throw new Error('Template did not produce valid JSON.');
  }
}

export function readEventPath(event: AutomationEvent, path: string): JsonValue | undefined {
  const root: JsonObject = { event: event as JsonValue, data: event.data, user: event.user ?? null };
  let current: JsonValue | undefined = root;
  for (const part of path.split('.').map((entry) => entry.trim()).filter(Boolean)) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = Array.isArray(current) ? current[Number(part)] : (current as JsonObject)[part];
  }
  return current;
}

function readString(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  return Boolean(value) && typeof value === 'object' && Object.values(value as Record<string, unknown>).every((entry) => entry === undefined || isJsonValue(entry));
}
