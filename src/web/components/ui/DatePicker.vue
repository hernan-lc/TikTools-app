<script lang="tsx">
import { ref, watch } from 'vue';
import { defineVueComponent } from '../../vue/component.ts';
import { FormField } from './FormField.vue';
import { dispatchControlEvent, normalizeControlString, syncNativeControlValue } from './control-events.ts';
import { fieldIds } from './controls.ts';

type DatePickerProps = {
  value: string;
  onValueChange: (v: string) => void;
  label?: string;
  hint?: string;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  readonly?: boolean;
  min?: string;
  max?: string;
  step?: string;
  id?: string;
  name?: string;
};

let dateFallback = 0;

function makePicker(kind: 'date' | 'time', fallbackPrefix: string, cssClass: string) {
  return defineVueComponent<DatePickerProps & { step?: string }>(
    ['value', 'onValueChange', 'label', 'hint', 'error', 'disabled', 'required', 'readonly', 'min', 'max', 'step', 'id', 'name'],
    (props, context) => {
    const innerRef = ref<HTMLInputElement | null>(null);
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
      clear: () => commitProgrammaticValue(''),
    });
    watch(() => props.value, (value) => {
      if (innerRef.value) syncNativeControlValue(innerRef.value, value);
    });
    return () => {
      dateFallback += 1;
      const { id, describedBy } = fieldIds(props, `${fallbackPrefix}-${dateFallback}`);
      const value = normalizeControlString(props.value);
      const hintId = props.hint ? `${id}-hint` : undefined;
      const errorId = props.error ? `${id}-error` : undefined;
      const control = (
        <div class={`${cssClass} ${props.error ? 'has-error' : ''} ${props.disabled ? 'is-disabled' : ''}`}>
          <input
            ref={innerRef}
            id={id}
            name={props.name}
            type={kind}
            value={value}
            min={props.min}
            max={props.max}
            step={props.step}
            disabled={props.disabled}
            readonly={props.readonly}
            required={props.required}
            aria-invalid={Boolean(props.error)}
            aria-describedby={describedBy([hintId, errorId])}
            onInput={(e) => props.onValueChange((e.currentTarget as HTMLInputElement).value)}
            onChange={(e) => props.onValueChange((e.currentTarget as HTMLInputElement).value)}
          />
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
}

export const DatePicker = makePicker('date', 'tt-date', 'ui-date');
export const TimePicker = makePicker('time', 'tt-time', 'ui-time');
export default DatePicker;
</script>
