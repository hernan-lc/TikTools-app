<script lang="tsx">
import { ref, watch } from 'vue';
import { defineVueComponent } from '../../vue/component.ts';
import { FormField } from './FormField.vue';
import { dispatchControlEvent, syncNativeControlValue } from './control-events.ts';
import { clampNumber, fieldIds } from './controls.ts';

type RangeProps = {
  value: number;
  onValueChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  hint?: string;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  name?: string;
  showValue?: boolean;
  showMinMax?: boolean;
};

let rangeFallback = 0;

export const Range = defineVueComponent<RangeProps>(
  ['value', 'onValueChange', 'min', 'max', 'step', 'label', 'hint', 'error', 'disabled', 'required', 'id', 'name', 'showValue', 'showMinMax'],
  (props, context) => {
  const innerRef = ref<HTMLInputElement | null>(null);
  const commitProgrammaticValue = (v: number): void => {
    const next = clampNumber(v, props.min, props.max);
    const control = innerRef.value;
    if (control) {
      syncNativeControlValue(control, String(next));
      dispatchControlEvent(control);
    }
    props.onValueChange(next);
  };
  context.expose({
    getValue: () => props.value,
    setValue: commitProgrammaticValue,
    focus: () => innerRef.value?.focus(),
  });
  watch(() => props.value, (value) => {
    if (innerRef.value) syncNativeControlValue(innerRef.value, String(value));
  });
  return () => {
    rangeFallback += 1;
    const { id, describedBy } = fieldIds(props, `tt-range-${rangeFallback}`);
    const min = props.min ?? 0;
    const max = props.max ?? 100;
    const step = props.step ?? 1;
    const hintId = props.hint ? `${id}-hint` : undefined;
    const errorId = props.error ? `${id}-error` : undefined;
    const control = (
      <div class={`ui-range ${props.disabled ? 'is-disabled' : ''} ${props.error ? 'has-error' : ''}`}>
        {props.showMinMax ? <span class="ui-range__bound">{min}</span> : null}
        <input
          ref={innerRef}
          id={id}
          name={props.name}
          type="range"
          min={min}
          max={max}
          step={step}
          value={String(props.value)}
          disabled={props.disabled}
          required={props.required}
          aria-invalid={Boolean(props.error)}
          aria-describedby={describedBy([hintId, errorId])}
          onInput={(e) => {
            const next = Number((e.currentTarget as HTMLInputElement).value);
            if (Number.isFinite(next)) props.onValueChange(clampNumber(next, props.min, props.max));
          }}
        />
        {props.showMinMax ? <span class="ui-range__bound">{max}</span> : null}
        {props.showValue !== false ? <output class="ui-range__value" for={id}>{String(props.value)}</output> : null}
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

export default Range;
</script>
