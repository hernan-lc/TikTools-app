<script lang="tsx">
import { ref } from 'vue';
import { InfoTip } from './InfoTip.vue';
import { defineVueComponent } from '../../vue/component.ts';

export type NumberInputHandle = {
  getValue: () => number;
  setValue: (v: number) => void;
  focus: () => void;
};

type NumberInputProps = {
  value: number;
  onValueChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  error?: string;
  id?: string;
  suffix?: string;
  placeholder?: string;
  /** MUI-style floating label. */
  label?: string;
  /** Tooltip-only explanation (ⓘ). */
  hint?: string;
};

function clamp(v: number, min?: number, max?: number): number {
  let out = v;
  if (min !== undefined) out = Math.max(min, out);
  if (max !== undefined) out = Math.min(max, out);
  return out;
}

function toFixedStep(v: number, step?: number): number {
  if (!step || step >= 1) return Math.round(v);
  const decimals = String(step).split('.')[1]?.length ?? 2;
  return Number(v.toFixed(decimals));
}

export const NumberInput = defineVueComponent<NumberInputProps>(
  ['value', 'onValueChange', 'min', 'max', 'step', 'disabled', 'error', 'id', 'suffix', 'placeholder', 'label', 'hint'],
  (props, context) => {
  const innerRef = ref<HTMLInputElement | null>(null);
  context.expose({
    getValue: () => props.value,
    setValue: (value: number) => props.onValueChange(clamp(toFixedStep(value, props.step), props.min, props.max)),
    focus: () => innerRef.value?.focus(),
  });

  const handleInput = (e: Event) => {
    const raw = (e.currentTarget as HTMLInputElement).value;
    const parsed = raw === '' ? 0 : Number(raw);
    if (Number.isNaN(parsed)) return;
    props.onValueChange(clamp(toFixedStep(parsed, props.step), props.min, props.max));
  };

  const nudge = (dir: 1 | -1) => {
    if (props.disabled) return;
    const next = clamp(toFixedStep(props.value + dir * (props.step ?? 1), props.step), props.min, props.max);
    props.onValueChange(next);
  };

  return () => {
    const { value, onValueChange, min, max, step = 1, disabled, error, id, suffix, placeholder, label, hint } = props;
    if (label) {
      return (
      <div class={`ui-float is-filled ${error ? 'has-error' : ''} ${disabled ? 'is-disabled' : ''}`}>
        <div class="ui-float__control">
          <input
            ref={innerRef}
            id={id}
            type="number"
            value={String(value)}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            placeholder=" "
            aria-invalid={Boolean(error)}
            aria-label={label}
            onInput={handleInput}
          />
          <label class="ui-float__label" for={id}>
            {label}
            {hint ? <InfoTip text={hint} position="right" /> : null}
          </label>
          <div class="ui-number__steppers" aria-hidden>
            <button type="button" tabindex={-1} disabled={disabled} onClick={() => nudge(1)}>▲</button>
            <button type="button" tabindex={-1} disabled={disabled} onClick={() => nudge(-1)}>▼</button>
          </div>
          {suffix ? <span class="ui-float__suffix">{suffix}</span> : null}
        </div>
      </div>
    );
    }

    return (
    <div class={`ui-number ${error ? 'has-error' : ''} ${disabled ? 'is-disabled' : ''}`}>
      <input
        ref={innerRef}
        id={id}
        type="number"
        value={String(value)}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        placeholder={placeholder}
        aria-invalid={Boolean(error)}
        onInput={handleInput}
      />
      <div class="ui-number__steppers" aria-hidden>
        <button type="button" tabindex={-1} disabled={disabled} onClick={() => nudge(1)}>
          ▲
        </button>
        <button type="button" tabindex={-1} disabled={disabled} onClick={() => nudge(-1)}>
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
