import type { UniversalEvent } from "./index.js";
export function mountEditor(
  root: HTMLElement,
  options?: {
    locale?: string;
    storage?: Pick<Storage, "getItem" | "setItem">;
    subscribe?: (fn: (event: UniversalEvent) => void) => () => void;
    onSave?: (text: string) => void;
  },
): {
  load(files: File[]): Promise<void>;
  send(event: UniversalEvent): void;
  export(): string | undefined;
  dispose(): void;
};
