import type { AutomationEvent, AutomationEventType, JsonValue } from '../../../automation/types.ts';
import {
  allRegistryFields,
  fieldsForEventType,
  registryEntryFor,
  type RegistryField,
} from '../../../automation/event-registry.ts';
import { mergeSuggestions, suggestionsFromObject, type AutocompleteItem } from '../autocomplete/autocomplete.ts';
import type { Locale } from '../../i18n.ts';

export type TemplateSuggestion = AutocompleteItem & {
  value: string;
  label: string;
  preview?: string;
};

export type TemplateSuggestionScope =
  | 'message'
  | 'identity'
  | 'text'
  | 'sound-file'
  | 'http-url'
  | 'http-data'
  | 'compare';

type ObservedPathMode = 'all' | 'identity' | 'text' | 'path';

/**
 * Declarative input contracts. A form chooses one scope — a filter over the
 * event registry — instead of receiving hardcoded path lists. The candidates
 * always come from `event-registry.json` (generated from the automation
 * types + TikTok proto schemes) plus whatever the last live event actually
 * carried. Run `bun run registry:events` after changing any scheme.
 */
export const TEMPLATE_INPUT_DEFINITIONS: Record<TemplateSuggestionScope, { observed: ObservedPathMode }> = {
  message: { observed: 'all' },
  identity: { observed: 'identity' },
  text: { observed: 'text' },
  'sound-file': { observed: 'path' },
  'http-url': { observed: 'path' },
  'http-data': { observed: 'all' },
  compare: { observed: 'all' },
};

export function getTemplateSuggestions(
  eventType: AutomationEventType | undefined,
  locale: Locale,
  lastEvent?: AutomationEvent,
  scope: TemplateSuggestionScope = 'message',
  extraContext?: JsonValue,
): TemplateSuggestion[] {
  const definition = TEMPLATE_INPUT_DEFINITIONS[scope];
  const matchingLastEvent = lastEvent && (!eventType || lastEvent.type === eventType) ? lastEvent : undefined;
  const registryFields = eventType ? fieldsForEventType(eventType) : allRegistryFields();
  const base: TemplateSuggestion[] = registryFields
    .filter((field) => matchesPathScope(field.path, undefined, definition.observed))
    .map((field) => toSuggestion(field, locale, eventType, matchingLastEvent ? readTemplatePath(matchingLastEvent, field.path) : undefined));

  // Existent data: paths the last live event really carried (custom payloads,
  // plugin emits) that the static registry cannot know about.
  const observed: TemplateSuggestion[] = matchingLastEvent
    ? flattenJsonPaths(matchingLastEvent, 'event')
      .filter((path) => matchesPathScope(path, readTemplatePath(matchingLastEvent, path), definition.observed))
      .filter((path) => !base.some((entry) => entry.value === path))
      .map((path) => {
        const liveValue = readTemplatePath(matchingLastEvent, path);
        return {
          value: path,
          label: humanizePath(path),
          kind: inferSuggestionKind(liveValue),
          detail: inferSuggestionKind(liveValue),
          documentation: `${humanizePath(path)} · ${path}`,
          preview: formatTemplateValue(liveValue),
        };
      })
    : [];

  const merged = mergeSuggestions(base, observed);
  if (extraContext === undefined) return merged as TemplateSuggestion[];
  // Generic: push any object as extra autocomplete items (custom schema/event).
  const extra = suggestionsFromObject(extraContext, 'event', { maxItems: 60 });
  return mergeSuggestions(merged, extra) as TemplateSuggestion[];
}

function toSuggestion(
  field: RegistryField,
  locale: Locale,
  eventType: AutomationEventType | undefined,
  liveValue: JsonValue | undefined,
): TemplateSuggestion {
  const label = field.label[locale === 'es' ? 'es' : 'en'];
  const hint = field.hint?.[locale === 'es' ? 'es' : 'en'];
  const vendor = vendorDetail(eventType, field);
  return {
    value: field.path,
    label,
    kind: field.kind,
    detail: field.tsType,
    documentation: [hint ?? `${label} · ${field.path}`, vendor].filter(Boolean).join('\n'),
    preview: liveValue === undefined ? undefined : formatTemplateValue(liveValue),
  };
}

/** Which proto scheme a registry field derives from, for the hover card. */
function vendorDetail(eventType: AutomationEventType | undefined, field: RegistryField): string | undefined {
  if (!eventType || !field.vendorField) return undefined;
  const entry = registryEntryFor(eventType);
  if (!entry || entry.vendorInterface === '-') return undefined;
  const vendorField = entry.vendorFields.find((candidate) => candidate.name === field.vendorField);
  const tsType = vendorField ? vendorField.tsType : field.tsType;
  return `proto ${entry.vendorInterface}.${field.vendorField}: ${tsType}`;
}

function inferSuggestionKind(value: JsonValue | undefined): AutocompleteItem['kind'] {
  if (value === undefined) return 'unknown';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'string': return 'string';
    case 'number': return 'number';
    case 'boolean': return 'boolean';
    case 'object': return 'object';
    default: return 'unknown';
  }
}

function matchesPathScope(path: string, value: JsonValue | undefined, mode: ObservedPathMode): boolean {
  if (mode === 'all') return true;
  const key = path.split('.').pop()?.toLowerCase() ?? '';
  if (mode === 'identity') {
    return /^(uniqueid|userid|nickname|username|roomid|creator|user)$/.test(key);
  }
  if (mode === 'text') {
    return /^(comment|message|text|nickname|giftname|action|reason|currencyname|name)$/.test(key)
      || (typeof value === 'string' && !/^(method|timestamp|type)$/.test(key));
  }
  return /(?:path|file|sound|audio|url|uri|asset|link|endpoint|webhook)/.test(key)
    || (typeof value === 'string' && /\.(wav|mp3|ogg|m4a|flac|aac)(?:[?#].*)?$/i.test(value));
}

export function flattenJsonPaths(value: JsonValue, prefix: string, depth = 0): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || depth >= 4) return [prefix];
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  if (entries.length === 0) return [prefix];
  return entries.flatMap(([key, entry]) => flattenJsonPaths(entry ?? null, `${prefix}.${key}`, depth + 1));
}

export function readTemplatePath(event: AutomationEvent, path: string): JsonValue | undefined {
  const parts = path.split('.').filter(Boolean);
  if (parts[0] === 'event') parts.shift();
  let current: JsonValue | undefined = event;
  for (const part of parts) {
    if (current === undefined || current === null || typeof current !== 'object') return undefined;
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
    } else {
      current = current[part];
    }
  }
  return current;
}

export function formatTemplateValue(value: JsonValue | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return truncate(`"${value}"`);
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return truncate(JSON.stringify(value) ?? String(value));
  } catch {
    return String(value);
  }
}

function humanizePath(path: string): string {
  const last = path.split('.').pop() ?? path;
  return last.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (character) => character.toUpperCase());
}

function truncate(value: string): string {
  return value.length > 96 ? `${value.slice(0, 93)}...` : value;
}
