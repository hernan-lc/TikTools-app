<script lang="tsx">
import { ref, watch } from 'vue';
import { defineVueComponent } from '../../vue/component.ts';
import { FormField } from './FormField.vue';
import { normalizeOtpValue } from './controls.ts';

type OtpInputProps = {
  value: string;
  onValueChange: (v: string) => void;
  length?: number;
  mode?: 'numeric' | 'alphanumeric';
  label?: string;
  hint?: string;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  name?: string;
  autoComplete?: string;
};

let otpFallback = 0;

export const OtpInput = defineVueComponent<OtpInputProps>(
  ['value', 'onValueChange', 'length', 'mode', 'label', 'hint', 'error', 'disabled', 'required', 'id', 'name', 'autoComplete'],
  (props, context) => {
  const boxes = ref<Array<HTMLInputElement | null>>([]);
  const focusAt = (index: number): void => boxes.value[index]?.focus();
  context.expose({
    getValue: () => props.value,
    setValue: (v: string) => props.onValueChange(normalizeOtpValue(v, props.length ?? 6, props.mode ?? 'numeric')),
    focus: () => focusAt(0),
    clear: () => props.onValueChange(''),
  });
  watch(() => props.value, () => undefined);
  return () => {
    otpFallback += 1;
    const length = props.length ?? 6;
    const mode = props.mode ?? 'numeric';
    const baseId = props.id ?? (props.name ? `tt-otp-${props.name}` : `tt-otp-${otpFallback}`);
    const hintId = props.hint ? `${baseId}-hint` : undefined;
    const errorId = props.error ? `${baseId}-error` : undefined;
    const describedBy = [hintId, errorId].filter((entry): entry is string => Boolean(entry)).join(' ') || undefined;
    const chars = Array.from({ length }, (_, i) => props.value[i] ?? '');
    const setChar = (index: number, char: string): void => {
      const clean = normalizeOtpValue(char, 1, mode);
      const list = props.value.split('');
      while (list.length < length) list.push('');
      list[index] = clean;
      const next = normalizeOtpValue(list.join(''), length, mode);
      props.onValueChange(next);
      if (clean && index < length - 1) focusAt(index + 1);
    };
    return (
      <FormField label={props.label} hint={props.hint} error={props.error} required={props.required}>
        <div class={`ui-otp ${props.error ? 'has-error' : ''} ${props.disabled ? 'is-disabled' : ''}`} role="group" aria-label={props.label ?? 'One-time code'}>
          {props.name ? <input type="hidden" name={props.name} value={props.value} /> : null}
          {chars.map((char, index) => (
            <input
              key={index}
              ref={(el) => { boxes.value[index] = el as HTMLInputElement | null; }}
              id={index === 0 ? baseId : `${baseId}-${index}`}
              value={char}
              disabled={props.disabled}
              required={props.required}
              inputmode={mode === 'numeric' ? 'numeric' : 'text'}
              autocomplete={index === 0 ? (props.autoComplete ?? 'one-time-code') : 'off'}
              maxlength={1}
              aria-label={`Digit ${index + 1} of ${length}`}
              aria-invalid={Boolean(props.error)}
              aria-describedby={index === 0 ? describedBy : undefined}
              class="ui-otp__box"
              onInput={(e) => {
                const target = e.currentTarget as HTMLInputElement;
                const incoming = target.value;
                if (incoming.length > 1) {
                  props.onValueChange(normalizeOtpValue(incoming, length, mode));
                  focusAt(Math.min(incoming.length, length - 1));
                  return;
                }
                setChar(index, incoming);
              }}
              onKeydown={(e) => {
                const target = e.currentTarget as HTMLInputElement;
                if (e.key === 'Backspace' && !target.value && index > 0) {
                  e.preventDefault();
                  const list = props.value.split('');
                  list[index - 1] = '';
                  props.onValueChange(normalizeOtpValue(list.join(''), length, mode));
                  focusAt(index - 1);
                } else if (e.key === 'ArrowLeft' && index > 0) {
                  e.preventDefault();
                  focusAt(index - 1);
                } else if (e.key === 'ArrowRight' && index < length - 1) {
                  e.preventDefault();
                  focusAt(index + 1);
                }
              }}
              onPaste={(e) => {
                const text = (e as ClipboardEvent).clipboardData?.getData('text') ?? '';
                if (!text) return;
                e.preventDefault();
                props.onValueChange(normalizeOtpValue(text, length, mode));
                focusAt(Math.min(text.replace(/[^a-zA-Z0-9]/g, '').length, length - 1));
              }}
              onFocus={(e) => (e.currentTarget as HTMLInputElement).select()}
            />
          ))}
        </div>
      </FormField>
    );
  };
  },
);

export default OtpInput;
</script>
