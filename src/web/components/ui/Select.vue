<script lang="tsx">
import { ref, watch } from 'vue';
import { defineVueComponent } from '../../vue/component.ts';
import { InfoTip } from './InfoTip.vue';
import { dispatchControlEvent, normalizeControlString, syncNativeControlValue } from './control-events.ts';

export type SelectHandle = {
  getValue: () => string;
  setValue: (v: string) => void;
  focus: () => void;
};

export type SelectOption = { value: string; label: string };

type SelectProps = {
  value: string;
  onValueChange: (v: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  error?: string;
  id?: string;
  name?: string;
  placeholder?: string;
  /** MUI-style floating label. */
  label?: string;
  /** Tooltip-only explanation (ⓘ). */
  hint?: string;
};

export const Select = defineVueComponent<SelectProps>(
  ['value', 'onValueChange', 'options', 'disabled', 'error', 'id', 'name', 'placeholder', 'label', 'hint'],
  (props, context) => {
  const innerRef = ref<HTMLSelectElement | null>(null);
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
  });

  const handleChange = (e: Event) => props.onValueChange((e.currentTarget as HTMLSelectElement).value);
  watch(() => props.value, (value) => {
    if (innerRef.value) syncNativeControlValue(innerRef.value, value);
  });

  return () => {
    const { options, disabled, error, id, name, placeholder, label, hint } = props;
    const value = normalizeControlString(props.value);
    if (label) {
      const filled = value.trim().length > 0;
      return (
      <div class={`ui-float ${filled ? 'is-filled' : ''} ${error ? 'has-error' : ''} ${disabled ? 'is-disabled' : ''}`}>
        <div class="ui-float__control">
          <select ref={innerRef} id={id} name={name} value={value} disabled={disabled} aria-invalid={Boolean(error)} aria-label={label} onChange={handleChange}>
            {placeholder ? (
              <option value="" disabled>
                {placeholder}
              </option>
            ) : null}
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <label class="ui-float__label" for={id}>
            {label}
            {hint ? <InfoTip text={hint} position="right" /> : null}
          </label>
          <span class="ui-float__arrow" aria-hidden>▾</span>
        </div>
      </div>
    );
    }

    return (
    <div class={`ui-select ${error ? 'has-error' : ''} ${disabled ? 'is-disabled' : ''}`}>
      <select ref={innerRef} id={id} name={name} value={value} disabled={disabled} aria-invalid={Boolean(error)} onChange={handleChange}>
        {placeholder ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span class="ui-select__arrow" aria-hidden>
        ▾
      </span>
    </div>
    );
  };
  },
);

export default Select;
</script>
