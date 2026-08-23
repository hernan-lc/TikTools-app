import { useEffect, useState } from 'preact/hooks';

import type {
  AutomationEventType,
  AutomationScriptAnalysis,
  JsonObject,
  NodeDefinition,
  WorkflowGraph,
} from '../../automation/types.ts';
import type { AutomationWorkflowRecord } from '../../shared/messages.ts';
import { IconSparkles, IconTrash } from '../components/icons.tsx';
import { Alert, Badge, EmptyState } from '../components/ui/Card.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Checkbox } from '../components/ui/Checkbox.tsx';
import { ConfirmModal, TextPromptModal } from '../components/ui/Modal.tsx';
import { PageHeader } from '../components/ui/Page.tsx';
import {
  NodeConfigModal,
  NodePickerModal,
  WorkflowCanvas,
  WorkflowWizardModal,
  appendNodeToGraph,
  createWorkflowGraph,
  createWorkflowNode,
  normalizeWorkflowGraph,
  removeNodeFromGraph,
} from '../components/node-editor/index.ts';
import { t, type Locale } from '../i18n.ts';

type AutomationsViewProps = {
  locale: Locale;
  workflows: AutomationWorkflowRecord[];
  nodes: NodeDefinition[];
  error?: string;
  scriptAnalysis?: AutomationScriptAnalysis;
  onRefresh: () => void;
  onSave: (graph: WorkflowGraph) => void;
  onDelete: (id: string) => void;
  onSetEnabled: (id: string, enabled: boolean) => void;
  onAnalyzeScript: (nodeId: string, source: string, offset: number, eventType?: AutomationEventType) => void;
};

type PendingWorkflowAction =
  | { kind: 'select'; record: AutomationWorkflowRecord }
  | { kind: 'create' };

type WorkflowConfirmState =
  | { kind: 'discard'; action: PendingWorkflowAction }
  | { kind: 'delete'; id: string; name: string };

export function AutomationsView({
  locale,
  workflows,
  nodes,
  error,
  scriptAnalysis,
  onRefresh,
  onSave,
  onDelete,
  onSetEnabled,
  onAnalyzeScript,
}: AutomationsViewProps) {
  const initialRecord = workflows[0];
  const initialGraph = initialRecord ? prepareGraph(initialRecord.graph, nodes) : null;
  const [selectedId, setSelectedId] = useState<string | null>(initialRecord?.id ?? null);
  const [draft, setDraft] = useState<WorkflowGraph | null>(initialGraph);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(initialGraph?.nodes[0]?.id ?? null);
  const [dirty, setDirty] = useState(false);
  const [editorError, setEditorError] = useState('');
  const [wizardOpen, setWizardOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [configuringNodeId, setConfiguringNodeId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<WorkflowConfirmState | null>(null);

  const selectedRecord = selectedId ? workflows.find((workflow) => workflow.id === selectedId) : undefined;
  const selectedNode = draft?.nodes.find((node) => node.id === selectedNodeId);
  const selectedDefinition = selectedNode ? nodes.find((node) => node.type === selectedNode.type) : undefined;
  const configuringNode = draft?.nodes.find((node) => node.id === configuringNodeId);
  const configuringDefinition = configuringNode ? nodes.find((node) => node.type === configuringNode.type) : undefined;

  useEffect(() => {
    if (selectedId || workflows.length === 0 || dirty) return;
    const first = workflows[0];
    if (!first) return;
    const nextGraph = prepareGraph(first.graph, nodes);
    setSelectedId(first.id);
    setDraft(nextGraph);
    setSelectedNodeId(nextGraph.nodes[0]?.id ?? null);
  }, [selectedId, workflows, nodes, dirty]);

  useEffect(() => {
    if (!selectedId || dirty) return;
    const record = workflows.find((workflow) => workflow.id === selectedId);
    if (!record) return;
    const nextGraph = prepareGraph(record.graph, nodes);
    setDraft(nextGraph);
    setSelectedNodeId((current) => nextGraph.nodes.some((node) => node.id === current) ? current : nextGraph.nodes[0]?.id ?? null);
  }, [selectedId, workflows, nodes, dirty]);

  useEffect(() => {
    if (!dirty || !draft || !selectedId) return;
    const record = workflows.find((workflow) => workflow.id === selectedId);
    if (record && graphsEqual(record.graph, draft)) setDirty(false);
  }, [draft, dirty, selectedId, workflows]);

  useEffect(() => {
    if (!draft?.nodes.length) {
      setSelectedNodeId(null);
      return;
    }
    if (!selectedNodeId || !draft.nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(draft.nodes[0]?.id ?? null);
    }
  }, [draft?.id, draft?.nodes.length, selectedNodeId]);

  const updateDraft = (update: (current: WorkflowGraph) => WorkflowGraph): void => {
    setDraft((current) => current ? update(current) : current);
    setDirty(true);
    setEditorError('');
  };

  const applyWorkflowAction = (action: PendingWorkflowAction): void => {
    if (action.kind === 'create') {
      setWizardOpen(true);
      return;
    }
    const nextGraph = prepareGraph(action.record.graph, nodes);
    setSelectedId(action.record.id);
    setDraft(nextGraph);
    setSelectedNodeId(nextGraph.nodes[0]?.id ?? null);
    setConfiguringNodeId(null);
    setDirty(!graphsEqual(action.record.graph, nextGraph));
    setEditorError('');
  };

  const requestWorkflowAction = (action: PendingWorkflowAction): void => {
    if (dirty) {
      setConfirmModal({ kind: 'discard', action });
      return;
    }
    applyWorkflowAction(action);
  };

  const selectWorkflow = (record: AutomationWorkflowRecord): void => {
    if (record.id === selectedId) return;
    requestWorkflowAction({ kind: 'select', record });
  };

  const requestCreateWorkflow = (): void => requestWorkflowAction({ kind: 'create' });

  const handleCreateWorkflow = (name: string, eventType: AutomationEventType): void => {
    const triggerDefinition = nodes.find((definition) => definition.type === 'trigger.event');
    if (!triggerDefinition) {
      setEditorError('The Event Trigger node is not available. Refresh the node catalog.');
      return;
    }
    const graph = createWorkflowGraph(name, eventType, triggerDefinition);
    setWizardOpen(false);
    setSelectedId(graph.id);
    setDraft(graph);
    setSelectedNodeId(graph.nodes[0]?.id ?? null);
    setConfiguringNodeId(null);
    setDirty(true);
    setEditorError('');
  };

  const handleRename = (name: string): void => {
    setRenameValue(null);
    updateDraft((current) => ({ ...current, name }));
  };

  const handleAddNode = (definition: NodeDefinition): void => {
    if (!draft || definition.kind === 'trigger') return;
    const node = createWorkflowNode(definition, draft.nodes.length);
    const nextGraph = appendNodeToGraph(draft, node, nodes);
    setDraft(nextGraph);
    setSelectedNodeId(node.id);
    setConfiguringNodeId(null);
    setPickerOpen(false);
    setDirty(true);
    setEditorError('');
  };

  const handleDeleteNode = (nodeId: string): void => {
    if (!draft) return;
    const node = draft.nodes.find((item) => item.id === nodeId);
    if (!node || node.type === 'trigger.event') return;
    const nodeIndex = draft.nodes.findIndex((item) => item.id === nodeId);
    const nextGraph = removeNodeFromGraph(draft, nodeId, nodes);
    setDraft(nextGraph);
    setSelectedNodeId(nextGraph.nodes[Math.max(0, nodeIndex - 1)]?.id ?? nextGraph.nodes[0]?.id ?? null);
    setConfiguringNodeId((current) => current === nodeId ? null : current);
    setDirty(true);
  };

  const handleConfigChange = (config: JsonObject): void => {
    if (!selectedNode) return;
    updateDraft((current) => ({
      ...current,
      nodes: current.nodes.map((node) => node.id === selectedNode.id ? { ...node, config: { ...config } } : node),
    }));
  };

  const openConfiguration = (): void => {
    if (selectedNode) setConfiguringNodeId(selectedNode.id);
  };

  const handleSave = (): void => {
    if (!draft) return;
    onSave(prepareGraph(draft, nodes));
  };

  const handleDeleteWorkflow = (): void => {
    if (!selectedId || !selectedRecord) return;
    setConfirmModal({ kind: 'delete', id: selectedId, name: selectedRecord.name });
  };

  const confirmDelete = (id: string): void => {
    setConfirmModal(null);
    onDelete(id);
    setSelectedId(null);
    setDraft(null);
    setSelectedNodeId(null);
    setConfiguringNodeId(null);
    setDirty(false);
  };

  return (
    <main className="automation-view">
      <PageHeader
        title={t(locale, 'automations')}
        subtitle={t(locale, 'automationsLead')}
        icon={<IconSparkles />}
        action={
          <div className="automation-header-actions">
            <Button variant="ghost" size="sm" onClick={onRefresh}>{t(locale, 'refresh')}</Button>
            <Button variant="primary" size="sm" onClick={requestCreateWorkflow}>{t(locale, 'newWorkflow')}</Button>
          </div>
        }
      />

      {error ? <Alert variant="danger">{error}</Alert> : null}
      {editorError ? <Alert variant="warning">{editorError}</Alert> : null}

      <div className="automation-workspace automation-workspace--simple">
        <aside className="automation-sidebar">
          <div className="automation-panel-heading">
            <span>{t(locale, 'automations')}</span>
            <Badge tone="cyan">{workflows.length}</Badge>
          </div>

          {workflows.length === 0 ? (
            <EmptyState title={t(locale, 'noWorkflows')} action={<Button variant="soft" size="sm" onClick={requestCreateWorkflow}>{t(locale, 'newWorkflow')}</Button>} />
          ) : (
            <div className="automation-workflow-list">
              {workflows.map((record) => (
                <button key={record.id} type="button" className={`automation-workflow-item ${selectedId === record.id ? 'is-active' : ''}`} onClick={() => selectWorkflow(record)}>
                  <span className="automation-workflow-item__name">{record.name}</span>
                  <span className="automation-workflow-item__meta">
                    <span>{t(locale, 'nodeCount', { count: record.graph.nodes.length })}</span>
                    <span className={`automation-status-dot ${record.enabled ? 'is-enabled' : ''}`} />
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="automation-catalog">
            <div className="automation-panel-heading">
              <span>{t(locale, 'nodeCatalog')}</span>
              <Badge>{Math.max(0, nodes.filter((node) => node.kind !== 'trigger').length)}</Badge>
            </div>
            <p className="automation-panel-hint">{t(locale, 'automationAddNodeHint')}</p>
            <Button variant="cyan" block disabled={!draft} onClick={() => setPickerOpen(true)}>{`＋ ${t(locale, 'addStep')}`}</Button>
            <p className="automation-panel-hint automation-panel-hint--secondary">{t(locale, 'automationFlowHint')}</p>
          </div>
        </aside>

        <section className="automation-editor-panel">
          {!draft ? (
            <EmptyState title={t(locale, 'selectWorkflow')} description={t(locale, 'noWorkflows')} action={<Button variant="primary" onClick={requestCreateWorkflow}>{t(locale, 'newWorkflow')}</Button>} />
          ) : (
            <>
              <div className="automation-editor-toolbar">
                <div className="automation-workflow-name">
                  <button type="button" className="automation-workflow-name-button" onClick={() => setRenameValue(draft.name)}>
                    <span className="automation-workflow-name-button__value">{draft.name}</span>
                    <span className="automation-workflow-name-button__edit" aria-hidden="true">✎</span>
                  </button>
                  {dirty ? <Badge tone="pink">{t(locale, 'unsavedChanges')}</Badge> : null}
                </div>
                <div className="automation-toolbar-actions">
                  {selectedRecord ? (
                    <Checkbox checked={draft.enabled} onCheckedChange={(enabled) => { setDraft((current) => current ? { ...current, enabled } : current); onSetEnabled(selectedRecord.id, enabled); }} label={draft.enabled ? t(locale, 'disableWorkflow') : t(locale, 'enableWorkflow')} />
                  ) : null}
                  <Button variant="primary" size="sm" disabled={!dirty} onClick={handleSave}>{t(locale, 'saveWorkflow')}</Button>
                  {selectedRecord ? <Button variant="danger" size="sm" icon={<IconTrash />} iconOnly tooltip={t(locale, 'deleteWorkflow')} onClick={handleDeleteWorkflow} /> : null}
                </div>
              </div>

              <WorkflowCanvas
                locale={locale}
                graph={draft}
                definitions={nodes}
                selectedNodeId={selectedNodeId}
                onSelectNode={setSelectedNodeId}
                onAddNode={() => setPickerOpen(true)}
                onDeleteNode={handleDeleteNode}
              />
            </>
          )}
        </section>

        <aside className="automation-inspector">
          <div className="automation-panel-heading">{t(locale, 'nodeInspector')}</div>
          {!selectedNode ? (
            <p className="automation-panel-hint">{t(locale, 'noNodeSelected')}</p>
          ) : (
            <div className="automation-inspector-content">
              <div className="automation-node-title">{selectedDefinition?.title ?? selectedNode.type}</div>
              <div className="automation-node-type">
                <span>{selectedDefinition?.category ?? 'Plugin'}</span>
                <span>·</span>
                <span>{selectedDefinition?.kind ?? 'node'}</span>
              </div>
              <div className="automation-inspector-summary">
                <span className="automation-inspector-summary__label">{t(locale, 'workflowSteps')}</span>
                <strong>{selectedNode.type}</strong>
              </div>
              <Button variant="primary" block onClick={openConfiguration}>{t(locale, 'configureStep')}</Button>
              <p className="automation-panel-hint">{t(locale, 'configureStepHint')}</p>
              {selectedDefinition?.requiredCapabilities?.length ? (
                <div className="automation-capabilities">
                  <span>{t(locale, 'capabilities')}</span>
                  {selectedDefinition.requiredCapabilities.map((capability) => <Badge key={capability}>{capability}</Badge>)}
                </div>
              ) : null}
            </div>
          )}
        </aside>
      </div>

      {wizardOpen ? <WorkflowWizardModal locale={locale} onClose={() => setWizardOpen(false)} onCreate={handleCreateWorkflow} /> : null}
      {pickerOpen ? <NodePickerModal locale={locale} definitions={nodes} onClose={() => setPickerOpen(false)} onSelect={handleAddNode} /> : null}
      {configuringNode ? (
        <NodeConfigModal
          locale={locale}
          node={configuringNode}
          definition={configuringDefinition}
          eventType={eventTypeForGraph(draft)}
          analysis={scriptAnalysis?.nodeId === configuringNode.id ? scriptAnalysis : undefined}
          onApply={(config) => {
            handleConfigChange(config);
            setConfiguringNodeId(null);
          }}
          onAnalyzeScript={onAnalyzeScript}
          onClose={() => setConfiguringNodeId(null)}
        />
      ) : null}
      {renameValue !== null ? (
        <TextPromptModal
          title={t(locale, 'renameWorkflowTitle')}
          description={t(locale, 'workflowNameHint')}
          label={t(locale, 'workflowName')}
          initialValue={renameValue}
          placeholder={t(locale, 'workflowNamePlaceholder')}
          confirmLabel={t(locale, 'confirm')}
          cancelLabel={t(locale, 'cancel')}
          requiredMessage={t(locale, 'workflowNameRequired')}
          onConfirm={handleRename}
          onClose={() => setRenameValue(null)}
        />
      ) : null}
      {confirmModal?.kind === 'discard' ? (
        <ConfirmModal
          title={t(locale, 'discardWorkflowTitle')}
          description={t(locale, 'discardWorkflowChanges')}
          confirmLabel={t(locale, 'discardChanges')}
          cancelLabel={t(locale, 'cancel')}
          onConfirm={() => {
            const pending = confirmModal;
            setConfirmModal(null);
            setDirty(false);
            applyWorkflowAction(pending.action);
          }}
          onClose={() => setConfirmModal(null)}
        />
      ) : null}
      {confirmModal?.kind === 'delete' ? (
        <ConfirmModal
          title={t(locale, 'deleteWorkflow')}
          description={t(locale, 'deleteWorkflowConfirm', { name: confirmModal.name })}
          confirmLabel={t(locale, 'deleteWorkflow')}
          cancelLabel={t(locale, 'cancel')}
          danger
          onConfirm={() => confirmDelete(confirmModal.id)}
          onClose={() => setConfirmModal(null)}
        />
      ) : null}
    </main>
  );
}

function prepareGraph(graph: WorkflowGraph, definitions: NodeDefinition[]): WorkflowGraph {
  const cloned = cloneGraph(graph);
  return definitions.length > 0 ? normalizeWorkflowGraph(cloned, definitions) : cloned;
}

function cloneGraph(graph: WorkflowGraph): WorkflowGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({ ...node, position: { ...node.position }, config: { ...node.config } })),
    edges: graph.edges.map((edge) => ({ ...edge })),
  };
}

function graphsEqual(left: WorkflowGraph, right: WorkflowGraph): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function eventTypeForGraph(graph: WorkflowGraph | null): AutomationEventType | undefined {
  const trigger = graph?.nodes.find((node) => node.type === 'trigger.event');
  const eventType = trigger?.config.eventType;
  if (typeof eventType !== 'string') return undefined;
  return eventType as AutomationEventType;
}
