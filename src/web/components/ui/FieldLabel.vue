<script lang="tsx">
import { InfoTip } from './InfoTip.vue';

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
 * something to explain, and an optional inline example. Template variables
 * (`{{ event.* }}`) are highlighted inline in the input itself — no badges.
 * Keeps the form short — explanations live behind icons, not paragraphs.
 */
export function FieldLabel({ label, hint, example, labelHint, htmlFor }: FieldLabelProps) {
  const tooltip = hint ?? labelHint;
  return (
    <div class="plg-label-row">
      <label class="plg-label" for={htmlFor}>
        {label}
      </label>
      {tooltip ? <InfoTip text={tooltip} position="right" /> : null}
      {example ? <span class="plg-field-example">{example}</span> : null}
    </div>
  );
}

/** Inline hint under the control for short, always-visible guidance. */
export function FieldInlineHint({ text }: { text: string }) {
  return <span class="plg-field-hint">{text}</span>;
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

/** Kept for compatibility: variables are highlighted inline now, so no line is rendered. */
export function TemplateTokensLine({ value: _value, onInsert: _onInsert }: { value: string; onInsert?: () => void }) {
  void _value;
  void _onInsert;
  return null;
}

export default FieldLabel;
</script>
