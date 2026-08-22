import { useRef, useImperativeHandle, forwardRef } from 'preact/compat';

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

export const Checkbox = forwardRef<CheckboxHandle, CheckboxProps>(function Checkbox(
  { checked, onCheckedChange, label, disabled, id, error },
  ref,
) {
  const innerRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({
    getValue: () => innerRef.current?.checked ?? checked,
    setValue: (v: boolean) => onCheckedChange(v),
  }));
  return (
    <label htmlFor={id} className={`ui-check ${error ? 'has-error' : ''} ${disabled ? 'is-disabled' : ''}`}>
      <input
        ref={innerRef}
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onCheckedChange(e.currentTarget.checked)}
      />
      <span className="ui-check__box" aria-hidden />
      {label ? <span className="ui-check__label">{label}</span> : null}
    </label>
  );
});

export const Switch = forwardRef<CheckboxHandle, CheckboxProps>(function Switch(
  { checked, onCheckedChange, label, disabled, id, error },
  ref,
) {
  const innerRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({
    getValue: () => innerRef.current?.checked ?? checked,
    setValue: (v: boolean) => onCheckedChange(v),
  }));
  return (
    <label htmlFor={id} className={`ui-switch ${error ? 'has-error' : ''} ${disabled ? 'is-disabled' : ''}`}>
      <input
        ref={innerRef}
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onCheckedChange(e.currentTarget.checked)}
      />
      <span className="ui-switch__track" aria-hidden>
        <span className="ui-switch__thumb" />
      </span>
      {label ? <span className="ui-switch__label">{label}</span> : null}
    </label>
  );
});
