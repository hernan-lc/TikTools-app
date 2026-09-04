<script lang="tsx">
import type { VNodeChild } from 'vue';
import { defineVueFunctional } from '../../vue/component.ts';
import { InfoTip } from './InfoTip.vue';

type FormFieldProps = {
  label?: string;
  /** Tooltip-only explanation (ⓘ). Minimalist: never rendered as a paragraph. */
  hint?: string;
  error?: string;
  htmlFor?: string;
  required?: boolean;
  children: VNodeChild;
  id?: string;
};

/**
 * Minimalist wrapper: label + ⓘ tooltip + control + error only.
 * `hint` is intentionally NOT rendered as visible text.
 */
export const FormField = defineVueFunctional<FormFieldProps>((props) => {
  const { label, hint, error, htmlFor, required, children, id } = props;
  const fieldId = htmlFor ?? id;
  return (
    <div class={`ui-field ${error ? 'has-error' : ''}`} id={id}>
      {label ? (
        <label for={fieldId} class="ui-field__label">
          {label} {required ? <span class="ui-field__req">*</span> : null}
          {hint ? <InfoTip text={hint} position="right" /> : null}
        </label>
      ) : null}
      <div class="ui-field__control">{children}</div>
      {error ? <span class="ui-field__error">{error}</span> : null}
    </div>
  );
});

export const FieldRow = defineVueFunctional<{ label: string; children?: VNodeChild; hint?: string; error?: string }>((props) => {
  const { label, children, hint, error } = props;
  return (
    <div class={`ui-field-row ${error ? 'has-error' : ''}`}>
      <div class="ui-field-row__label">
        <span class="ui-field__label" style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}>{label}{hint ? <InfoTip text={hint} position="right" /> : null}</span>
        {error ? <span class="ui-field__error">{error}</span> : null}
      </div>
      <div class="ui-field-row__control">{children}</div>
    </div>
  );
});

export default FormField;
</script>
