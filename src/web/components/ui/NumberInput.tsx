import { useRef, useImperativeHandle, forwardRef } from 'preact/compat';

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

export const NumberInput = forwardRef<NumberInputHandle, NumberInputProps>(function NumberInput(
  { value, onValueChange, min, max, step = 1, disabled, error, id, suffix, placeholder },
  ref,
) {
  const innerRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    getValue: () => value,
    setValue: (v: number) => onValueChange(clamp(toFixedStep(v, step), min, max)),
    focus: () => innerRef.current?.focus(),
  }));

  const handleInput = (e: Event) => {
    const raw = (e.currentTarget as HTMLInputElement).value;
    const parsed = raw === '' ? 0 : Number(raw);
    if (Number.isNaN(parsed)) return;
    onValueChange(clamp(toFixedStep(parsed, step), min, max));
  };

  const nudge = (dir: 1 | -1) => {
    if (disabled) return;
    const next = clamp(toFixedStep(value + dir * step, step), min, max);
    onValueChange(next);
  };

  return (
    <div className={`ui-number ${error ? 'has-error' : ''} ${disabled ? 'is-disabled' : ''}`}>
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
      <div className="ui-number__steppers" aria-hidden>
        <button type="button" tabIndex={-1} disabled={disabled} onClick={() => nudge(1)}>
          ▲
        </button>
        <button type="button" tabIndex={-1} disabled={disabled} onClick={() => nudge(-1)}>
          ▼
        </button>
      </div>
      {suffix ? <span className="ui-number__suffix">{suffix}</span> : null}
    </div>
  );
});
