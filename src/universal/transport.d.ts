import type { UniversalEvent } from "./index.js";
export function receiverAddress(address: string): string;
export class OBSBridge {
  constructor(options?: {
    address?: string;
    token?: string;
    instance?: string;
    capacity?: number;
    fetcher?: typeof fetch;
    schedule?: typeof setTimeout;
    cancel?: typeof clearTimeout;
  });
  token?: string;
  readonly queueDepth: number;
  stats: {
    delivered: number;
    rejected: number;
    dropped: number;
    duplicates: number;
    reconnects: number;
  };
  start(): Promise<void>;
  enqueue(event: UniversalEvent): boolean;
  stop(): void;
}
