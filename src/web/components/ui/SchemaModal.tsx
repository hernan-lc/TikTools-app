import { useState } from 'preact/hooks';

import type { JsonObject } from '../../../automation/types.ts';
import type { Locale } from '../../i18n.ts';
import { Button } from './Button.tsx';
import { Modal } from './Modal.tsx';
import { SchemaForm } from './SchemaForm.tsx';
import type { TemplateSuggestion } from '../node-editor/template-suggestions.ts';

export type SchemaModalProps = {
  locale: Locale;
  title: string;
  description?: string;
  schema: JsonObject;
  uiHints?: JsonObject;
  initialValue: JsonObject;
  cancelLabel: string;
  applyLabel: string;
  templateSuggestions?: TemplateSuggestion[];
  onApply: (value: JsonObject) => void;
  onClose: () => void;
};

/** Modal shell for any host-owned JSON Schema form, including plugin settings. */
export function SchemaModal({ locale, title, description, schema, uiHints, initialValue, cancelLabel, applyLabel, templateSuggestions, onApply, onClose }: SchemaModalProps) {
  const [value, setValue] = useState<JsonObject>(() => ({ ...initialValue }));
  return (
    <Modal
      title={title}
      description={description}
      className="ui-modal-card--wide"
      onClose={onClose}
      footer={
        <div className="ui-modal-card__actions">
          <Button variant="soft" onClick={onClose}>{cancelLabel}</Button>
          <Button variant="primary" onClick={() => onApply(value)}>{applyLabel}</Button>
        </div>
      }
    >
      <SchemaForm locale={locale} schema={schema} uiHints={uiHints} value={value} onChange={setValue} templateSuggestions={templateSuggestions} />
    </Modal>
  );
}
