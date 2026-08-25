import type { AutomationEventType, JsonObject } from '../types.ts';

/**
 * Behavior is two records, not one.
 *
 * An ACTION is a configured action type with a name of its own — "Aplausos" —
 * and can be reused by several events. An EVENT is a trigger plus optional
 * filters plus the actions it runs. There is no graph and no nesting: every
 * filter must pass, and an "or" is expressed inside a single filter with the
 * `in` operator.
 */
export type Locale = 'es' | 'en';
export type Localized = Record<Locale, string>;

export type ActionFieldKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'select'
  | 'boolean'
  | 'keyvalue'
  | 'code';

export interface ActionField {
  key: string;
  label: Localized;
  kind: ActionFieldKind;
  /** Default used when the action is created from this type. */
  value: string;
  placeholder?: string;
  options?: Array<{ value: string; label: Localized }>;
  /** True when `{{ event.* }}` placeholders are rendered before use. */
  template?: boolean;
  hint?: Localized;
}

export type ActionSource =
  | { kind: 'builtin' }
  | { kind: 'plugin'; pluginId: string };

export interface ActionTypeDefinition {
  id: string;
  title: Localized;
  description: Localized;
  /** Short machine-ish label shown on the card: fetch, emit, audio… */
  tag: string;
  source: ActionSource;
  fields: ActionField[];
  requiredCapabilities: string[];
}

export interface LiveAction {
  schemaVersion: 1;
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
  trigger: AutomationEventType;
  /** All of them must pass. Empty means the event always fires. */
  filters: EventFilter[];
  cooldownMs: number;
  cooldownScope: CooldownScope;
  actionIds: string[];
  runMode: EventRunMode;
}

export interface PluginDescriptor {
  id: string;
  name: string;
  version: string;
  description: Localized;
  /** What it needs from outside the app, in plain words. */
  dependency: Localized;
  permissions: string[];
  actionTypeIds: string[];
}

export interface PluginStatus {
  descriptor: PluginDescriptor;
  installed: boolean;
  enabled: boolean;
  /** False when the dependency cannot be loaded on this machine. */
  available: boolean;
  unavailableReason?: string;
}

export type RunStatus = 'ok' | 'error' | 'skipped';

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
}
