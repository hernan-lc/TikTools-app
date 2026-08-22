import type {
  NodeDefinition,
  PortDefinition,
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
} from './types.ts';
import type { NodeRegistry } from './node-registry.ts';

export interface GraphValidationIssue {
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export class GraphValidationError extends Error {
  constructor(public readonly issues: GraphValidationIssue[]) {
    super(issues.map((issue) => issue.message).join('; '));
    this.name = 'GraphValidationError';
  }
}

export function validateWorkflowGraph(
  graph: WorkflowGraph,
  registry: Pick<NodeRegistry, 'getDefinition'>,
): GraphValidationIssue[] {
  const issues: GraphValidationIssue[] = [];
  const nodes = new Map<string, WorkflowNode>();

  if (graph.schemaVersion !== 1) {
    issues.push({ code: 'schema-version', message: `Unsupported workflow schema version: ${graph.schemaVersion}` });
  }
  if (!graph.id.trim()) issues.push({ code: 'workflow-id', message: 'Workflow id cannot be empty.' });
  if (!graph.name.trim()) issues.push({ code: 'workflow-name', message: 'Workflow name cannot be empty.' });

  for (const node of graph.nodes) {
    if (!node.id.trim()) {
      issues.push({ code: 'node-id', message: 'Every workflow node needs an id.' });
      continue;
    }
    if (nodes.has(node.id)) {
      issues.push({ code: 'duplicate-node', message: `Duplicate workflow node id: ${node.id}`, nodeId: node.id });
    }
    nodes.set(node.id, node);

    const definition = registry.getDefinition(node.type);
    if (!definition) {
      issues.push({ code: 'unknown-node', message: `Unknown automation node type: ${node.type}`, nodeId: node.id });
    } else if (node.version > definition.version) {
      issues.push({
        code: 'node-version',
        message: `Node ${node.id} requires ${node.type} version ${node.version}, but only ${definition.version} is installed.`,
        nodeId: node.id,
      });
    }
  }

  const flowAdjacency = new Map<string, string[]>();
  for (const node of graph.nodes) flowAdjacency.set(node.id, []);

  for (const edge of graph.edges) {
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (!source || !target) {
      issues.push({ code: 'dangling-edge', message: `Edge ${edge.id} references a missing node.`, edgeId: edge.id });
      continue;
    }

    const sourceDefinition = registry.getDefinition(source.type);
    const targetDefinition = registry.getDefinition(target.type);
    if (!sourceDefinition || !targetDefinition) continue;

    const sourcePort = findPort(sourceDefinition, edge.kind, edge.sourcePort, false);
    const targetPort = findPort(targetDefinition, edge.kind, edge.targetPort, true);
    if (!sourcePort) {
      issues.push({ code: 'source-port', message: `Node ${source.id} has no ${edge.kind} output named ${edge.sourcePort}.`, edgeId: edge.id });
    }
    if (!targetPort) {
      issues.push({ code: 'target-port', message: `Node ${target.id} has no ${edge.kind} input named ${edge.targetPort}.`, edgeId: edge.id });
    }

    if (edge.kind === 'data' && sourcePort && targetPort && !isCompatible(sourcePort, targetPort)) {
      issues.push({
        code: 'port-type',
        message: `Cannot connect ${source.id}.${edge.sourcePort} (${sourcePort.valueType}) to ${target.id}.${edge.targetPort} (${targetPort.valueType}).`,
        edgeId: edge.id,
      });
    }
    if (edge.kind === 'flow') flowAdjacency.get(edge.source)?.push(edge.target);
  }

  for (const node of graph.nodes) {
    if (hasFlowCycle(node.id, flowAdjacency, new Set(), new Set())) {
      issues.push({
        code: 'flow-cycle',
        message: `Workflow contains a flow cycle reachable from node ${node.id}; add an explicit loop node in a later schema version.`,
        nodeId: node.id,
      });
      break;
    }
  }

  return issues;
}

export function assertValidWorkflowGraph(
  graph: WorkflowGraph,
  registry: Pick<NodeRegistry, 'getDefinition'>,
): void {
  const issues = validateWorkflowGraph(graph, registry);
  if (issues.length > 0) throw new GraphValidationError(issues);
}

export function isWorkflowGraph(value: unknown): value is WorkflowGraph {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const object = value as Record<string, unknown>;
  return object.schemaVersion === 1
    && typeof object.id === 'string'
    && typeof object.name === 'string'
    && typeof object.enabled === 'boolean'
    && Array.isArray(object.nodes)
    && Array.isArray(object.edges);
}

function findPort(
  definition: NodeDefinition,
  kind: 'flow' | 'data',
  name: string,
  input: boolean,
): PortDefinition | undefined {
  const collection = input ? definition.inputs : definition.outputs;
  return collection.find((port) => port.kind === kind && port.name === name);
}

function isCompatible(source: PortDefinition, target: PortDefinition): boolean {
  if (!source.valueType || !target.valueType) return true;
  if (source.valueType === target.valueType) return true;
  if (target.valueType === 'json' || source.valueType === 'json') return true;
  return false;
}

function hasFlowCycle(
  nodeId: string,
  adjacency: Map<string, string[]>,
  visiting: Set<string>,
  visited: Set<string>,
): boolean {
  if (visiting.has(nodeId)) return true;
  if (visited.has(nodeId)) return false;

  visiting.add(nodeId);
  for (const next of adjacency.get(nodeId) ?? []) {
    if (hasFlowCycle(next, adjacency, visiting, visited)) return true;
  }
  visiting.delete(nodeId);
  visited.add(nodeId);
  return false;
}
