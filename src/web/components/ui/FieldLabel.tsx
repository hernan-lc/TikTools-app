import { InfoTip } from './InfoTip.tsx';

type FieldLabelProps = {
  label: string;
  /** Long explanation → rendered behind the ⓘ icon (wide tooltip). */
  hint?: string;
  /** Short inline example, e.g. `https://hooks.example.com/live`. */
  example?: string;
  /** True when the field renders `{{ event.* }}` before use. */
  template?: boolean;
  templateHint?: string;
  /** Extra tooltip for the label itself (method semantics, allowlist…). */
  labelHint?: string;
  htmlFor?: string;
};

/**
 * One label row for every form field: the text, an ⓘ tooltip when there is
 * something to explain, and a `{{ }}` badge when the field is templated.
 * Keeps the form short — explanations live behind icons, not paragraphs.
 */
export function FieldLabel({ label, hint, example, template, templateHint, labelHint, htmlFor }: FieldLabelProps) {
  const tooltip = hint ?? labelHint;
  return (
    <div className="plg-label-row">
      <label className="plg-label" htmlFor={htmlFor}>
        {label}
      </label>
      {tooltip ? <InfoTip text={tooltip} position="right" /> : null}
      {template ? (
        <span
          className="plg-template-badge"
          data-tooltip={templateHint ?? 'Accepts {{ event.* }} placeholders. Type {{ to see suggestions.'}
          data-tooltip-pos="right"
          data-tooltip-wide=""
          aria-label={templateHint ?? 'Supports templates'}
        >
          {'{{ }}'}
        </span>
      ) : null}
      {example ? <span className="plg-field-example">{example}</span> : null}
    </div>
  );
}

/** Inline hint under the control for short, always-visible guidance. */
export function FieldInlineHint({ text }: { text: string }) {
  return <span className="plg-field-hint">{text}</span>;
}

/** Extract `{{ path }}` tokens so inputs can show what will be rendered. */
export function extractTemplateTokens(value: string): string[] {
  const out: string[] = [];
  const pattern = /\{\{\s*([^}]+?)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    const token = (match[1] ?? '').trim();
    if (token && !out.includes(token)) out.push(token);
  }
  return out;
}

/** Small line under template inputs: which placeholders were detected. */
export function TemplateTokensLine({ value, onInsert }: { value: string; onInsert?: () => void }) {
  const tokens = extractTemplateTokens(value);
  if (tokens.length === 0) return null;
  return (
    <div className="plg-template-tokens" role="note">
      <span
        data-tooltip={`Renders with: ${tokens.join(', ')}`}
        data-tooltip-pos="bottom"
        data-tooltip-wide=""
      >
        {tokens.length === 1 ? `Uses ${tokens[0]}` : `Uses ${tokens.length} variables`}
      </span>
      {onInsert ? (
        <button type="button" className="plg-template-tokens__add" onClick={onInsert}>
          + variable
        </button>
      ) : null}
    </div>
  );
}
