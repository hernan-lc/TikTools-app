import { useEffect, useRef, useImperativeHandle, forwardRef } from 'preact/compat';
import type { JSX } from 'preact';

export type TextInputHandle = {
  getValue: () => string;
  setValue: (v: string) => void;
  focus: () => void;
  clear: () => void;
  validate: () => boolean;
};

type TextInputProps = {
  value: string;
  onValueChange: (v: string) => void;
  placeholder?: string;
  prefix?: string;
  suffix?: string;
  disabled?: boolean;
  error?: string;
  id?: string;
  type?: 'text' | 'password';
  autoComplete?: string;
  spellCheck?: boolean;
  required?: boolean;
  clearable?: boolean;
  onEnter?: () => void;
};

export const TextInput = forwardRef<TextInputHandle, TextInputProps>(function TextInput(
  { value, onValueChange, placeholder, prefix, suffix, disabled, error, id, type = 'text', autoComplete = 'off', spellCheck = false, required, clearable, onEnter },
  ref,
) {
  const innerRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    getValue: () => innerRef.current?.value ?? value,
    setValue: (v: string) => onValueChange(v),
    focus: () => innerRef.current?.focus(),
    clear: () => onValueChange(''),
    validate: () => {
      if (required && !value.trim()) return false;
      return true;
    },
  }));

  useEffect(() => {
    if (innerRef.current && innerRef.current.value !== value) innerRef.current.value = value;
  }, [value]);

  const handleInput: JSX.GenericEventHandler<HTMLInputElement> = (e) => onValueChange(e.currentTarget.value);
  const handleKeyDown: JSX.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === 'Enter' && onEnter) onEnter();
  };

  return (
    <div className={`ui-input ${error ? 'has-error' : ''} ${disabled ? 'is-disabled' : ''} ${prefix ? 'has-prefix' : ''} ${suffix || clearable ? 'has-suffix' : ''}`}>
      {prefix ? <span className="ui-input__prefix">{prefix}</span> : null}
      <input
        ref={innerRef}
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete={autoComplete}
        spellcheck={spellCheck}
        required={required}
        aria-invalid={Boolean(error)}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
      />
      {clearable && value ? (
        <button type="button" className="ui-input__clear" onClick={() => onValueChange('')} aria-label="Clear">
          ×
        </button>
      ) : null}
      {suffix ? <span className="ui-input__suffix">{suffix}</span> : null}
    </div>
  );
});

export type SearchInputProps = {
  value: string;
  onValueChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
};

export const SearchInput = forwardRef<TextInputHandle, SearchInputProps>(function SearchInput({ value, onValueChange, placeholder, disabled, id }, ref) {
  const innerRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({
    getValue: () => innerRef.current?.value ?? value,
    setValue: (v: string) => onValueChange(v),
    focus: () => innerRef.current?.focus(),
    clear: () => onValueChange(''),
    validate: () => true,
  }));
  return (
    <div className={`ui-search ${disabled ? 'is-disabled' : ''}`}>
      <span className="ui-search__icon" aria-hidden>
        ⌕
      </span>
      <input
        ref={innerRef}
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onInput={(e) => onValueChange(e.currentTarget.value)}
      />
      {value ? (
        <button type="button" className="ui-search__clear" onClick={() => onValueChange('')} aria-label="Clear search">
          ×
        </button>
      ) : null}
    </div>
  );
});
