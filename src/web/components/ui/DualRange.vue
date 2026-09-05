<script lang="tsx">
import { computed, ref } from 'vue';
import { defineVueComponent } from '../../vue/component.ts';
import { FormField } from './FormField.vue';
import { clampDualRange, clampNumber } from './controls.ts';

type DualRangeProps = {
  value: [number, number];
  onValueChange: (v: [number, number]) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  hint?: string;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  name?: string;
  showInputs?: boolean;
};

export const DualRange = defineVueComponent<DualRangeProps>(
  ['value', 'onValueChange', 'min', 'max', 'step', 'label', 'hint', 'error', 'disabled', 'required', 'id', 'name', 'showInputs'],
  (props, context) => {
  const lowRef = ref<HTMLInputElement | null>(null);
  const highRef = ref<HTMLInputElement | null>(null);
  context.expose({
    getValue: () => [...props.value] as [number, number],
    setValue: (v: [number, number]) => props.onValueChange(clampDualRange(v, props.min ?? 0, props.max ?? 100)),
    focus: () => lowRef.value?.focus(),
  });
  return () => {
    const min = props.min ?? 0;
    const max = props.max ?? 100;
    const step = props.step ?? 1;
    const [low, high] = clampDualRange(props.value, min, max);
    const span = Math.max(max - min, 1);
    const left = ((low - min) / span) * 100;
    const width = ((high - low) / span) * 100;
    const setLow = (next: number): void => {
      props.onValueChange([clampNumber(Math.min(next, high), min, max), high]);
    };
    const setHigh = (next: number): void => {
      props.onValueChange([low, clampNumber(Math.max(next, low), min, max)]);
    };
    const trackStyle = computed(() => ({ left: `${left}%`, width: `${width}%` }));
    const control = (
      <div class={`ui-dual-range ${props.disabled ? 'is-disabled' : ''} ${props.error ? 'has-error' : ''}`}>
        {props.name ? <input type="hidden" name={`${props.name}[0]`} value={String(low)} /> : null}
        {props.name ? <input type="hidden" name={`${props.name}[1]`} value={String(high)} /> : null}
        <div class="ui-dual-range__track" aria-hidden>
          <div class="ui-dual-range__fill" style={trackStyle.value} />
        </div>
        <div class="ui-dual-range__inputs">
          <input
            ref={lowRef}
            type="range"
            min={min}
            max={max}
            step={step}
            value={String(low)}
            disabled={props.disabled}
            aria-label={`${props.label ?? 'Range'} minimum`}
            aria-valuemin={min}
            aria-valuemax={high}
            aria-valuenow={low}
            onInput={(e) => setLow(Number((e.currentTarget as HTMLInputElement).value))}
          />
          <input
            ref={highRef}
            type="range"
            min={min}
            max={max}
            step={step}
            value={String(high)}
            disabled={props.disabled}
            aria-label={`${props.label ?? 'Range'} maximum`}
            aria-valuemin={low}
            aria-valuemax={max}
            aria-valuenow={high}
            onInput={(e) => setHigh(Number((e.currentTarget as HTMLInputElement).value))}
          />
        </div>
        <div class="ui-dual-range__values">
          {props.showInputs !== false ? (
            <label class="ui-dual-range__number">Min
              <input
                type="number"
                min={min}
                max={high}
                step={step}
                value={String(low)}
                disabled={props.disabled}
                onInput={(e) => {
                  const next = Number((e.currentTarget as HTMLInputElement).value);
                  if (Number.isFinite(next)) setLow(next);
                }}
              />
            </label>
          ) : <output>{low}</output>}
          {props.showInputs !== false ? (
            <label class="ui-dual-range__number">Max
              <input
                type="number"
                min={low}
                max={max}
                step={step}
                value={String(high)}
                disabled={props.disabled}
                onInput={(e) => {
                  const next = Number((e.currentTarget as HTMLInputElement).value);
                  if (Number.isFinite(next)) setHigh(next);
                }}
              />
            </label>
          ) : <output>{high}</output>}
        </div>
      </div>
    );
    if (!props.label && !props.hint && !props.error) return control;
    return (
      <FormField label={props.label} hint={props.hint} error={props.error} required={props.required}>
        {control}
      </FormField>
    );
  };
  },
);

export default DualRange;
</script>
