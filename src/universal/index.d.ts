export interface UniversalEvent {
  version: 1;
  id: string;
  source: string;
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
  metadata?: {
    correlationId?: string;
    originInstance?: string;
    hopCount?: number;
    room?: string;
    legacy?: Record<string, unknown>;
  };
}
export interface Manifest {
  contract: "universal-widget";
  schemaVersion: 3;
  id: string;
  name: string;
  version: string;
  engine: "web";
  entry: string;
  events: string[];
  defaultSize: { width: number; height: number };
  schemas?: Record<string, string>;
  capabilities: string[];
}
export function clone<T>(value: T): T;
export function canonical(value: unknown): string;
export function validate(schema: unknown, value: unknown): string[];
export function assertValid<T>(schema: unknown, value: T): T;
export function validateEvent(value: unknown): UniversalEvent;
export function validateManifest(
  value: unknown,
  supported?: readonly string[],
): Manifest;
export function fromOBS(event: unknown, instance?: string): UniversalEvent;
export function fromTikTools(
  event: unknown,
  instance?: string,
): UniversalEvent | null;
export function safePath(value: unknown): boolean;
export function assertSupportedSchema(schema: unknown): void;
export function validateProject(value: unknown): unknown;
export class EventRouter {
  constructor(options?: {
    capacity?: number;
    instance?: string;
    maxHop?: number;
  });
  stats: {
    accepted: number;
    duplicate: number;
    rejected: number;
    delivered: number;
    failed: number;
  };
  subscribe(handler: (event: UniversalEvent) => void): () => void;
  push(event: UniversalEvent): "invalid" | "loop" | "duplicate" | "accepted";
}
export const capabilities: readonly string[];
export const protocolVersion: 1;
export class WidgetRuntime {
  constructor(widget: UniversalWidget, host: UniversalHost, manifest: Manifest);
  initialize(settings?: Record<string, unknown>): Promise<void>;
  updateSettings(settings: Record<string, unknown>): Promise<void>;
  dispose(): Promise<void>;
  preview(event: UniversalEvent): string;
}
export interface UniversalWidget {
  initialize?(context: {
    settings: Record<string, unknown>;
    capabilities: string[];
  }): void | Promise<void>;
  mount?(root: HTMLElement): void | Promise<void>;
  updateSettings?(settings: Record<string, unknown>): void | Promise<void>;
  onEvent?(event: UniversalEvent): void | Promise<void>;
  dispose?(): void | Promise<void>;
}
export interface UniversalHost {
  root: HTMLElement;
  instance: string;
  preview?: boolean;
  capabilities: readonly string[];
  settingsSchema?: unknown;
  subscribe(fn: (event: UniversalEvent) => void): () => void;
  onError?: (error: unknown) => void;
}
export function browserHost(
  root: HTMLElement,
  options?: Partial<UniversalHost>,
): UniversalHost;
export function replay(
  events: UniversalEvent[],
  emit: (event: UniversalEvent) => void,
  options?: { speed?: number },
): () => void;
