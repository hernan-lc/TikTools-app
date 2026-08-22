import { useRef, useImperativeHandle, forwardRef } from 'preact/compat';
import type { JSX } from 'preact';

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
  placeholder?: string;
};

export const Select = forwardRef<SelectHandle, SelectProps>(function Select(
  { value, onValueChange, options, disabled, error, id, placeholder },
  ref,
) {
  const innerRef = useRef<HTMLSelectElement>(null);
  useImperativeHandle(ref, () => ({
    getValue: () => innerRef.current?.value ?? value,
    setValue: (v: string) => onValueChange(v),
    focus: () => innerRef.current?.focus(),
  }));

  const handleChange: JSX.GenericEventHandler<HTMLSelectElement> = (e) => onValueChange(e.currentTarget.value);

  return (
    <div className={`ui-select ${error ? 'has-error' : ''} ${disabled ? 'is-disabled' : ''}`}>
      <select ref={innerRef} id={id} value={value} disabled={disabled} aria-invalid={Boolean(error)} onChange={handleChange}>
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
      <span className="ui-select__arrow" aria-hidden>
        ▾
      </span>
    </div>
  );
});
