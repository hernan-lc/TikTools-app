export class EditorHistory<T = unknown> {
  constructor(capacity?: number, clone?: (value: T) => T);
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly depth: number;
  commit(before: T): void;
  undo(current: T): T | null;
  redo(current: T): T | null;
}
export interface PortableProject {
  contract: "universal-widget-project";
  schemaVersion: 1;
  widget: { id: string; version: string };
  settings: Record<string, unknown>;
  layout: { width: number; height: number; layers: unknown[] };
  state?: Record<string, unknown>;
  editor?: {
    grid?: number;
    bindings?: { setting: string; layerId: string; property: string }[];
  };
}
export function portableProject(
  widget: { id: string; version: string },
  settings: Record<string, unknown>,
  layout?: PortableProject["layout"],
): PortableProject;
export function inspectProject(value: unknown): PortableProject;
export function exportPreset(project: PortableProject): string;
export function importPreset(
  project: PortableProject,
  value: unknown,
  schema?: unknown,
): { project: PortableProject; warnings: string[] };
export function applyCommand(
  project: PortableProject,
  command: unknown,
  schema?: unknown,
): PortableProject;
export function migrateManifest(legacy: unknown): {
  manifest: unknown;
  warnings: string[];
};
export class EditorSession {
  constructor(
    project: PortableProject,
    options?: {
      save?: (text: string) => void;
      settingsSchema?: unknown;
      editorSchema?: unknown;
      capacity?: number;
    },
  );
  project: PortableProject;
  selection: string[];
  select(ids: string[]): void;
  execute(command: unknown): void;
  export(): string;
  import(text: string): void;
  undo(): void;
  redo(): void;
}
