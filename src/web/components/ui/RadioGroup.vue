<script lang="tsx">
import { defineVueComponent } from '../../vue/component.ts';
import { FormField } from './FormField.vue';
import type { SelectOption } from './controls.ts';

export type RadioGroupHandle = {
  getValue: () => string;
};

type RadioGroupProps = {
  value: string;
  onValueChange: (v: string) => void;
  options: SelectOption[];
  label?: string;
  hint?: string;
  error?: string;
  name: string;
  disabled?: boolean;
  required?: boolean;
  orientation?: 'horizontal' | 'vertical';
  id?: string;
};

export const RadioGroup = defineVueComponent<RadioGroupProps>(
  ['value', 'onValueChange', 'options', 'label', 'hint', 'error', 'name', 'disabled', 'required', 'orientation', 'id'],
  (props, context) => {
  context.expose({ getValue: () => props.value } satisfies RadioGroupHandle);
  return () => {
    const orientation = props.orientation ?? 'vertical';
    const group = (
      <div
        class={`ui-radio-group ui-radio-group--${orientation} ${props.disabled ? 'is-disabled' : ''}`}
        role="radiogroup"
        aria-invalid={Boolean(props.error)}
        aria-label={props.label ?? props.name}
      >
        {props.options.map((option) => {
          const optionDisabled = props.disabled || option.disabled;
          const optionId = `${props.id ?? `tt-radio-${props.name}`}-${option.value}`;
          return (
            <label key={option.value} for={optionId} class={`ui-radio ${optionDisabled ? 'is-disabled' : ''} ${props.value === option.value ? 'is-checked' : ''}`}>
              <input
                id={optionId}
                name={props.name}
                type="radio"
                value={option.value}
                checked={props.value === option.value}
                disabled={optionDisabled}
                required={props.required}
                onChange={() => {
                  if (!optionDisabled) props.onValueChange(option.value);
                }}
              />
              <span class="ui-radio__dot" aria-hidden />
              <span class="ui-radio__label">{option.label}</span>
            </label>
          );
        })}
      </div>
    );
    if (!props.label && !props.hint && !props.error) return group;
    return (
      <FormField label={props.label} hint={props.hint} error={props.error} required={props.required}>
        {group}
      </FormField>
    );
  };
  },
);

export default RadioGroup;
</script>
