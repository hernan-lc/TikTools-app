import { describe, expect, test } from 'bun:test';

import { createBuiltInNodeRegistry } from '../../../automation/nodes/builtins.ts';
import {
  appendNodeToGraph,
  createWorkflowGraph,
  createWorkflowNode,
  normalizeWorkflowGraph,
} from './graph.ts';

describe('workflow editor graph helpers', () => {
  const definitions = createBuiltInNodeRegistry().definitions();
  const trigger = definitions.find((definition) => definition.type === 'trigger.event');
  const log = definitions.find((definition) => definition.type === 'action.log');

  test('appends a step with one valid flow edge and no guessed data edges', () => {
    if (!trigger || !log) throw new Error('Built-in editor definitions are missing.');
    const graph = createWorkflowGraph('Test workflow', 'tiktok.chat', trigger);
    const nextNode = createWorkflowNode(log, graph.nodes.length);
    const next = appendNodeToGraph(graph, nextNode, definitions);

    expect(next.nodes).toHaveLength(2);
    expect(next.edges).toHaveLength(1);
    expect(next.edges[0]?.kind).toBe('flow');
    expect(next.edges[0]?.sourcePort).toBe('flow');
    expect(next.edges[0]?.targetPort).toBe('flow');
  });

  test('removes invalid persisted connections before rendering', () => {
    if (!trigger || !log) throw new Error('Built-in editor definitions are missing.');
    const graph = createWorkflowGraph('Test workflow', 'tiktok.chat', trigger);
    const nextNode = createWorkflowNode(log, graph.nodes.length);
    const invalid = appendNodeToGraph(graph, nextNode, definitions);
    invalid.edges.push({
      id: 'invalid',
      kind: 'data',
      source: invalid.nodes[0]?.id ?? '',
      sourcePort: 'event',
      target: nextNode.id,
      targetPort: 'uniqueId',
    });

    const normalized = normalizeWorkflowGraph(invalid, definitions);
    expect(normalized.edges).toHaveLength(1);
    expect(normalized.edges[0]?.kind).toBe('flow');
  });
});
