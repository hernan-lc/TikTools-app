import type { AutomationEvent, AutomationEventType } from './types.ts';

export type AutomationEventListener = (event: AutomationEvent) => void | Promise<void>;
export type AutomationEventSubscription = AutomationEventType | '*';

type ListenerRecord = {
  subscription: AutomationEventSubscription;
  listener: AutomationEventListener;
};

export class AutomationEventBus {
  readonly #listeners: ListenerRecord[] = [];
  readonly #queue: AutomationEvent[] = [];
  readonly #errors: Array<(error: unknown, event: AutomationEvent) => void> = [];
  #scheduled = false;
  #dispatching = false;
  #pending = 0;
  #idleResolvers: Array<() => void> = [];

  subscribe(subscription: AutomationEventSubscription, listener: AutomationEventListener): () => void {
    const record: ListenerRecord = { subscription, listener };
    this.#listeners.push(record);
    return () => {
      const index = this.#listeners.indexOf(record);
      if (index >= 0) this.#listeners.splice(index, 1);
    };
  }

  onError(listener: (error: unknown, event: AutomationEvent) => void): () => void {
    this.#errors.push(listener);
    return () => {
      const index = this.#errors.indexOf(listener);
      if (index >= 0) this.#errors.splice(index, 1);
    };
  }

  publish(event: AutomationEvent): void {
    this.#queue.push(event);
    this.#scheduleDrain();
  }

  async waitForIdle(): Promise<void> {
    if (!this.#scheduled && !this.#dispatching && this.#queue.length === 0 && this.#pending === 0) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.#idleResolvers.push(resolve);
    });
  }

  clear(): void {
    this.#queue.length = 0;
  }

  #scheduleDrain(): void {
    if (this.#scheduled) return;
    this.#scheduled = true;
    queueMicrotask(() => this.#drain());
  }

  #drain(): void {
    this.#scheduled = false;
    if (this.#dispatching) return;
    this.#dispatching = true;

    while (this.#queue.length > 0) {
      const event = this.#queue.shift();
      if (!event) continue;

      const listeners = this.#listeners.filter((record) =>
        record.subscription === '*' || record.subscription === event.type,
      );

      for (const record of listeners) {
        try {
          const result = record.listener(event);
          if (result && typeof result.then === 'function') {
            this.#pending += 1;
            void result
              .catch((error: unknown) => this.#reportError(error, event))
              .finally(() => {
                this.#pending -= 1;
                this.#resolveIdleIfReady();
              });
          }
        } catch (error) {
          this.#reportError(error, event);
        }
      }
    }

    this.#dispatching = false;
    this.#resolveIdleIfReady();
  }

  #reportError(error: unknown, event: AutomationEvent): void {
    for (const listener of this.#errors) {
      try {
        listener(error, event);
      } catch {
        // Error observers must not destabilize event delivery.
      }
    }
  }

  #resolveIdleIfReady(): void {
    if (this.#scheduled || this.#dispatching || this.#queue.length > 0 || this.#pending > 0) return;
    const resolvers = this.#idleResolvers.splice(0);
    for (const resolve of resolvers) resolve();
  }
}
