import type { NodeDefinition, WorkflowEdge, WorkflowGraph, WorkflowNode } from '../../../automation/types.ts';
import { IconTrash } from '../icons.tsx';
import { Badge, EmptyState } from '../ui/Card.tsx';
import { Button } from '../ui/Button.tsx';
import { t, type Locale } from '../../i18n.ts';

type WorkflowCanvasProps = {
  locale: Locale;
  graph: WorkflowGraph;
  definitions: NodeDefinition[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onAddNode: () => void;
  onDeleteNode: (nodeId: string) => void;
};

export function WorkflowCanvas({
  locale,
  graph,
  definitions,
  selectedNodeId,
  onSelectNode,
  onAddNode,
  onDeleteNode,
}: WorkflowCanvasProps) {
  const definitionMap = new Map(definitions.map((definition) => [definition.type, definition]));
  const orderedNodes = orderNodes(graph, definitionMap);

  if (orderedNodes.length === 0) {
    return (
      <div className="node-editor-canvas node-editor-canvas--empty">
        <EmptyState title={t(locale, 'emptyWorkflowTitle')} description={t(locale, 'emptyWorkflowHint')} action={<Button variant="primary" onClick={onAddNode}>{t(locale, 'addStep')}</Button>} />
      </div>
    );
  }

  return (
    <div className="node-editor-canvas">
      <div className="node-editor-canvas__intro">
        <div>
          <strong>{t(locale, 'workflowSteps')}</strong>
          <span>{t(locale, 'workflowStepsHint')}</span>
        </div>
        <Badge tone="cyan">{t(locale, 'nodeCount', { count: orderedNodes.length })}</Badge>
      </div>

      <div className="node-editor-flow-list">
        {orderedNodes.map((node, index) => {
          const definition = definitionMap.get(node.type);
          const next = orderedNodes[index + 1];
          const edge = next ? graph.edges.find((candidate) => candidate.kind === 'flow' && candidate.source === node.id && candidate.target === next.id) : undefined;
          return (
            <div key={node.id} className="node-editor-flow-item">
              <NodeCard
                locale={locale}
                node={node}
                definition={definition}
                index={index}
                selected={selectedNodeId === node.id}
                canDelete={definition?.kind !== 'trigger'}
                onSelect={() => onSelectNode(node.id)}
                onDelete={() => onDeleteNode(node.id)}
              />
              {next ? <FlowConnector locale={locale} edge={edge} /> : null}
            </div>
          );
        })}
      </div>

      <button type="button" className="node-editor-add-step" onClick={onAddNode}>
        <span>＋</span>
        <span>{t(locale, 'addStep')}</span>
      </button>
    </div>
  );
}

function NodeCard({
  locale,
  node,
  definition,
  index,
  selected,
  canDelete,
  onSelect,
  onDelete,
}: {
  locale: Locale;
  node: WorkflowNode;
  definition?: NodeDefinition;
  index: number;
  selected: boolean;
  canDelete: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const kind = definition?.kind ?? 'plugin';
  return (
    <article className={`node-editor-node-card ${selected ? 'is-selected' : ''} is-${kind}`}>
      <div className="node-editor-node-card__main">
        <button
          type="button"
          className="node-editor-node-card__select"
          onClick={onSelect}
          aria-pressed={selected}
        >
          <span className="node-editor-node-card__number">{index + 1}</span>
          <span className="node-editor-node-card__content">
            <span className="node-editor-node-card__topline">
              <strong>{definition?.title ?? node.type}</strong>
              <Badge tone={kind === 'action' ? 'pink' : kind === 'trigger' ? 'cyan' : 'neutral'}>{kind}</Badge>
            </span>
            <span className="node-editor-node-card__type">{node.type}</span>
            <span className="node-editor-node-card__summary">{nodeSummary(node, definition, locale)}</span>
          </span>
          <span className="node-editor-node-card__chevron">›</span>
        </button>
        <div className="node-editor-node-card__actions">
          {canDelete ? <Button variant="ghost" size="sm" icon={<IconTrash />} iconOnly tooltip={t(locale, 'removeStep')} onClick={onDelete} /> : <span className="node-editor-node-card__trigger-label">{t(locale, 'triggerStep')}</span>}
        </div>
      </div>
    </article>
  );
}

function FlowConnector({ locale, edge }: { locale: Locale; edge?: WorkflowEdge }) {
  return (
    <div className={`node-editor-flow-connector ${edge ? '' : 'is-disconnected'}`} aria-hidden="true">
      <span />
      <small>{edge ? t(locale, 'nextStep') : t(locale, 'notConnected')}</small>
      <span />
    </div>
  );
}

function orderNodes(graph: WorkflowGraph, definitions: Map<string, NodeDefinition>): WorkflowNode[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const next = new Map<string, string>();
  for (const edge of graph.edges) {
    if (edge.kind === 'flow' && !next.has(edge.source) && byId.has(edge.target)) next.set(edge.source, edge.target);
  }

  const trigger = graph.nodes.find((node) => definitions.get(node.type)?.kind === 'trigger');
  const ordered: WorkflowNode[] = [];
  const visited = new Set<string>();
  let current = trigger;
  while (current && !visited.has(current.id)) {
    ordered.push(current);
    visited.add(current.id);
    current = byId.get(next.get(current.id) ?? '');
  }
  for (const node of graph.nodes) {
    if (!visited.has(node.id)) ordered.push(node);
  }
  return ordered;
}

function nodeSummary(node: WorkflowNode, definition: NodeDefinition | undefined, locale: Locale): string {
  const config = node.config;
  switch (node.type) {
    case 'trigger.event': return eventLabel(String(config.eventType ?? '*'), locale);
    case 'condition.compare': return `${String(config.leftPath ?? 'event.data')}  ${operatorLabel(String(config.operator ?? 'equals'))}  ${String(config.right ?? '')}`;
    case 'transform.template': return String(config.template ?? '');
    case 'transform.script': return locale === 'es' ? 'Transforma los datos con JavaScript seguro' : 'Transforms data with sandboxed JavaScript';
    case 'control.delay': return `${String(config.delayMs ?? 0)} ms`;
    case 'control.cooldown': return `${String(config.durationMs ?? 0)} ms · ${String(config.key ?? '')}`;
    case 'action.log': return String(config.message ?? '');
    case 'action.http': return `${String(config.method ?? 'GET')} ${String(config.url ?? '')}`;
    case 'action.play-sound': return String(config.filePath ?? '');
    case 'action.tts': return String(config.text ?? '');
    case 'action.adjust-points': return `${String(config.uniqueId ?? '')} · ${String(config.delta ?? 0)}`;
    default: return definition?.title ?? node.type;
  }
}

function operatorLabel(value: string): string {
  const labels: Record<string, string> = {
    equals: '=',
    'not-equals': '≠',
    'greater-than': '>',
    'greater-or-equal': '≥',
    'less-than': '<',
    'less-or-equal': '≤',
    contains: 'contains',
    'starts-with': 'starts with',
    truthy: 'is true',
    falsy: 'is false',
  };
  return labels[value] ?? value;
}

function eventLabel(value: string, locale: Locale): string {
  const labels: Record<string, [string, string]> = {
    'tiktok.chat': ['Chat message', 'Mensaje de chat'],
    'tiktok.gift': ['Gift received', 'Regalo recibido'],
    'tiktok.like': ['Likes', 'Likes'],
    'tiktok.follow': ['New follower', 'Nuevo seguidor'],
    'tiktok.share': ['Live shared', 'LIVE compartido'],
    'tiktok.join': ['Viewer joined', 'Espectador entra'],
    'tiktok.social': ['Social action', 'Acción social'],
    'tiktok.room_stats': ['Room statistics', 'Estadísticas de sala'],
    'tiktok.connected': ['LIVE connected', 'LIVE conectado'],
    'tiktok.disconnected': ['LIVE disconnected', 'LIVE desconectado'],
    'points.awarded': ['Points awarded', 'Puntos otorgados'],
  };
  return labels[value]?.[locale === 'es' ? 1 : 0] ?? value;
}
