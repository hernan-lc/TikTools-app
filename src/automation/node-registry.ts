import type {
  NodeDefinition,
  NodeImplementation,
  WorkflowNode,
} from './types.ts';

export class NodeRegistry {
  readonly #nodes = new Map<string, NodeImplementation>();

  register(implementation: NodeImplementation): void {
    const { type } = implementation.definition;
    if (this.#nodes.has(type)) {
      throw new Error(`Automation node type is already registered: ${type}`);
    }
    this.#nodes.set(type, implementation);
  }

  replace(implementation: NodeImplementation): void {
    this.#nodes.set(implementation.definition.type, implementation);
  }

  unregister(type: string): boolean {
    return this.#nodes.delete(type);
  }

  get(type: string): NodeImplementation | undefined {
    return this.#nodes.get(type);
  }

  require(type: string): NodeImplementation {
    const implementation = this.get(type);
    if (!implementation) throw new Error(`Unknown automation node type: ${type}`);
    return implementation;
  }

  getDefinition(type: string): NodeDefinition | undefined {
    return this.get(type)?.definition;
  }

  definitions(): NodeDefinition[] {
    return [...this.#nodes.values()]
      .map((implementation) => implementation.definition)
      .sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
  }

  hasNode(node: WorkflowNode): boolean {
    return this.#nodes.has(node.type);
  }
}
