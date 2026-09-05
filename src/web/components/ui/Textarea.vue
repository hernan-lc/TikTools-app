<script lang="tsx">
import { ref, watch } from 'vue';
import { defineVueComponent } from '../../vue/component.ts';
import { FormField } from './FormField.vue';
import { dispatchControlEvent, normalizeControlString, syncNativeControlValue } from './control-events.ts';
import { fieldIds } from './controls.ts';

export type TextareaHandle = {
  getValue: () => string;
  setValue: (v: string) => void;
  focus: () => void;
};

type TextareaProps = {
  value: string;
  onValueChange: (v: string) => void;
  label?: string;
  hint?: string;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  disabled?: boolean;
  readonly?: boolean;
  required?: boolean;
  error?: string;
  id?: string;
  name?: string;
  showCount?: boolean;
};

let textareaFallback = 0;

export const Textarea = defineVueComponent<TextareaProps>(
  ['value', 'onValueChange', 'label', 'hint', 'placeholder', 'rows', 'maxLength', 'disabled', 'readonly', 'required', 'error', 'id', 'name', 'showCount'],
  (props, context) => {
  const innerRef = ref<HTMLTextAreaElement | null>(null);
  const commitProgrammaticValue = (value: string): void => {
    const control = innerRef.value;
    if (control) {
      syncNativeControlValue(control, value);
      dispatchControlEvent(control);
    }
    props.onValueChange(value);
  };
  context.expose({
    getValue: () => innerRef.value?.value ?? normalizeControlString(props.value),
    setValue: commitProgrammaticValue,
    focus: () => innerRef.value?.focus(),
  } satisfies TextareaHandle);
  watch(() => props.value, (value) => {
    if (innerRef.value) syncNativeControlValue(innerRef.value, value);
  });
  return () => {
    textareaFallback += 1;
    const { id, describedBy } = fieldIds(props, `tt-textarea-${textareaFallback}`);
    const value = normalizeControlString(props.value);
    const hintId = props.hint ? `${id}-hint` : undefined;
    const errorId = props.error ? `${id}-error` : undefined;
    const countId = props.showCount ? `${id}-count` : undefined;
    const control = (
      <div class={`ui-textarea ${props.error ? 'has-error' : ''} ${props.disabled ? 'is-disabled' : ''}`}>
        <textarea
          ref={innerRef}
          id={id}
          name={props.name}
          value={value}
          rows={props.rows ?? 4}
          maxlength={props.maxLength}
          placeholder={props.placeholder}
          disabled={props.disabled}
          readonly={props.readonly}
          required={props.required}
          aria-invalid={Boolean(props.error)}
          aria-describedby={describedBy([hintId, errorId, countId])}
          onInput={(e) => props.onValueChange((e.currentTarget as HTMLTextAreaElement).value)}
        />
        {props.showCount && props.maxLength ? (
          <span id={countId} class="ui-textarea__count" aria-live="polite">{value.length}/{props.maxLength}</span>
        ) : null}
      </div>
    );
    if (!props.label && !props.hint && !props.error) return control;
    return (
      <FormField label={props.label} hint={props.hint} error={props.error} htmlFor={id} required={props.required}>
        {control}
      </FormField>
    );
  };
  },
);

export default Textarea;
</script>
