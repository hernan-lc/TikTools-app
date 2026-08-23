import { useState } from 'preact/hooks';

import type {
  AutomationEventType,
  AutomationScriptAnalysis,
  JsonObject,
  NodeDefinition,
  WorkflowNode,
} from '../../../automation/types.ts';
import { Button } from '../ui/Button.tsx';
import { Modal } from '../ui/Modal.tsx';
import { NodeConfigForm } from './NodeConfigForm.tsx';
import { t, type Locale } from '../../i18n.ts';

type NodeConfigModalProps = {
  locale: Locale;
  node: WorkflowNode;
  definition?: NodeDefinition;
  eventType?: AutomationEventType;
  analysis?: AutomationScriptAnalysis;
  onApply: (config: JsonObject) => void;
  onAnalyzeScript: (nodeId: string, source: string, offset: number, eventType?: AutomationEventType) => void;
  onClose: () => void;
};

/**
 * Edits a local copy of a node. The workflow draft is changed only after the
 * user confirms, so closing the modal is a safe cancel operation.
 */
export function NodeConfigModal({
  locale,
  node,
  definition,
  eventType,
  analysis,
  onApply,
  onAnalyzeScript,
  onClose,
}: NodeConfigModalProps) {
  const [config, setConfig] = useState<JsonObject>(() => ({ ...node.config }));
  const title = definition?.title ?? node.type;
  const draftNode: WorkflowNode = { ...node, config };

  return (
    <Modal
      title={`${t(locale, 'configureStep')}: ${title}`}
      description={t(locale, 'configureStepHint')}
      onClose={onClose}
      className="ui-modal-card--wide"
      footer={
        <div className="node-editor-modal-actions">
          <Button variant="soft" onClick={onClose}>{t(locale, 'cancel')}</Button>
          <Button variant="primary" onClick={() => onApply(config)}>{t(locale, 'applyChanges')}</Button>
        </div>
      }
    >
      <div className="node-editor-config-modal__body">
        <NodeConfigForm
          locale={locale}
          node={draftNode}
          definition={definition}
          eventType={eventType}
          analysis={analysis}
          onChange={setConfig}
          onAnalyzeScript={onAnalyzeScript}
        />
      </div>
    </Modal>
  );
}
