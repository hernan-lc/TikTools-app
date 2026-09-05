<script lang="tsx">
import { ref, watch } from 'vue';
import { defineVueComponent } from '../../vue/component.ts';
import { FormField } from './FormField.vue';
import { dispatchControlEvent, normalizeControlString, syncNativeControlValue } from './control-events.ts';
import { fieldIds, normalizeHexColor } from './controls.ts';

type ColorPickerProps = {
  value: string;
  onValueChange: (v: string) => void;
  label?: string;
  hint?: string;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  name?: string;
  showHex?: boolean;
};

let colorFallback = 0;

export const ColorPicker = defineVueComponent<ColorPickerProps>(
  ['value', 'onValueChange', 'label', 'hint', 'error', 'disabled', 'required', 'id', 'name', 'showHex'],
  (props, context) => {
  const innerRef = ref<HTMLInputElement | null>(null);
  const hexError = ref('');
  context.expose({
    getValue: () => normalizeControlString(props.value),
    setValue: (v: string) => {
      const normalized = normalizeHexColor(v);
      if (normalized) props.onValueChange(normalized);
    },
    focus: () => innerRef.value?.focus(),
  });
  watch(() => props.value, (value) => {
    if (innerRef.value) syncNativeControlValue(innerRef.value, normalizeHexColor(normalizeControlString(value)) ?? '#000000');
  });
  return () => {
    colorFallback += 1;
    const { id, describedBy } = fieldIds(props, `tt-color-${colorFallback}`);
    const raw = normalizeControlString(props.value);
    const normalized = normalizeHexColor(raw) ?? '#000000';
    const hintId = props.hint ? `${id}-hint` : undefined;
    const errorId = props.error || hexError.value ? `${id}-error` : undefined;
    const errorText = props.error ?? (hexError.value || undefined);
    const control = (
      <div class={`ui-color ${props.disabled ? 'is-disabled' : ''} ${errorText ? 'has-error' : ''}`}>
        <input
          ref={innerRef}
          id={id}
          name={props.name}
          type="color"
          value={normalized}
          disabled={props.disabled}
          required={props.required}
          aria-invalid={Boolean(errorText)}
          aria-describedby={describedBy([hintId, errorId])}
          onInput={(e) => {
            hexError.value = '';
            const next = (e.currentTarget as HTMLInputElement).value;
            const controlEl = innerRef.value;
            if (controlEl) dispatchControlEvent(controlEl);
            props.onValueChange(next.toLowerCase());
          }}
        />
        {props.showHex !== false ? (
          <input
            class="ui-color__hex"
            value={raw}
            disabled={props.disabled}
            spellcheck={false}
            aria-label={`${props.label ?? props.name ?? 'Color'} hex value`}
            placeholder="#000000"
            onInput={(e) => {
              const next = (e.currentTarget as HTMLInputElement).value;
              if (next.trim() === '') {
                hexError.value = '';
                return;
              }
              const valid = normalizeHexColor(next);
              if (valid) {
                hexError.value = '';
                props.onValueChange(valid);
              } else {
                hexError.value = 'Enter a hex color like #fe2c55.';
              }
            }}
          />
        ) : null}
        <span class="ui-color__swatch" style={{ background: normalized }} aria-hidden />
      </div>
    );
    if (!props.label && !props.hint && !errorText) return control;
    return (
      <FormField label={props.label} hint={props.hint} error={errorText} htmlFor={id} required={props.required}>
        {control}
      </FormField>
    );
  };
  },
);

export default ColorPicker;
</script>
