import registryFile from './event-registry.json';
import type { AutomationEvent, AutomationEventType, JsonObject } from './types.ts';

/**
 * Runtime loader for the generated event registry
 * (`src/automation/event-registry.json`, produced by
 * `scripts/generate-event-registry.ts` from the canonical TypeScript schemes
 * + TikTok proto types + translation catalog).
 *
 * This module is UI-agnostic on purpose: `src/automation` never imports from
 * `src/web`. It exposes registry fields (path, TS type, kind, labels, live
 * sample) and sample events. Every autocomplete list, condition field and
 * sample event in the app derives from here — see
 * `web/components/node-editor/template-suggestions.ts` and
 * `automation/behavior/fields.ts`.
 */

export type RegistryFieldKind = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null' | 'unknown';

export interface RegistryField {
  path: string;
  tsType: string;
  kind: RegistryFieldKind;
  optional: boolean;
  i18key?: string;
  label: { en: string; es: string };
  hint?: { en: string; es: string };
  sample?: unknown;
  vendorField?: string;
}

export interface RegistryVendorField {
  name: string;
  tsType: string;
  optional: boolean;
}

export interface RegistryEventEntry {
  dataInterface: string;
  vendorInterface: string;
  note?: string;
  sampleEvent: AutomationEvent;
  fields: RegistryField[];
  vendorFields: RegistryVendorField[];
}

interface RegistryFile {
  version: number;
  generatedBy: string;
  generatedFrom: string[];
  events: Record<string, RegistryEventEntry>;
}

const REGISTRY = registryFile as unknown as RegistryFile;

export const EVENT_REGISTRY_VERSION = REGISTRY.version;

/** Every event type the registry knows, in generation order. */
export function registryEventTypes(): AutomationEventType[] {
  return Object.keys(REGISTRY.events) as AutomationEventType[];
}

export function registryEntryFor(eventType: AutomationEventType): RegistryEventEntry | undefined {
  return REGISTRY.events[eventType];
}

/** All `event.*` paths (with types, labels, samples) for one trigger. */
export function fieldsForEventType(eventType: AutomationEventType): RegistryField[] {
  return registryEntryFor(eventType)?.fields ?? [];
}

/** Union of every trigger's fields, deduplicated by path. */
export function allRegistryFields(): RegistryField[] {
  const seen = new Set<string>();
  const out: RegistryField[] = [];
  for (const entry of Object.values(REGISTRY.events)) {
    for (const field of entry.fields) {
      if (seen.has(field.path)) continue;
      seen.add(field.path);
      out.push(field);
    }
  }
  return out;
}

/** Fresh sample event for a trigger (timestamp refreshed, safe to mutate). */
export function sampleEventForType(eventType: AutomationEventType): AutomationEvent {
  const entry = registryEntryFor(eventType);
  if (!entry) {
    return {
      id: 'sample-event', type: eventType, timestamp: Date.now(),
      user: { uniqueId: 'usuario_demo' }, data: {},
    };
  }
  const clone = structuredClone(entry.sampleEvent) as AutomationEvent;
  clone.timestamp = Date.now();
  return clone;
}

/** The `data` payload of the sample event, for script/language services. */
export function sampleDataForType(eventType: AutomationEventType): JsonObject {
  const event = sampleEventForType(eventType);
  const data = event.data;
  return (data !== null && typeof data === 'object' && !Array.isArray(data) ? data : {}) as JsonObject;
}

/** True when the registry documents a path for a trigger (drift guard). */
export function registryHasPath(eventType: AutomationEventType, path: string): boolean {
  return fieldsForEventType(eventType).some((field) => field.path === path);
}
