import type { NodeDefinition } from '../../../automation/types.ts';
import { Badge } from '../ui/Card.tsx';
import { Modal } from '../ui/Modal.tsx';
import { t, type Locale } from '../../i18n.ts';

type NodePickerModalProps = {
  locale: Locale;
  definitions: NodeDefinition[];
  onSelect: (definition: NodeDefinition) => void;
  onClose: () => void;
};

export function NodePickerModal({ locale, definitions, onSelect, onClose }: NodePickerModalProps) {
  const groups = definitions
    .filter((definition) => definition.kind !== 'trigger')
    .reduce<Record<string, NodeDefinition[]>>((result, definition) => {
      (result[definition.category] ??= []).push(definition);
      return result;
    }, {});

  return (
    <Modal title={t(locale, 'chooseNodeTitle')} description={t(locale, 'chooseNodeHint')} onClose={onClose}>
      <div className="node-editor-picker-groups">
        {Object.entries(groups).map(([category, categoryNodes]) => (
          <section key={category} className="node-editor-picker-group">
            <div className="node-editor-picker-group__title">{category}</div>
            <div className="node-editor-picker-list">
              {categoryNodes.map((definition) => (
                <button
                  key={`${definition.pluginId}:${definition.type}`}
                  type="button"
                  className="node-editor-picker-item"
                  onClick={() => onSelect(definition)}
                >
                  <span className="node-editor-picker-item__main">
                    <strong>{definition.title}</strong>
                    <small>{definition.type}</small>
                  </span>
                  <Badge tone={definition.kind === 'action' ? 'pink' : definition.kind === 'condition' ? 'cyan' : 'neutral'}>
                    {definition.kind}
                  </Badge>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Modal>
  );
}
