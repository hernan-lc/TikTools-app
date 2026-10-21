import { clone, validateEvent } from "./index.js";
export function receiverAddress(address) {
  const url = new URL(address);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("LOOPBACK_ADDRESS_REQUIRED");
  return url.origin;
}
export class OBSBridge {
  constructor({
    address = "http://127.0.0.1:17453",
    token,
    instance = "tiktools.local",
    capacity = 256,
    fetcher = fetch,
    schedule = setTimeout,
    cancel = clearTimeout,
  } = {}) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 4096)
      throw Error("INVALID_QUEUE_CAPACITY");
    this.address = receiverAddress(address);
    this.token = token;
    this.instance = instance;
    this.capacity = capacity;
    this.fetcher = fetcher;
    this.schedule = schedule;
    this.cancel = cancel;
    this.queue = [];
    this.running = false;
    this.sending = false;
    this.generation = 0;
    this.attempt = 0;
    this.stats = {
      delivered: 0,
      rejected: 0,
      dropped: 0,
      duplicates: 0,
      reconnects: 0,
    };
  }
  get queueDepth() {
    return this.queue.length;
  }
  async start() {
    if (this.running) return;
    if (!this.token) throw new Error("PAIRING_REQUIRED");
    const generation = ++this.generation;
    const response = await this.fetcher(this.address + "/v1/events/types", {
      headers: { Authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error("NEGOTIATION_FAILED");
    const result = await response.json();
    if (generation !== this.generation) return;
    if (result.version !== 1) throw new Error("INCOMPATIBLE_PROTOCOL");
    if (!Array.isArray(result.types)) throw new Error("INCOMPATIBLE_PROTOCOL");
    this.types = result.types;
    this.running = true;
    this.pump();
  }
  enqueue(event) {
    validateEvent(event);
    if (
      event.source.startsWith("obs.") ||
      event.metadata?.originInstance?.startsWith("obs.") ||
      (event.metadata?.hopCount ?? 0) >= 3
    ) {
      this.stats.rejected++;
      return false;
    }
    if (this.queue.length >= this.capacity) {
      this.stats.dropped++;
      return false;
    }
    this.queue.push({
      ...clone(event),
      metadata: {
        ...clone(event.metadata ?? {}),
        originInstance: event.metadata?.originInstance ?? this.instance,
        hopCount: (event.metadata?.hopCount ?? 0) + 1,
      },
    });
    this.pump();
    return true;
  }
  async pump() {
    if (
      !this.running ||
      this.sending ||
      this.timer !== undefined ||
      !this.queue.length
    )
      return;
    this.sending = true;
    const generation = this.generation;
    const event = this.queue[0];
    if (this.types && !this.types.includes(event.type)) {
      this.queue.shift();
      this.stats.rejected++;
      this.sending = false;
      queueMicrotask(() => this.pump());
      return;
    }
    try {
      this.controller = new AbortController();
      const timer = this.schedule(() => this.controller?.abort(), 3000);
      let response;
      try {
        response = await this.fetcher(this.address + "/v1/events", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(event),
          signal: this.controller.signal,
        });
      } finally {
        this.cancel(timer);
      }
      if (generation !== this.generation) return;
      if (response.status === 429 || response.status >= 500)
        throw new Error("RETRY");
      if (response.status === 401 || response.status === 403) {
        this.stats.rejected++;
        this.running = false;
        return;
      }
      this.queue.shift();
      this.attempt = 0;
      if (response.ok) {
        const result = await response.json();
        if (result.result === "duplicate") this.stats.duplicates++;
        else this.stats.delivered++;
      } else this.stats.rejected++;
    } catch {
      if (generation !== this.generation) return;
      this.stats.reconnects++;
      const delay = Math.min(30000, 250 * 2 ** Math.min(this.attempt++, 7));
      this.timer = this.schedule(() => {
        this.timer = undefined;
        this.pump();
      }, delay);
      return;
    } finally {
      if (generation === this.generation) this.sending = false;
    }
    if (this.running && this.queue.length)
      this.timer = this.schedule(() => {
        this.timer = undefined;
        this.pump();
      }, 0);
  }
  stop() {
    this.running = false;
    this.generation++;
    this.sending = false;
    this.controller?.abort();
    this.cancel(this.timer);
    this.timer = undefined;
    this.stats.dropped += this.queue.length;
    this.queue = [];
  }
}
