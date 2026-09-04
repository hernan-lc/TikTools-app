<script lang="tsx">
import { ref, watch } from 'vue';
import { defineVueComponent } from '../../vue/component.ts';
import { InfoTip } from './InfoTip.vue';

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
  /** MUI-style floating label. When set, the label lives inside until focus/filled. */
  label?: string;
  /** Tooltip-only explanation (ⓘ). Never rendered as a paragraph. */
  hint?: string;
  template?: boolean;
  templateHint?: string;
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

export const TextInput = defineVueComponent<TextInputProps>(
  ['value', 'onValueChange', 'placeholder', 'label', 'hint', 'template', 'templateHint', 'prefix', 'suffix', 'disabled', 'error', 'id', 'type', 'autoComplete', 'spellCheck', 'required', 'clearable', 'onEnter'],
  (props, context) => {
  const innerRef = ref<HTMLInputElement | null>(null);
  context.expose({
    getValue: () => innerRef.value?.value ?? props.value,
    setValue: (value: string) => props.onValueChange(value),
    focus: () => innerRef.value?.focus(),
    clear: () => props.onValueChange(''),
    validate: () => !(props.required && !props.value.trim()),
  });

  watch(() => props.value, (value) => {
    if (innerRef.value && innerRef.value.value !== value) innerRef.value.value = value;
  });

  const handleInput = (e: Event) => props.onValueChange((e.currentTarget as HTMLInputElement).value);
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && props.onEnter) props.onEnter();
  };

  return () => {
    const { value, onValueChange, placeholder, label, hint, prefix, suffix, disabled, error, id, type = 'text', autoComplete = 'off', spellCheck = false, required, clearable, onEnter } = props;
    if (label) {
      const filled = value.trim().length > 0 || type === 'password' && value.length > 0;
      return (
      <div class={`ui-float ${filled ? 'is-filled' : ''} ${error ? 'has-error' : ''} ${disabled ? 'is-disabled' : ''}`}>
        <div class="ui-float__control">
          {prefix ? <span class="ui-float__prefix">{prefix}</span> : null}
          <input
            ref={innerRef}
            id={id}
            type={type}
            value={value}
            placeholder=" "
            disabled={disabled}
            autocomplete={autoComplete}
            spellcheck={spellCheck}
            required={required}
            aria-invalid={Boolean(error)}
            aria-label={label}
            onInput={handleInput}
            onKeydown={handleKeyDown}
          />
          <label class="ui-float__label" for={id}>
            {label}{required ? ' *' : ''}
            {hint ? <InfoTip text={hint} position="right" /> : null}
          </label>
          {clearable && value ? (
            <button type="button" class="ui-float__clear" style={{ right: suffix ? 44 : 8 }} onClick={() => onValueChange('')} aria-label="Clear">×</button>
          ) : null}
          {suffix ? <span class="ui-float__suffix">{suffix}</span> : null}
        </div>
        {error ? <span class="ui-float__error">{error}</span> : null}
      </div>
    );
    }

    return (
    <div class={`ui-input ${error ? 'has-error' : ''} ${disabled ? 'is-disabled' : ''} ${prefix ? 'has-prefix' : ''} ${suffix || clearable ? 'has-suffix' : ''}`}>
      {prefix ? <span class="ui-input__prefix">{prefix}</span> : null}
      <input
        ref={innerRef}
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        autocomplete={autoComplete}
        spellcheck={spellCheck}
        required={required}
        aria-invalid={Boolean(error)}
        onInput={handleInput}
        onKeydown={handleKeyDown}
      />
      {clearable && value ? (
        <button type="button" class="ui-input__clear" onClick={() => onValueChange('')} aria-label="Clear">
          ×
        </button>
      ) : null}
      {suffix ? <span class="ui-input__suffix">{suffix}</span> : null}
    </div>
    );
  };
  },
);

export type SearchInputProps = {
  value: string;
  onValueChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
};

export const SearchInput = defineVueComponent<SearchInputProps>(
  ['value', 'onValueChange', 'placeholder', 'disabled', 'id'],
  (props, context) => {
  const innerRef = ref<HTMLInputElement | null>(null);
  context.expose({
    getValue: () => innerRef.value?.value ?? props.value,
    setValue: (value: string) => props.onValueChange(value),
    focus: () => innerRef.value?.focus(),
    clear: () => props.onValueChange(''),
    validate: () => true,
  });
  return () => {
    const { value, onValueChange, placeholder, disabled, id } = props;
    return (
    <div class={`ui-search ${disabled ? 'is-disabled' : ''}`}>
      <span class="ui-search__icon" aria-hidden>
        ⌕
      </span>
      <input
        ref={innerRef}
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onInput={(e) => onValueChange((e.currentTarget as HTMLInputElement).value)}
      />
      {value ? (
        <button type="button" class="ui-search__clear" onClick={() => onValueChange('')} aria-label="Clear search">
          ×
        </button>
      ) : null}
    </div>
    );
  };
  },
);

export default TextInput;
</script>
