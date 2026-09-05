import type { AutomationEventType, JsonObject } from '../types.ts';

/** A built-in trigger or a plugin-declared event type (hotkey.pressed). */
export type TriggerType = AutomationEventType | (string & {});

/**
 * Behavior is two records, not one.
 *
 * An ACTION is a configured action type with a name of its own — "Aplausos" —
 * and can be reused by several events. An EVENT is a trigger plus optional
 * filters plus the actions it runs. There is no graph and no nesting: every
 * filter must pass, and an "or" is expressed inside a single filter with the
 * `in` operator.
 */
/**
 * Localized metadata is intentionally a small, serializable value object.
 *
 * `default` keeps a plugin usable when its optional locale file is missing;
 * `i18key` is the stable lookup key used by the host translation catalog.
 * Plugins should namespace keys with their plugin id.
 */
export interface I18nText extends JsonObject {
  default: string;
  i18key: string;
}

/** Locale -> key -> translated value. Locale files use this exact shape. */
export type TranslationCatalog = Record<string, Record<string, string>>;

/** Every localized descriptor uses the default/key contract. */
export type Localized = I18nText;

export type ActionFieldKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'range'
  | 'select'
  | 'boolean'
  | 'keyvalue'
  | 'media'
  | 'code';

/**
 * A field that only makes sense once another one holds a certain value —
 * a body has nothing to say on a GET. Hidden fields keep their stored value,
 * so switching back does not lose what was typed.
 */
export interface FieldCondition {
  key: string;
  equals?: string[];
  notEquals?: string[];
}

export interface ActionField {
  key: string;
  label: Localized;
  kind: ActionFieldKind;
  /** Default used when the action is created from this type. */
  value: string;
  /** Bounds for `range` fields (slider); ignored by other kinds. */
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  options?: Array<{ value: string; label: Localized }>;
  /** True when `{{ event.* }}` placeholders are rendered before use. */
  template?: boolean;
  /** Kept behind the "advanced options" disclosure so the form stays short. */
  advanced?: boolean;
  hint?: Localized;
  /** Rendered only while this holds. */
  showIf?: FieldCondition;
}

export type ActionSource =
  | { kind: 'builtin' }
  | { kind: 'plugin'; pluginId: string };

export interface ActionTypeDefinition {
  id: string;
  /** Versioned configuration contract shared by the host and plugins. */
  version?: number;
  title: Localized;
  description: Localized;
  /** Short machine-ish label shown on the card: fetch, emit, audio… */
  tag: string;
  source: ActionSource;
  /** Optional field descriptors for small runtimes that do not need JSON Schema. */
  fields?: ActionField[];
  /** JSON Schema subset used by the host-owned configuration renderer. */
  configSchema?: JsonObject;
  /** Host-owned presentation hints; never executable plugin code. */
  uiHints?: JsonObject;
  requiredCapabilities: string[];
}

export interface PluginEventField {
  /** Dotted path, exactly what filters store. */
  path: string;
  kind: 'text' | 'number' | 'boolean';
  label?: Localized;
  hint?: Localized;
  /** Fixed choices render as a dropdown instead of free text. */
  options?: Array<{ value: string; label?: Localized }>;
}

export interface PluginEventType {
  /** Dotted lowercase name, never in a host namespace (hotkey.pressed). */
  type: string;
  title: Localized;
  description?: Localized;
  fields?: PluginEventField[];
  /** Example payload merged into test-event samples. */
  sample?: JsonObject;
  source: ActionSource;
}

export interface LiveAction {
  /** Version 2 is the descriptor/JSON-schema action format; v1 is migrated on read. */
  schemaVersion: 1 | 2;
  id: string;
  name: string;
  typeId: string;
  enabled: boolean;
  /** Field key → value. Key/value fields hold a nested object of strings. */
  config: JsonObject;
}

export type FilterOperator =
  | 'gte'
  | 'gt'
  | 'lte'
  | 'lt'
  | 'eq'
  | 'neq'
  | 'contains'
  | 'starts-with'
  | 'in'
  | 'is-true'
  | 'is-false';

export interface EventFilter {
  /** Dotted path resolved against `{ event, data, user }`. */
  path: string;
  operator: FilterOperator;
  /** Single-value operators. */
  value: string;
  /** `in` only: the "or" lives here instead of in a nested group. */
  values?: string[];
}

export type EventRunMode = 'all' | 'random';
export type CooldownScope = 'global' | 'user';

export interface LiveEvent {
  schemaVersion: 1;
  id: string;
  name: string;
  enabled: boolean;
  trigger: TriggerType;
  /** All of them must pass. Empty means the event always fires. */
  filters: EventFilter[];
  cooldownMs: number;
  cooldownScope: CooldownScope;
  actionIds: string[];
  runMode: EventRunMode;
}

export interface PluginDescriptor {
  id: string;
  source?: 'builtin' | 'user' | 'development';
  name: Localized;
  version: string;
  description: Localized;
  /** What it needs from outside the app, in plain words. */
  dependency: Localized;
  permissions: string[];
  actionTypeIds: string[];
  eventTypeIds: string[];
  /** True when the plugin declares a JSON settings schema for the Plugins UI. */
  hasSettings?: boolean;
}

export interface PluginStatus {
  descriptor: PluginDescriptor;
  installed: boolean;
  enabled: boolean;
  running?: boolean;
  /** False when the dependency cannot be loaded on this machine. */
  available: boolean;
  unavailableReason?: string;
}

export type RunStatus = 'ok' | 'error';

export interface BehaviorRun {
  id: string;
  at: number;
  status: RunStatus;
  eventId?: string;
  eventName?: string;
  actionId?: string;
  actionName: string;
  summary: string;
  durationMs: number;
  test: boolean;
  logs: string[];
  error?: string;
}

export interface BehaviorSnapshot {
  actions: LiveAction[];
  events: LiveEvent[];
  plugins: PluginStatus[];
  actionTypes: ActionTypeDefinition[];
  /** Plugin-declared event types merged by the host; absent on old hosts. */
  eventTypes?: PluginEventType[];
  /** Host and loaded plugin translations, keyed by locale and i18key. */
  translations: TranslationCatalog;
}
