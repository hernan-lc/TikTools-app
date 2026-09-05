<script lang="tsx">
import { ref, watch } from 'vue';
import { InfoTip } from './InfoTip.vue';
import { defineVueComponent } from '../../vue/component.ts';
import { dispatchControlEvent, syncNativeControlValue } from './control-events.ts';
import { clampNumber } from './controls.ts';

export type NumberInputHandle = {
  getValue: () => number | null;
  setValue: (v: number | null) => void;
  focus: () => void;
};

type NumberInputProps = {
  value: number | null;
  onValueChange: (v: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  readonly?: boolean;
  required?: boolean;
  error?: string;
  id?: string;
  name?: string;
  suffix?: string;
  placeholder?: string;
  /** MUI-style floating label. */
  label?: string;
  /** Tooltip-only explanation (ⓘ). */
  hint?: string;
};

function toFixedStep(v: number, step?: number): number {
  if (!step || step >= 1) return Math.round(v);
  const decimals = String(step).split('.')[1]?.length ?? 2;
  return Number(v.toFixed(decimals));
}

export const NumberInput = defineVueComponent<NumberInputProps>(
  ['value', 'onValueChange', 'min', 'max', 'step', 'disabled', 'readonly', 'required', 'error', 'id', 'name', 'suffix', 'placeholder', 'label', 'hint'],
  (props, context) => {
  const innerRef = ref<HTMLInputElement | null>(null);
  // Draft keeps intermediate typing states (empty, "-", "1.") possible.
  const draft = ref<string | null>(null);
  const display = (): string => {
    if (draft.value !== null) return draft.value;
    return props.value === null || props.value === undefined ? '' : String(props.value);
  };
  const commitProgrammaticValue = (value: number | null): void => {
    draft.value = null;
    const next = value === null ? null : clampNumber(toFixedStep(value, props.step), props.min, props.max);
    const control = innerRef.value;
    if (control) {
      syncNativeControlValue(control, next === null ? '' : String(next));
      dispatchControlEvent(control);
    }
    props.onValueChange(next);
  };
  context.expose({
    getValue: () => props.value,
    setValue: commitProgrammaticValue,
    focus: () => innerRef.value?.focus(),
  });

  watch(() => props.value, (value) => {
    draft.value = null;
    if (innerRef.value) syncNativeControlValue(innerRef.value, value === null || value === undefined ? '' : String(value));
  });

  const parseAndEmit = (raw: string): void => {
    if (raw.trim() === '' || raw === '-' || raw === '.' || raw === '-.') {
      draft.value = raw;
      props.onValueChange(null);
      return;
    }
    const parsed = Number(raw);
    if (Number.isNaN(parsed)) {
      draft.value = raw;
      return;
    }
    // While typing, don't clamp (would block intermediate values); clamp on blur/stepper.
    draft.value = raw;
    props.onValueChange(toFixedStep(parsed, props.step));
  };

  const commitClamp = (): void => {
    if (draft.value === null) return;
    const raw = draft.value;
    draft.value = null;
    if (raw.trim() === '' || raw === '-' || raw === '.' || raw === '-.') {
      props.onValueChange(null);
      return;
    }
    const parsed = Number(raw);
    if (Number.isNaN(parsed)) return;
    props.onValueChange(clampNumber(toFixedStep(parsed, props.step), props.min, props.max));
  };

  const nudge = (dir: 1 | -1) => {
    if (props.disabled || props.readonly) return;
    const base = props.value ?? 0;
    const next = clampNumber(toFixedStep(base + dir * (props.step ?? 1), props.step), props.min, props.max);
    commitProgrammaticValue(next);
  };

  return () => {
    const { min, max, step = 1, disabled, readonly, required, error, id, name, suffix, placeholder, label, hint } = props;
    const text = display();
    if (label) {
      return (
      <div class={`ui-float is-filled ${error ? 'has-error' : ''} ${disabled ? 'is-disabled' : ''}`}>
        <div class="ui-float__control">
          <input
            ref={innerRef}
            id={id}
            name={name}
            type="number"
            value={text}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            readonly={readonly}
            required={required}
            placeholder=" "
            aria-invalid={Boolean(error)}
            aria-label={label}
            onInput={(e) => parseAndEmit((e.currentTarget as HTMLInputElement).value)}
            onChange={commitClamp}
            onBlur={commitClamp}
          />
          <label class="ui-float__label" for={id}>
            {label}{required ? ' *' : ''}
            {hint ? <InfoTip text={hint} position="right" /> : null}
          </label>
          <div class="ui-number__steppers" aria-hidden>
            <button type="button" tabindex={-1} disabled={disabled || readonly} onClick={() => nudge(1)}>▲</button>
            <button type="button" tabindex={-1} disabled={disabled || readonly} onClick={() => nudge(-1)}>▼</button>
          </div>
          {suffix ? <span class="ui-float__suffix">{suffix}</span> : null}
        </div>
        {error ? <span class="ui-float__error">{error}</span> : null}
      </div>
    );
    }

    return (
    <div class={`ui-number ${error ? 'has-error' : ''} ${disabled ? 'is-disabled' : ''}`}>
      <input
        ref={innerRef}
        id={id}
        name={name}
        type="number"
        value={text}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        readonly={readonly}
        required={required}
        placeholder={placeholder}
        aria-invalid={Boolean(error)}
        onInput={(e) => parseAndEmit((e.currentTarget as HTMLInputElement).value)}
        onChange={commitClamp}
        onBlur={commitClamp}
      />
      <div class="ui-number__steppers" aria-hidden>
        <button type="button" tabindex={-1} disabled={disabled || readonly} onClick={() => nudge(1)}>
          ▲
        </button>
        <button type="button" tabindex={-1} disabled={disabled || readonly} onClick={() => nudge(-1)}>
          ▼
        </button>
      </div>
      {suffix ? <span class="ui-number__suffix">{suffix}</span> : null}
    </div>
    );
  };
  },
);

export default NumberInput;
</script>
