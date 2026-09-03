import type { ComponentChildren } from 'preact';
import { InfoTip } from './InfoTip.tsx';

type FormFieldProps = {
  label?: string;
  /** Tooltip-only explanation (ⓘ). Minimalist: never rendered as a paragraph. */
  hint?: string;
  error?: string;
  htmlFor?: string;
  required?: boolean;
  children: ComponentChildren;
  id?: string;
};

/**
 * Minimalist wrapper: label + ⓘ tooltip + control + error only.
 * `hint` is intentionally NOT rendered as visible text.
 */
export function FormField({ label, hint, error, htmlFor, required, children, id }: FormFieldProps) {
  const fieldId = htmlFor ?? id;
  return (
    <div className={`ui-field ${error ? 'has-error' : ''}`} id={id}>
      {label ? (
        <label htmlFor={fieldId} className="ui-field__label">
          {label} {required ? <span className="ui-field__req">*</span> : null}
          {hint ? <InfoTip text={hint} position="right" /> : null}
        </label>
      ) : null}
      <div className="ui-field__control">{children}</div>
      {error ? <span className="ui-field__error">{error}</span> : null}
    </div>
  );
}

export function FieldRow({ label, children, hint, error }: { label: string; children: ComponentChildren; hint?: string; error?: string }) {
  return (
    <div className={`ui-field-row ${error ? 'has-error' : ''}`}>
      <div className="ui-field-row__label">
        <span className="ui-field__label" style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}>{label}{hint ? <InfoTip text={hint} position="right" /> : null}</span>
        {error ? <span className="ui-field__error">{error}</span> : null}
      </div>
      <div className="ui-field-row__control">{children}</div>
    </div>
  );
}
