import { useEffect, useRef, useState } from 'preact/hooks';

import type {
  AutomationEventType,
  AutomationScriptAnalysis,
  JsonObject,
  NodeDefinition,
  WorkflowGraph,
  WorkflowNode,
} from '../../automation/types.ts';
import type { AutomationWorkflowRecord } from '../../shared/messages.ts';
import { IconSparkles, IconTrash } from '../components/icons.tsx';
import { Alert, Badge, EmptyState } from '../components/ui/Card.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Checkbox } from '../components/ui/Checkbox.tsx';
import { FormField } from '../components/ui/FormField.tsx';
import { ConfirmModal, TextPromptModal } from '../components/ui/Modal.tsx';
import { PageHeader } from '../components/ui/Page.tsx';
import { t, type Locale } from '../i18n.ts';
import { createWorkflowNode, mountReteEditor, type ReteEditorHandle } from '../automation/rete-editor.ts';

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

type WorkflowNameModalState = {
  kind: 'create' | 'rename';
  initialValue: string;
};

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
  const [selectedId, setSelectedId] = useState<string | null>(workflows[0]?.id ?? null);
  const [draft, setDraft] = useState<WorkflowGraph | null>(workflows[0]?.graph ? cloneGraph(workflows[0].graph) : null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [configText, setConfigText] = useState('');
  const [dirty, setDirty] = useState(false);
  const [editorError, setEditorError] = useState('');
  const [scriptText, setScriptText] = useState('');
  const [scriptCursor, setScriptCursor] = useState(0);
  const [editorReady, setEditorReady] = useState(false);
  const [nameModal, setNameModal] = useState<WorkflowNameModalState | null>(null);
  const [confirmModal, setConfirmModal] = useState<WorkflowConfirmState | null>(null);
  const editorRef = useRef<ReteEditorHandle | null>(null);

  const selectedRecord = selectedId ? workflows.find((workflow) => workflow.id === selectedId) : undefined;
  const selectedNode = draft?.nodes.find((node) => node.id === selectedNodeId);
  const selectedDefinition = selectedNode ? nodes.find((node) => node.type === selectedNode.type) : undefined;

  useEffect(() => {
    if (selectedId || workflows.length === 0) return;
    const first = workflows[0];
    if (!first) return;
    setSelectedId(first.id);
    setDraft(cloneGraph(first.graph));
  }, [selectedId, workflows]);

  useEffect(() => {
    if (!selectedId || dirty) return;
    const record = workflows.find((workflow) => workflow.id === selectedId);
    if (record) setDraft(cloneGraph(record.graph));
  }, [selectedId, workflows, dirty]);

  useEffect(() => {
    if (!dirty || !draft || !selectedId) return;
    const record = workflows.find((workflow) => workflow.id === selectedId);
    if (record && graphsEqual(record.graph, draft)) setDirty(false);
  }, [draft, dirty, selectedId, workflows]);

  useEffect(() => {
    setConfigText(selectedNode ? JSON.stringify(selectedNode.config, null, 2) : '');
  }, [selectedNodeId, draft?.id, selectedNode?.type, selectedNode?.config.source]);

  useEffect(() => {
    const source = selectedNode?.type === 'transform.script' && typeof selectedNode.config.source === 'string'
      ? selectedNode.config.source
      : '';
    setScriptText(source);
    setScriptCursor(source.length);
    if (selectedNode?.type === 'transform.script') {
      onAnalyzeScript(selectedNode.id, source, source.length, eventTypeForGraph(draft));
    }
  }, [selectedNodeId, draft?.id, selectedNode?.type, selectedNode?.config.source]);

  const applyWorkflowAction = (action: PendingWorkflowAction): void => {
    if (action.kind === 'select') {
      setSelectedId(action.record.id);
      setDraft(cloneGraph(action.record.graph));
      setSelectedNodeId(null);
      setDirty(false);
      setEditorError('');
      return;
    }
    setNameModal({ kind: 'create', initialValue: '' });
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

  const createWorkflow = (): void => {
    requestWorkflowAction({ kind: 'create' });
  };

  const renameWorkflow = (): void => {
    if (!draft) return;
    setNameModal({ kind: 'rename', initialValue: draft.name });
  };

  const handleWorkflowNameConfirm = (name: string): void => {
    const modal = nameModal;
    setNameModal(null);
    if (!modal) return;

    if (modal.kind === 'create') {
      const graph = createStarterGraph(name);
      setSelectedId(graph.id);
      setDraft(graph);
      setSelectedNodeId(null);
      setDirty(true);
      setEditorError('');
      return;
    }

    updateDraft((current) => ({ ...current, name }));
  };

  const updateDraft = (update: (current: WorkflowGraph) => WorkflowGraph): void => {
    setDraft((current) => (current ? update(current) : current));
    setDirty(true);
  };

  const handleSave = (): void => {
    if (!draft) return;
    onSave(draft);
  };

  const handleDelete = (): void => {
    if (!selectedId || !selectedRecord) return;
    setConfirmModal({ kind: 'delete', id: selectedId, name: selectedRecord.name });
  };

  const confirmDelete = (id: string): void => {
    setConfirmModal(null);
    onDelete(id);
    setSelectedId(null);
    setDraft(null);
    setSelectedNodeId(null);
    setDirty(false);
  };

  const handleConfigSave = (): void => {
    if (!draft || !selectedNode) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(configText) as unknown;
    } catch {
      setEditorError('Node configuration must be valid JSON.');
      return;
    }
    if (!isJsonObject(parsed)) {
      setEditorError('Node configuration must be a JSON object.');
      return;
    }
    const config = parsed;
    editorRef.current?.updateNodeConfig(selectedNode.id, config);
    updateDraft((current) => ({
      ...current,
      nodes: current.nodes.map((node) => node.id === selectedNode.id ? { ...node, config } : node),
    }));
    setEditorError('');
  };

  const handleScriptChange = (source: string, offset: number): void => {
    if (!draft || !selectedNode || selectedNode.type !== 'transform.script') return;
    setScriptText(source);
    setScriptCursor(offset);
    const config = { ...selectedNode.config, source };
    editorRef.current?.updateNodeConfig(selectedNode.id, config);
    updateDraft((current) => ({
      ...current,
      nodes: current.nodes.map((node) => node.id === selectedNode.id ? { ...node, config } : node),
    }));
    onAnalyzeScript(selectedNode.id, source, offset, eventTypeForGraph(draft));
  };

  const handleScriptCursor = (offset: number): void => {
    setScriptCursor(offset);
    if (selectedNode?.type === 'transform.script') {
      onAnalyzeScript(selectedNode.id, scriptText, offset, eventTypeForGraph(draft));
    }
  };

  const handleAddNode = (definition: NodeDefinition): void => {
    if (!draft) return;
    const node = createWorkflowNode(definition, draft.nodes.length);
    updateDraft((current) => ({
      ...current,
      nodes: [...current.nodes, node],
    }));
    setSelectedNodeId(node.id);
    setEditorError('');
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
            <Button variant="primary" size="sm" onClick={createWorkflow}>{t(locale, 'newWorkflow')}</Button>
          </div>
        }
      />

      {error ? <Alert variant="danger">{error}</Alert> : null}
      {editorError ? <Alert variant="warning">{editorError}</Alert> : null}

      <div className="automation-workspace">
        <aside className="automation-sidebar">
          <div className="automation-panel-heading">
            <span>{t(locale, 'automations')}</span>
            <Badge tone="cyan">{workflows.length}</Badge>
          </div>

          {workflows.length === 0 ? (
            <EmptyState
              title={t(locale, 'noWorkflows')}
              action={<Button variant="soft" size="sm" onClick={createWorkflow}>{t(locale, 'newWorkflow')}</Button>}
            />
          ) : (
            <div className="automation-workflow-list">
              {workflows.map((record) => (
                <button
                  key={record.id}
                  type="button"
                  className={`automation-workflow-item ${selectedId === record.id ? 'is-active' : ''}`}
                  onClick={() => selectWorkflow(record)}
                >
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
              <Badge>{nodes.length}</Badge>
            </div>
            <p className="automation-panel-hint">{t(locale, 'automationAddNodeHint')}</p>
            <div className="automation-catalog-list">
              {nodes.map((definition) => (
                <button
                  key={`${definition.pluginId}:${definition.type}`}
                  type="button"
                  className="automation-catalog-item"
                  disabled={!draft}
                  onClick={() => handleAddNode(definition)}
                >
                  <span className="automation-catalog-item__title">{definition.title}</span>
                  <span className="automation-catalog-item__meta">{definition.category} · {definition.kind}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <section className="automation-editor-panel">
          {!draft ? (
            <EmptyState title={t(locale, 'selectWorkflow')} description={t(locale, 'noWorkflows')} action={<Button variant="primary" onClick={createWorkflow}>{t(locale, 'newWorkflow')}</Button>} />
          ) : (
            <>
              <div className="automation-editor-toolbar">
                <div className="automation-workflow-name">
                  <button type="button" className="automation-workflow-name-button" onClick={renameWorkflow}>
                    <span className="automation-workflow-name-button__value">{draft.name || t(locale, 'newWorkflow')}</span>
                    <span className="automation-workflow-name-button__edit" aria-hidden="true">✎</span>
                  </button>
                  {dirty ? <Badge tone="pink">{t(locale, 'unsavedChanges')}</Badge> : null}
                </div>
                <div className="automation-toolbar-actions">
                  {selectedRecord ? (
                    <Checkbox
                      checked={draft.enabled}
                      onCheckedChange={(enabled) => {
                        setDraft((current) => current ? { ...current, enabled } : current);
                        onSetEnabled(selectedRecord.id, enabled);
                      }}
                      label={draft.enabled ? t(locale, 'disableWorkflow') : t(locale, 'enableWorkflow')}
                    />
                  ) : null}
                  <Button variant="primary" size="sm" disabled={!dirty} onClick={handleSave}>{t(locale, 'saveWorkflow')}</Button>
                  {selectedRecord ? <Button variant="danger" size="sm" icon={<IconTrash />} iconOnly tooltip={t(locale, 'deleteWorkflow')} onClick={handleDelete} /> : null}
                </div>
              </div>

              <div className="automation-canvas-wrap">
                <ReteCanvas
                  locale={locale}
                  graph={draft}
                  definitions={nodes}
                  editorRef={editorRef}
                  onReady={setEditorReady}
                  onChange={(graph) => {
                    setDraft((current) => current ? {
                      ...graph,
                      name: current.name,
                      enabled: current.enabled,
                    } : graph);
                    setDirty(true);
                  }}
                  onSelectNode={setSelectedNodeId}
                  onError={(message) => {
                    setEditorReady(false);
                    setEditorError(message);
                  }}
                />
                {!editorReady && nodes.length > 0 ? (
                  <div className="automation-editor-status" role="status">{t(locale, 'loadingWorkflowEditor')}</div>
                ) : null}
              </div>
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
              <div className="automation-node-type">{selectedNode.type} · v{selectedNode.version}</div>
              <FormField label={t(locale, 'nodeId')}>
                <code className="automation-code-value">{selectedNode.id}</code>
              </FormField>
              {selectedNode.type === 'transform.script' ? (
                <ScriptEditor
                  locale={locale}
                  source={scriptText}
                  cursor={scriptCursor}
                  analysis={scriptAnalysis?.nodeId === selectedNode.id && scriptAnalysis.source === scriptText ? scriptAnalysis : undefined}
                  onChange={handleScriptChange}
                  onCursorChange={handleScriptCursor}
                />
              ) : null}
              <FormField label={t(locale, 'configuration')} hint={t(locale, 'configurationHint')}>
                <textarea
                  className="automation-json-editor"
                  value={configText}
                  rows={14}
                  spellcheck={false}
                  onInput={(event) => setConfigText(event.currentTarget.value)}
                />
              </FormField>
              <Button variant="soft" size="sm" onClick={handleConfigSave}>{t(locale, 'applyConfiguration')}</Button>
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

      {nameModal ? (
        <TextPromptModal
          key={`${nameModal.kind}:${nameModal.initialValue}`}
          title={nameModal.kind === 'create' ? t(locale, 'createWorkflowTitle') : t(locale, 'renameWorkflowTitle')}
          description={t(locale, 'workflowNameHint')}
          label={t(locale, 'workflowName')}
          initialValue={nameModal.initialValue}
          placeholder={t(locale, 'workflowNamePlaceholder')}
          confirmLabel={t(locale, 'confirm')}
          cancelLabel={t(locale, 'cancel')}
          requiredMessage={t(locale, 'workflowNameRequired')}
          onConfirm={handleWorkflowNameConfirm}
          onClose={() => setNameModal(null)}
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

type ScriptEditorProps = {
  locale: Locale;
  source: string;
  cursor: number;
  analysis?: AutomationScriptAnalysis;
  onChange: (source: string, offset: number) => void;
  onCursorChange: (offset: number) => void;
};

function ScriptEditor({ locale, source, cursor, analysis, onChange, onCursorChange }: ScriptEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const applyCompletion = (label: string): void => {
    const textarea = textareaRef.current;
    const offset = textarea?.selectionStart ?? cursor;
    const before = source.slice(0, offset);
    const match = before.match(/[A-Za-z0-9_$]*$/);
    const start = offset - (match?.[0]?.length ?? 0);
    const nextSource = `${source.slice(0, start)}${label}${source.slice(offset)}`;
    const nextOffset = start + label.length;
    onChange(nextSource, nextOffset);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextOffset, nextOffset);
    });
  };

  return (
    <div className="automation-script-editor">
      <FormField label={t(locale, 'scriptEditor')} hint={t(locale, 'scriptEditorHint')}>
        <textarea
          ref={textareaRef}
          className="automation-script-textarea"
          value={source}
          rows={10}
          spellcheck={false}
          onInput={(event) => {
            const target = event.currentTarget;
            onChange(target.value, target.selectionStart ?? target.value.length);
          }}
          onKeyUp={(event) => onCursorChange(event.currentTarget.selectionStart ?? source.length)}
          onClick={(event) => onCursorChange(event.currentTarget.selectionStart ?? source.length)}
        />
      </FormField>
      {analysis?.diagnostics.length ? (
        <div className="automation-script-diagnostics" role="status">
          {analysis.diagnostics.map((diagnostic, index) => (
            <div key={`${diagnostic.line}:${diagnostic.column}:${index}`} className={`automation-script-diagnostic is-${diagnostic.severity}`}>
              <span>{diagnostic.line}:{diagnostic.column}</span> {diagnostic.message}
            </div>
          ))}
        </div>
      ) : null}
      {analysis?.completions.length ? (
        <div className="automation-script-completions">
          <span className="automation-script-completions__label">{t(locale, 'suggestions')}</span>
          <div className="automation-script-completions__list">
            {analysis.completions.slice(0, 12).map((completion) => (
              <button key={`${completion.kind}:${completion.label}`} type="button" onClick={() => applyCompletion(completion.label)}>
                {completion.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {analysis?.hover ? <div className="automation-script-hover">{analysis.hover.detail}</div> : null}
    </div>
  );
}

type ReteCanvasProps = {
  locale: Locale;
  graph: WorkflowGraph;
  definitions: NodeDefinition[];
  editorRef: { current: ReteEditorHandle | null };
  onReady: (ready: boolean) => void;
  onChange: (graph: WorkflowGraph) => void;
  onSelectNode: (nodeId: string | null) => void;
  onError: (message: string) => void;
};

function ReteCanvas({ locale, graph, definitions, editorRef, onReady, onChange, onSelectNode, onError }: ReteCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onReadyRef = useRef(onReady);
  const onChangeRef = useRef(onChange);
  const onSelectNodeRef = useRef(onSelectNode);
  const onErrorRef = useRef(onError);
  onReadyRef.current = onReady;
  onChangeRef.current = onChange;
  onSelectNodeRef.current = onSelectNode;
  onErrorRef.current = onError;

  // A config or connection edit should stay inside the current Rete instance,
  // but adding/removing a node must rebuild it from the canonical JSON graph.
  const graphNodeKey = graph.nodes.map((node) => `${node.id}:${node.type}:${node.version}`).join('|');

  useEffect(() => {
    const container = containerRef.current;
    if (!container || definitions.length === 0) {
      onReadyRef.current(false);
      return;
    }
    let cancelled = false;
    let handle: ReteEditorHandle | null = null;
    container.replaceChildren();
    editorRef.current = null;
    onReadyRef.current(false);

    void mountReteEditor({
      container,
      graph,
      definitions,
      onChange: (nextGraph) => onChangeRef.current(nextGraph),
      onSelectNode: (nodeId) => onSelectNodeRef.current(nodeId),
    }).then((nextHandle) => {
      if (cancelled) {
        nextHandle.destroy();
        return;
      }
      handle = nextHandle;
      editorRef.current = nextHandle;
      onReadyRef.current(true);
    }).catch((caught: unknown) => {
      if (!cancelled) onErrorRef.current(caught instanceof Error ? caught.message : String(caught));
    });

    return () => {
      cancelled = true;
      onReadyRef.current(false);
      if (editorRef.current === handle) editorRef.current = null;
      handle?.destroy();
      container.replaceChildren();
    };
  }, [graph.id, graphNodeKey, definitions, editorRef]);

  if (definitions.length === 0) {
    return <div className="automation-canvas-placeholder">{t(locale, 'loadingNodeCatalog')}</div>;
  }
  return <div ref={containerRef} className="automation-canvas" aria-label="Workflow node editor" />;
}

function createStarterGraph(name = 'New workflow'): WorkflowGraph {
  return {
    schemaVersion: 1,
    id: createId('workflow'),
    name,
    enabled: false,
    nodes: [
      {
        id: createId('trigger'),
        type: 'trigger.event',
        version: 1,
        position: { x: 80, y: 80 },
        config: { eventType: 'tiktok.chat' },
      },
    ],
    edges: [],
  };
}

function cloneGraph(graph: WorkflowGraph): WorkflowGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({
      ...node,
      position: { ...node.position },
      config: { ...node.config },
    })),
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
  const known: AutomationEventType[] = [
    'tiktok.chat',
    'tiktok.gift',
    'tiktok.like',
    'tiktok.follow',
    'tiktok.share',
    'tiktok.join',
    'tiktok.social',
    'tiktok.room_stats',
    'tiktok.connected',
    'tiktok.disconnected',
    'points.awarded',
  ];
  return known.includes(eventType as AutomationEventType) ? eventType as AutomationEventType : undefined;
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function createId(prefix: string): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  return randomUuid ? `${prefix}-${randomUuid}` : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
