import type { AutomationCapabilities } from '../capabilities.ts';
import type { AutomationEvent, JsonObject } from '../types.ts';
import type { ActionTypeDefinition, LiveAction } from './types.ts';

export interface ActionExecutionContext {
  action: LiveAction;
  event: AutomationEvent;
  capabilities: AutomationCapabilities;
  log(message: string, metadata?: JsonObject): void;
  publish(event: AutomationEvent): void;
}

export interface ActionExecutionResult {
  summary: string;
}

export interface ActionImplementation {
  definition: ActionTypeDefinition;
  execute(context: ActionExecutionContext): Promise<ActionExecutionResult>;
}

/**
 * Runtime registry for behavior actions. Built-ins, reviewed integrations,
 * and sandbox workers all register through this boundary.
 */
export class ActionRegistry {
  readonly #actions = new Map<string, ActionImplementation>();

  register(implementation: ActionImplementation): void {
    const id = implementation.definition.id;
    if (!/^[a-z0-9][a-z0-9._-]{1,127}$/i.test(id)) {
      throw new Error(`Invalid automation action id: ${id}`);
    }
    if (this.#actions.has(id)) throw new Error(`Automation action type is already registered: ${id}`);
    this.#actions.set(id, implementation);
  }

  unregister(id: string): boolean {
    return this.#actions.delete(id);
  }

  get(id: string): ActionImplementation | undefined {
    return this.#actions.get(id);
  }

  getDefinition(id: string): ActionTypeDefinition | undefined {
    return this.get(id)?.definition;
  }

  definitions(): ActionTypeDefinition[] {
    return [...this.#actions.values()]
      .map((implementation) => implementation.definition)
      .sort((a, b) => a.source.kind.localeCompare(b.source.kind) || a.title.en.localeCompare(b.title.en));
  }

  has(id: string): boolean {
    return this.#actions.has(id);
  }
}
