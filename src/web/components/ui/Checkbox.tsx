import { ref } from 'vue';
import { defineVueComponent } from '../../vue/component.ts';

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
  error?: string;
};

export const Checkbox = defineVueComponent<CheckboxProps>(
  ['checked', 'onCheckedChange', 'label', 'disabled', 'id', 'error'],
  (props, context) => {
  const innerRef = ref<HTMLInputElement | null>(null);
  context.expose({
    getValue: () => innerRef.value?.checked ?? props.checked,
    setValue: (value: boolean) => props.onCheckedChange(value),
  });
  return () => {
    const { checked, onCheckedChange, label, disabled, id, error } = props;
    return (
    <label for={id} class={`ui-check ${error ? 'has-error' : ''} ${disabled ? 'is-disabled' : ''}`}>
      <input
        ref={innerRef}
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onCheckedChange((e.currentTarget as HTMLInputElement).checked)}
      />
      <span class="ui-check__box" aria-hidden />
      {label ? <span class="ui-check__label">{label}</span> : null}
    </label>
    );
  };
  },
);

export const Switch = defineVueComponent<CheckboxProps>(
  ['checked', 'onCheckedChange', 'label', 'disabled', 'id', 'error'],
  (props, context) => {
  const innerRef = ref<HTMLInputElement | null>(null);
  context.expose({
    getValue: () => innerRef.value?.checked ?? props.checked,
    setValue: (value: boolean) => props.onCheckedChange(value),
  });
  return () => {
    const { checked, onCheckedChange, label, disabled, id, error } = props;
    return (
    <label for={id} class={`ui-switch ${error ? 'has-error' : ''} ${disabled ? 'is-disabled' : ''}`}>
      <input
        ref={innerRef}
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onCheckedChange((e.currentTarget as HTMLInputElement).checked)}
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
