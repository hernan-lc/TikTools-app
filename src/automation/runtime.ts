import { assertValidWorkflowGraph } from './graph.ts';
import { NodeRegistry } from './node-registry.ts';
import type { AutomationCapabilities } from './capabilities.ts';
import type {
  AutomationEvent,
  ExecutionLogEntry,
  JsonObject,
  JsonValue,
  NodeDefinition,
  NodeExecutionContext,
  WorkflowGraph,
  WorkflowNode,
  WorkflowState,
} from './types.ts';

export interface WorkflowRunResult {
  runId: string;
  workflowId: string;
  status: 'completed' | 'failed' | 'cancelled' | 'skipped';
  error?: string;
}

export interface AutomationRuntimeOptions {
  maxConcurrentRuns?: number;
  maxStepsPerRun?: number;
  capabilities?: AutomationCapabilities;
  capabilitiesForPlugin?: (pluginId: string, available: AutomationCapabilities) => AutomationCapabilities;
  log?: (entry: ExecutionLogEntry) => void;
}

export class AutomationRuntime {
  readonly #registry: NodeRegistry;
  readonly #workflows = new Map<string, WorkflowGraph>();
  readonly #states = new Map<string, MemoryWorkflowState>();
  readonly #activeRuns = new Set<Promise<WorkflowRunResult>>();
  readonly #controllers = new Map<string, AbortController>();
  readonly #maxConcurrentRuns: number;
  readonly #maxStepsPerRun: number;
  readonly #capabilities: AutomationCapabilities;
  readonly #capabilitiesForPlugin: (pluginId: string, available: AutomationCapabilities) => AutomationCapabilities;
  readonly #logSink?: (entry: ExecutionLogEntry) => void;
  #runSequence = 0;

  constructor(registry: NodeRegistry, options: AutomationRuntimeOptions = {}) {
    this.#registry = registry;
    this.#maxConcurrentRuns = Math.max(1, options.maxConcurrentRuns ?? 64);
    this.#maxStepsPerRun = Math.max(1, options.maxStepsPerRun ?? 256);
    this.#capabilities = options.capabilities ?? {};
    this.#capabilitiesForPlugin = options.capabilitiesForPlugin ?? ((_pluginId, available) => available);
    this.#logSink = options.log;
  }

  get nodeRegistry(): NodeRegistry {
    return this.#registry;
  }

  getNodeDefinitions(): NodeDefinition[] {
    return this.#registry.definitions();
  }

  registerWorkflow(graph: WorkflowGraph): void {
    assertValidWorkflowGraph(graph, this.#registry);
    this.#workflows.set(graph.id, graph);
    if (!this.#states.has(graph.id)) this.#states.set(graph.id, new MemoryWorkflowState());
  }

  removeWorkflow(workflowId: string): boolean {
    this.#states.delete(workflowId);
    return this.#workflows.delete(workflowId);
  }

  setWorkflowEnabled(workflowId: string, enabled: boolean): WorkflowGraph {
    const graph = this.#workflows.get(workflowId);
    if (!graph) throw new Error(`Unknown workflow: ${workflowId}`);
    const updated: WorkflowGraph = { ...graph, enabled };
    this.#workflows.set(workflowId, updated);
    return updated;
  }

  getWorkflow(workflowId: string): WorkflowGraph | undefined {
    return this.#workflows.get(workflowId);
  }

  listWorkflows(): WorkflowGraph[] {
    return [...this.#workflows.values()].map((graph) => cloneGraph(graph));
  }

  handleEvent(event: AutomationEvent): void {
    for (const workflow of this.#workflows.values()) {
      if (!workflow.enabled) continue;
      const triggers = workflow.nodes.filter((node) => {
        if (node.disabled) return false;
        const implementation = this.#registry.get(node.type);
        if (implementation?.definition.kind !== 'trigger') return false;
        if (implementation.matchesTrigger) return implementation.matchesTrigger(node, event) === true;
        return implementation.definition.triggerTypes?.includes(event.type) ?? false;
      });
      if (triggers.length === 0) continue;
      void this.#startTrackedRun(workflow, event, triggers.map((node) => node.id));
    }
  }

  async runWorkflow(
    workflowId: string,
    event: AutomationEvent,
    startNodeIds?: string[],
  ): Promise<WorkflowRunResult> {
    const workflow = this.#workflows.get(workflowId);
    if (!workflow) throw new Error(`Unknown workflow: ${workflowId}`);
    if (!workflow.enabled && !startNodeIds) {
      return {
        runId: this.#nextRunId(workflowId),
        workflowId,
        status: 'skipped',
      };
    }

    if (this.#activeRuns.size >= this.#maxConcurrentRuns) {
      const runId = this.#nextRunId(workflowId);
      this.#writeLog({
        runId,
        workflowId,
        level: 'warn',
        message: 'Workflow run skipped because the runtime concurrency limit was reached.',
        timestamp: Date.now(),
      });
      return { runId, workflowId, status: 'skipped' };
    }

    const runId = this.#nextRunId(workflowId);
    const controller = new AbortController();
    this.#controllers.set(runId, controller);
    const state = this.#states.get(workflowId) ?? new MemoryWorkflowState();
    this.#states.set(workflowId, state);
    const starts = startNodeIds ?? workflow.nodes
      .filter((node) => this.#registry.get(node.type)?.definition.kind === 'trigger')
      .map((node) => node.id);

    const runContext = new RunContext(runId, workflow, event, state, controller.signal, this.#capabilities, this.#writeLog.bind(this), this.#maxStepsPerRun);
    this.#writeLog({
      runId,
      workflowId,
      level: 'debug',
      message: `Started workflow: ${workflow.name}`,
      timestamp: Date.now(),
    });

    try {
      for (const nodeId of starts) {
        await this.#executeNode(runContext, nodeId);
      }
      this.#writeLog({
        runId,
        workflowId,
        level: 'debug',
        message: 'Workflow completed.',
        timestamp: Date.now(),
      });
      return { runId, workflowId, status: 'completed' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = controller.signal.aborted ? 'cancelled' : 'failed';
      this.#writeLog({
        runId,
        workflowId,
        level: 'error',
        message,
        timestamp: Date.now(),
      });
      return { runId, workflowId, status, error: message };
    } finally {
      this.#controllers.delete(runId);
    }
  }

  cancelRun(runId: string): boolean {
    const controller = this.#controllers.get(runId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  cancelAll(): void {
    for (const controller of this.#controllers.values()) controller.abort();
  }

  async waitForIdle(): Promise<void> {
    while (this.#activeRuns.size > 0) {
      await Promise.all([...this.#activeRuns]);
    }
  }

  async #startTrackedRun(
    workflow: WorkflowGraph,
    event: AutomationEvent,
    startNodeIds: string[],
  ): Promise<void> {
    const run = this.runWorkflow(workflow.id, event, startNodeIds);
    this.#activeRuns.add(run);
    try {
      await run;
    } finally {
      this.#activeRuns.delete(run);
    }
  }

  async #executeNode(context: RunContext, nodeId: string): Promise<void> {
    context.step();
    if (context.signal.aborted) throw new Error('Automation run was cancelled.');

    const node = context.workflow.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) throw new Error(`Workflow node not found: ${nodeId}`);
    if (node.disabled) return;

    const implementation = this.#registry.get(node.type);
    if (!implementation) throw new Error(`Unknown automation node type: ${node.type}`);

    const inputs = context.inputsFor(nodeId, context.workflow.edges);
    const nodeContext: NodeExecutionContext = {
      runId: context.runId,
      workflowId: context.workflow.id,
      node,
      event: context.event,
      inputs,
      state: context.state,
      signal: context.signal,
      capabilities: this.#capabilitiesForPlugin(implementation.definition.pluginId, context.capabilities),
      log: (message, metadata) => {
        this.#writeLog({
          runId: context.runId,
          workflowId: context.workflow.id,
          nodeId: node.id,
          level: 'info',
          message,
          metadata,
          timestamp: Date.now(),
        });
      },
    };

    this.#writeLog({
      runId: context.runId,
      workflowId: context.workflow.id,
      nodeId: node.id,
      level: 'debug',
      message: `Executing ${node.type}.`,
      timestamp: Date.now(),
    });

    const result = await implementation.execute(nodeContext);
    context.setOutputs(node.id, result.outputs ?? {});
    const nextPorts = result.next ?? ['flow'];
    const outgoing = context.workflow.edges.filter((edge) =>
      edge.kind === 'flow' && edge.source === node.id && nextPorts.includes(edge.sourcePort),
    );

    for (const edge of outgoing) {
      await this.#executeNode(context, edge.target);
    }
  }

  #writeLog(entry: ExecutionLogEntry): void {
    if (this.#logSink) {
      try {
        this.#logSink(entry);
      } catch {
        // Logging must never fail an automation run.
      }
      return;
    }
    if (entry.level === 'error') console.error(`[automation:${entry.workflowId}] ${entry.message}`);
    else if (entry.level === 'warn') console.warn(`[automation:${entry.workflowId}] ${entry.message}`);
    else if (entry.level === 'info') console.log(`[automation:${entry.workflowId}] ${entry.message}`);
  }

  #nextRunId(workflowId: string): string {
    this.#runSequence += 1;
    return `${workflowId}-run-${Date.now().toString(36)}-${this.#runSequence.toString(36)}`;
  }
}

class RunContext {
  readonly #outputs = new Map<string, Record<string, JsonValue>>();
  #steps = 0;

  constructor(
    readonly runId: string,
    readonly workflow: WorkflowGraph,
    readonly event: AutomationEvent,
    readonly state: WorkflowState,
    readonly signal: AbortSignal,
    readonly capabilities: AutomationCapabilities,
    private readonly logger: (entry: ExecutionLogEntry) => void,
    private readonly maxSteps: number,
  ) {}

  step(): void {
    this.#steps += 1;
    if (this.#steps > this.maxSteps) {
      throw new Error(`Workflow exceeded the maximum of ${this.maxSteps} node steps.`);
    }
  }

  setOutputs(nodeId: string, outputs: Record<string, JsonValue>): void {
    this.#outputs.set(nodeId, outputs);
  }

  inputsFor(nodeId: string, edges: WorkflowGraph['edges']): Record<string, JsonValue | undefined> {
    const inputs: Record<string, JsonValue | undefined> = {};
    for (const edge of edges) {
      if (edge.kind !== 'data' || edge.target !== nodeId) continue;
      const sourceOutputs = this.#outputs.get(edge.source);
      const value = sourceOutputs?.[edge.sourcePort];
      if (value === undefined) continue;
      const existing = inputs[edge.targetPort];
      if (existing === undefined) {
        inputs[edge.targetPort] = value;
      } else if (Array.isArray(existing)) {
        inputs[edge.targetPort] = [...existing, value];
      } else {
        inputs[edge.targetPort] = [existing, value];
      }
    }
    return inputs;
  }
}

class MemoryWorkflowState implements WorkflowState {
  readonly #values = new Map<string, JsonValue>();

  get(key: string): JsonValue | undefined {
    return this.#values.get(key);
  }

  set(key: string, value: JsonValue): void {
    this.#values.set(key, value);
  }

  delete(key: string): void {
    this.#values.delete(key);
  }
}

function cloneGraph(graph: WorkflowGraph): WorkflowGraph {
  return JSON.parse(JSON.stringify(graph)) as WorkflowGraph;
}
