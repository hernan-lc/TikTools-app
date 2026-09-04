<script lang="tsx">
import { ref, watch } from 'vue';
import { defineVueComponent } from '../../vue/component.ts';
import { dispatchControlEvent, syncNativeControlValue } from './control-events.ts';

export type CheckboxHandle = {
  getValue: () => boolean;
  setValue: (v: boolean) => void;
};

type CheckboxProps = {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
  error?: string;
};

export const Checkbox = defineVueComponent<CheckboxProps>(
  ['checked', 'onCheckedChange', 'label', 'disabled', 'id', 'name', 'error'],
  (props, context) => {
  const innerRef = ref<HTMLInputElement | null>(null);
  const commitProgrammaticValue = (checked: boolean): void => {
    const control = innerRef.value;
    if (control) {
      syncNativeControlValue(control, checked);
      dispatchControlEvent(control);
    }
    props.onCheckedChange(checked);
  };
  context.expose({
    getValue: () => innerRef.value?.checked ?? props.checked,
    setValue: commitProgrammaticValue,
  });
  watch(() => props.checked, (checked) => {
    if (innerRef.value) syncNativeControlValue(innerRef.value, checked);
  });
  return () => {
    const { checked, label, disabled, id, name, error } = props;
    return (
    <label for={id} class={`ui-check ${error ? 'has-error' : ''} ${disabled ? 'is-disabled' : ''}`}>
      <input
        ref={innerRef}
        id={id}
        name={name}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => props.onCheckedChange((e.currentTarget as HTMLInputElement).checked)}
      />
      <span class="ui-check__box" aria-hidden />
      {label ? <span class="ui-check__label">{label}</span> : null}
    </label>
    );
  };
  },
);

export const Switch = defineVueComponent<CheckboxProps>(
  ['checked', 'onCheckedChange', 'label', 'disabled', 'id', 'name', 'error'],
  (props, context) => {
  const innerRef = ref<HTMLInputElement | null>(null);
  const commitProgrammaticValue = (checked: boolean): void => {
    const control = innerRef.value;
    if (control) {
      syncNativeControlValue(control, checked);
      dispatchControlEvent(control);
    }
    props.onCheckedChange(checked);
  };
  context.expose({
    getValue: () => innerRef.value?.checked ?? props.checked,
    setValue: commitProgrammaticValue,
  });
  watch(() => props.checked, (checked) => {
    if (innerRef.value) syncNativeControlValue(innerRef.value, checked);
  });
  return () => {
    const { checked, label, disabled, id, name, error } = props;
    return (
    <label for={id} class={`ui-switch ${error ? 'has-error' : ''} ${disabled ? 'is-disabled' : ''}`}>
      <input
        ref={innerRef}
        id={id}
        name={name}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => props.onCheckedChange((e.currentTarget as HTMLInputElement).checked)}
      />
      <span class="ui-switch__track" aria-hidden>
        <span class="ui-switch__thumb" />
      </span>
      {label ? <span class="ui-switch__label">{label}</span> : null}
    </label>
    );
  };
  },
);

export default Checkbox;
</script>
