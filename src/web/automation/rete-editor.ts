import { LitPlugin, Presets as LitPresets, type ClassicScheme } from '@retejs/lit-plugin';
import { NodeEditor, ClassicPreset } from 'rete';
import { AreaPlugin } from 'rete-area-plugin';
import { ConnectionPlugin, Presets as ConnectionPresets } from 'rete-connection-plugin';

import type {
  JsonObject,
  NodeDefinition,
  PortDefinition,
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
} from '../../automation/types.ts';

type ReteNode = ClassicPreset.Node;
type ReteSchemes = ClassicScheme;
type ReteConnection = ReteSchemes['Connection'];

export type ReteEditorHandle = {
  addNode: (definition: NodeDefinition) => Promise<void>;
  updateNodeConfig: (nodeId: string, config: JsonObject) => void;
  readGraph: () => WorkflowGraph;
  destroy: () => void;
};

type MountOptions = {
  container: HTMLElement;
  graph: WorkflowGraph;
  definitions: NodeDefinition[];
  onChange: (graph: WorkflowGraph) => void;
  onSelectNode: (nodeId: string | null) => void;
};

const flowSocket = new ClassicPreset.Socket('flow');
const dataSocket = new ClassicPreset.Socket('data');

/**
 * Rete is deliberately kept behind this adapter. The rest of TikTools only
 * deals with WorkflowGraph JSON and never persists Rete nodes or connections.
 */
export async function mountReteEditor(options: MountOptions): Promise<ReteEditorHandle> {
  const definitions = new Map(options.definitions.map((definition) => [definition.type, definition]));
  const workflowNodes = new Map<string, WorkflowNode>();
  const editor = new NodeEditor<ReteSchemes>();
  const area = new AreaPlugin<ReteSchemes>(options.container);
  const connection = new ConnectionPlugin<ReteSchemes>();
  const render = new LitPlugin<ReteSchemes>();

  render.addPreset(LitPresets.classic.setup() as never);
  // The two Rete plugins ship slightly different structural aliases for the
  // same classic scheme. Their runtime protocol is compatible, but TypeScript
  // cannot prove that across package boundaries.
  connection.addPreset(ConnectionPresets.classic.setup() as never);
  area.use(connection as never);
  area.use(render);
  editor.use(area);

  let ready = false;
  let destroyed = false;

  const emitChange = (): void => {
    if (!ready || destroyed) return;
    options.onChange(readGraph());
  };

  editor.addPipe((context) => {
    if (context.type === 'connectioncreated' || context.type === 'connectionremoved') emitChange();
    return context;
  });

  area.addPipe((context) => {
    if (context.type === 'nodepicked') {
      options.onSelectNode(context.data.id);
    }
    if (context.type === 'pointerdown' && context.data.event.target === options.container) {
      options.onSelectNode(null);
    }
    if (context.type === 'nodetranslated' || context.type === 'noderesized' || context.type === 'nodedragged') {
      emitChange();
    }
    return context;
  });

  const addWorkflowNode = async (workflowNode: WorkflowNode): Promise<ReteNode | undefined> => {
    const definition = definitions.get(workflowNode.type);
    if (!definition) return undefined;
    const node = createReteNode(workflowNode, definition);
    workflowNodes.set(workflowNode.id, cloneWorkflowNode(workflowNode));
    await editor.addNode(node);
    await area.translate(node.id, workflowNode.position);
    return node;
  };

  for (const workflowNode of options.graph.nodes) await addWorkflowNode(workflowNode);

  for (const edge of options.graph.edges) {
    const source = editor.getNode(edge.source);
    const target = editor.getNode(edge.target);
    if (!source || !target) continue;
    if (!hasPort(source, edge.kind, edge.sourcePort, false) || !hasPort(target, edge.kind, edge.targetPort, true)) continue;

    const reteConnection = new ClassicPreset.Connection(
      source,
      edge.sourcePort,
      target,
      edge.targetPort,
    ) as ReteConnection;
    reteConnection.id = edge.id;
    await editor.addConnection(reteConnection);
  }

  ready = true;

  const handle: ReteEditorHandle = {
    addNode: async (definition) => {
      const workflowNode = createWorkflowNode(definition, editor.getNodes().length);
      await addWorkflowNode(workflowNode);
      emitChange();
    },
    updateNodeConfig: (nodeId, config) => {
      if (!editor.getNode(nodeId)) return;
      const workflowNode = workflowNodes.get(nodeId);
      if (!workflowNode) return;
      workflowNodes.set(nodeId, { ...workflowNode, config: { ...config } });
      emitChange();
    },
    readGraph,
    destroy: () => {
      destroyed = true;
      area.destroy();
    },
  };

  return handle;

  function readGraph(): WorkflowGraph {
    const nodes: WorkflowNode[] = editor.getNodes().map((node) => ({
      ...(workflowNodes.get(node.id) ?? {
        id: node.id,
        type: '',
        version: 1,
        position: { x: 0, y: 0 },
        config: {},
      }),
      position: { ...(area.nodeViews.get(node.id)?.position ?? workflowNodes.get(node.id)?.position ?? { x: 0, y: 0 }) },
      config: { ...(workflowNodes.get(node.id)?.config ?? {}) },
    }));

    const edges: WorkflowEdge[] = editor.getConnections().map((reteEdge) => {
      const source = editor.getNode(reteEdge.source);
      const target = editor.getNode(reteEdge.target);
      const sourcePort = String(reteEdge.sourceOutput);
      const targetPort = String(reteEdge.targetInput);
      const kind = source && target && getPortKind(source, sourcePort, false) === 'flow' && getPortKind(target, targetPort, true) === 'flow'
        ? 'flow'
        : 'data';
      return {
        id: reteEdge.id,
        kind,
        source: reteEdge.source,
        sourcePort,
        target: reteEdge.target,
        targetPort,
      };
    });

    return {
      ...options.graph,
      nodes,
      edges,
    };
  }
}

function createReteNode(workflowNode: WorkflowNode, definition: NodeDefinition): ReteNode {
  const node = new ClassicPreset.Node(definition.title) as ReteNode;
  node.id = workflowNode.id;

  for (const port of definition.inputs) {
    node.addInput(port.name, new ClassicPreset.Input(socketFor(port), port.title, port.multiple ?? false));
  }
  for (const port of definition.outputs) {
    node.addOutput(port.name, new ClassicPreset.Output(socketFor(port), port.title, port.multiple ?? true));
  }

  return node;
}

function cloneWorkflowNode(workflowNode: WorkflowNode): WorkflowNode {
  return {
    ...workflowNode,
    position: { ...workflowNode.position },
    config: { ...workflowNode.config },
  };
}

function socketFor(port: PortDefinition): ClassicPreset.Socket {
  return port.kind === 'flow' ? flowSocket : dataSocket;
}

function hasPort(node: ReteNode, kind: 'flow' | 'data', name: string, input: boolean): boolean {
  return getPortKind(node, name, input) === kind;
}

function getPortKind(node: ReteNode, name: string, input: boolean): 'flow' | 'data' | undefined {
  const port = input ? node.inputs[name] : node.outputs[name];
  if (!port) return undefined;
  return port.socket === flowSocket ? 'flow' : 'data';
}

export function createWorkflowNode(definition: NodeDefinition, index: number): WorkflowNode {
  return {
    id: createId('node'),
    type: definition.type,
    version: definition.version,
    position: nextNodePosition(index),
    config: defaultConfig(definition),
  };
}

function defaultConfig(definition: NodeDefinition): JsonObject {
  switch (definition.type) {
    case 'trigger.event':
      return { eventType: 'tiktok.chat' };
    case 'condition.compare':
      return { leftPath: 'event.data', operator: 'equals', right: '' };
    case 'transform.template':
      return { template: '{{ event.user.nickname }}' };
    case 'transform.script':
      return { source: 'return inputs.value ?? event.data;', loopLimit: 1_000_000 };
    case 'control.delay':
      return { delayMs: 1000 };
    case 'control.cooldown':
      return { durationMs: 5000, key: '{{ event.user.uniqueId }}' };
    case 'action.log':
      return { message: '{{ event.type }}' };
    case 'action.http':
      return { method: 'GET', url: 'https://api.example.com/endpoint', responseType: 'auto', timeoutMs: 10000 };
    case 'action.play-sound':
      return { filePath: 'assets/sounds/notification.wav', volume: 1, overlap: 'allow' };
    case 'action.tts':
      return { text: '{{ event.data.comment }}', voice: 'M1', lang: 'en', format: 'wav' };
    case 'action.adjust-points':
      return { uniqueId: '{{ event.user.uniqueId }}', delta: 10 };
    default:
      return {};
  }
}

function nextNodePosition(index: number): { x: number; y: number } {
  const column = index % 3;
  const row = Math.floor(index / 3);
  return { x: 80 + column * 280, y: 80 + row * 180 };
}

function createId(prefix: string): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  return randomUuid ? `${prefix}-${randomUuid}` : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
