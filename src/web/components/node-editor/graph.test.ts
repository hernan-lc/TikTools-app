import { describe, expect, test } from 'bun:test';

import { createBuiltInNodeRegistry } from '../../../automation/nodes/builtins.ts';
import {
  appendNodeToGraph,
  createWorkflowGraph,
  createWorkflowNode,
  normalizeWorkflowGraph,
} from './graph.ts';
import { getTemplateSuggestions } from './template-suggestions.ts';

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

  test('builds template suggestions from the last event and includes live previews', () => {
    const suggestions = getTemplateSuggestions('tiktok.gift', 'en', {
      id: 'event-1',
      type: 'tiktok.gift',
      timestamp: 1,
      user: { uniqueId: 'viewer' },
      data: { giftName: 'Rose', diamondCount: 25 },
    });

    expect(suggestions.find((suggestion) => suggestion.value === 'event.data.diamondCount')).toMatchObject({
      preview: '25',
    });
    expect(suggestions.some((suggestion) => suggestion.value === 'event.user.uniqueId')).toBe(true);
  });

  test('does not use an unrelated last event as a live preview', () => {
    const suggestions = getTemplateSuggestions('tiktok.gift', 'en', {
      id: 'event-2',
      type: 'tiktok.chat',
      timestamp: 2,
      user: { uniqueId: 'viewer' },
      data: { comment: 'hello', customValue: 42 },
    });

    expect(suggestions.find((suggestion) => suggestion.value === 'event.data.diamondCount')?.preview).toBeUndefined();
    expect(suggestions.find((suggestion) => suggestion.value === 'event.data.customValue')).toBeUndefined();
  });
});
