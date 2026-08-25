import { useState } from 'preact/hooks';

import {
  fieldsForTrigger,
  findField,
  operatorsFor,
  type FieldValueKind,
} from '../../../automation/behavior/fields.ts';
import type { EventFilter, FilterOperator } from '../../../automation/behavior/types.ts';
import type { AutomationEventType } from '../../../automation/types.ts';
import type { GiftCatalogEntry, ViewerRecord } from '../../../shared/messages.ts';
import type { Locale } from '../../i18n.ts';
import { FieldIconGlyph, OperatorGlyph, OPERATOR_CODE, OPERATOR_LABELS } from '../condition-icons.tsx';
import { GiftPicker, UserPicker } from './GiftPicker.tsx';
import { IconSelect } from './IconSelect.tsx';
import { InfoTip } from './InfoTip.tsx';

const COPY = {
  es: {
    colField: 'Dato',
    colOperator: 'Comparación',
    colValue: 'Valor',
    add: 'Añadir condición',
    remove: 'Quitar',
    custom: 'Otro campo (avanzado)…',
    customPlaceholder: 'event.data.loQueSea',
    missing: 'falta el valor',
    missingHint: 'Sin valor, esta condición no se cumple nunca: rellénala o quítala.',
    choose: 'Elegir…',
    empty: 'Sin condiciones: el evento se dispara siempre.',
    headHint: 'Se comparan datos del evento. Todas las condiciones deben cumplirse; el único «o» es la comparación «es uno de».',
    yes: 'sí',
    no: 'no',
    values: (count: number) => `${count} valores`,
  },
  en: {
    colField: 'Field',
    colOperator: 'Comparison',
    colValue: 'Value',
    add: 'Add condition',
    remove: 'Remove',
    custom: 'Another field (advanced)…',
    customPlaceholder: 'event.data.whatever',
    missing: 'value missing',
    missingHint: 'With no value this condition never passes: fill it in or remove it.',
    choose: 'Pick…',
    empty: 'No conditions: the event always fires.',
    headHint: 'Event data is compared. Every condition must pass; the only "or" is the "is one of" comparison.',
    yes: 'yes',
    no: 'no',
    values: (count: number) => `${count} values`,
  },
} as const;

const CUSTOM = '__custom__';

type ConditionTableProps = {
  locale: Locale;
  trigger: AutomationEventType;
  filters: EventFilter[];
  gifts: GiftCatalogEntry[];
  viewers: ViewerRecord[];
  onChange: (filters: EventFilter[]) => void;
};

type PickerState = { index: number; kind: 'gift' | 'user'; multiple: boolean } | null;

/**
 * The compact conditions table: the field comes from a list (never typed), the
 * comparison carries its symbol, and the value uses the editor its type asks
 * for — a gift picker, a viewer picker, a number, a switch.
 */
export function ConditionTable({ locale, trigger, filters, gifts, viewers, onChange }: ConditionTableProps) {
  const copy = COPY[locale];
  const [picker, setPicker] = useState<PickerState>(null);
  const fields = fieldsForTrigger(trigger);

  const update = (index: number, patch: Partial<EventFilter>): void => {
    onChange(filters.map((filter, position) => (position === index ? { ...filter, ...patch } : filter)));
  };

  const kindOf = (filter: EventFilter): FieldValueKind => findField(trigger, filter.path)?.kind ?? 'text';

  const changeField = (index: number, path: string): void => {
    if (path === CUSTOM) {
      update(index, { path: '', operator: 'eq', value: '', values: undefined });
      return;
    }
    const kind = findField(trigger, path)?.kind ?? 'text';
    const operators = operatorsFor(kind);
    const current = filters[index]!;
    const operator = operators.includes(current.operator) ? current.operator : operators[0]!;
    update(index, {
      path,
      operator,
      value: operator === 'is-true' || operator === 'is-false' ? '' : current.value,
      values: operator === 'in' ? current.values ?? [] : undefined,
    });
  };

  const addFilter = (): void => {
    const first = fields[0];
    const kind = first?.kind ?? 'text';
    onChange([
      ...filters,
      {
        path: first?.path ?? 'event.user.uniqueId',
        operator: operatorsFor(kind)[0]!,
        value: '',
        values: undefined,
      },
    ]);
  };

  const valuesOf = (filter: EventFilter): string[] => (filter.operator === 'in'
    ? filter.values ?? []
    : filter.value
      ? [filter.value]
      : []);

  const applyPick = (index: number, values: string[]): void => {
    const filter = filters[index]!;
    if (filter.operator === 'in') update(index, { values });
    else update(index, { value: values[0] ?? '' });
    setPicker(null);
  };

  return (
    <div className="plg-cond">
      <div className="plg-cond__head">
        <span>
          {copy.colField}
          <InfoTip text={copy.headHint} position="bottom" />
        </span>
        <span>{copy.colOperator}</span>
        <span>{copy.colValue}</span>
        <span />
      </div>

      {filters.length === 0 && <p className="plg-note plg-cond__empty">{copy.empty}</p>}

      {filters.map((filter, index) => {
        const field = findField(trigger, filter.path);
        const kind = kindOf(filter);
        const operators = operatorsFor(kind);
        const picked = valuesOf(filter);
        const needsValue = filter.operator !== 'is-true' && filter.operator !== 'is-false';
        const missing = needsValue && picked.length === 0;

        return (
          <div className="plg-cond__row" key={`${index}-${filter.path}`}>
            <span className="plg-cond__cell">
              <IconSelect
                className="plg-cond__select"
                ariaLabel={copy.colField}
                value={field ? filter.path : CUSTOM}
                placeholder={copy.custom}
                onChange={(path) => changeField(index, path)}
                options={[
                  ...fields.map((entry) => ({
                    value: entry.path,
                    label: entry.label[locale],
                    meta: entry.path,
                    hint: entry.hint[locale],
                    icon: <FieldIconGlyph icon={entry.icon} />,
                  })),
                  { value: CUSTOM, label: copy.custom, icon: <FieldIconGlyph icon="text" /> },
                ]}
              />
            </span>

            <span className="plg-cond__cell">
              <IconSelect
                className="plg-cond__select"
                ariaLabel={copy.colOperator}
                value={filter.operator}
                onChange={(next) => {
                  const operator = next as FilterOperator;
                  update(index, {
                    operator,
                    values: operator === 'in' ? filter.values ?? picked : undefined,
                    value: operator === 'in' ? '' : filter.value || picked[0] || '',
                  });
                }}
                options={operators.map((operator) => ({
                  value: operator,
                  label: OPERATOR_LABELS[operator][locale],
                  meta: OPERATOR_CODE[operator],
                  icon: <OperatorGlyph operator={operator} />,
                }))}
              />
            </span>

            <span className="plg-cond__cell plg-cond__cell--value">
              <ConditionValue
                locale={locale}
                filter={filter}
                kind={kind}
                missing={missing}
                copy={copy}
                onOpenPicker={(multiple) => setPicker({
                  index,
                  kind: kind === 'gift' ? 'gift' : 'user',
                  multiple,
                })}
                onValue={(value) => update(index, { value })}
                onValues={(values) => update(index, { values })}
              />
            </span>

            <button
              type="button"
              className="plg-iconbtn is-danger"
              aria-label={copy.remove}
              data-tooltip={copy.remove}
              data-tooltip-pos="left"
              onClick={() => onChange(filters.filter((_, position) => position !== index))}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>

            {!field && (
              <input
                className="plg-input plg-input--mono plg-cond__custom"
                value={filter.path}
                placeholder={copy.customPlaceholder}
                onInput={(event) => update(index, { path: (event.currentTarget as HTMLInputElement).value })}
              />
            )}

            {missing && (
              <span className="plg-cond__err">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 8v5m0 3h.01" />
                </svg>
                {copy.missingHint}
              </span>
            )}
          </div>
        );
      })}

      <button type="button" className="plg-dashed" onClick={addFilter}>{copy.add}</button>

      {picker && picker.kind === 'gift' && (
        <GiftPicker
          locale={locale}
          gifts={gifts}
          selected={valuesOf(filters[picker.index]!)}
          multiple={picker.multiple}
          onPick={(values) => applyPick(picker.index, values)}
          onClose={() => setPicker(null)}
        />
      )}
      {picker && picker.kind === 'user' && (
        <UserPicker
          locale={locale}
          viewers={viewers}
          selected={valuesOf(filters[picker.index]!)}
          multiple={picker.multiple}
          onPick={(values) => applyPick(picker.index, values)}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

type ValueProps = {
  locale: Locale;
  filter: EventFilter;
  kind: FieldValueKind;
  missing: boolean;
  copy: (typeof COPY)[Locale];
  onOpenPicker: (multiple: boolean) => void;
  onValue: (value: string) => void;
  onValues: (values: string[]) => void;
};

/** The value editor the field's type asks for. */
function ConditionValue({ locale, filter, kind, missing, copy, onOpenPicker, onValue, onValues }: ValueProps) {
  if (filter.operator === 'is-true' || filter.operator === 'is-false') {
    return <span className="plg-cond__fixed">{filter.operator === 'is-true' ? copy.yes : copy.no}</span>;
  }

  if (kind === 'gift' || kind === 'user') {
    const multiple = filter.operator === 'in';
    const values = multiple ? filter.values ?? [] : filter.value ? [filter.value] : [];
    return (
      <button
        type="button"
        className={`plg-cond__pick${missing ? ' is-missing' : ''}`}
        onClick={() => onOpenPicker(multiple)}
      >
        {values.length === 0 && <span>{missing ? copy.missing : copy.choose}</span>}
        {values.length === 1 && <span>{kind === 'user' ? `@${values[0]}` : values[0]}</span>}
        {values.length > 1 && <span>{copy.values(values.length)}</span>}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
    );
  }

  if (filter.operator === 'in') {
    const values = filter.values ?? [];
    return (
      <span className="plg-cond__list">
        {values.map((value, index) => (
          <button
            type="button"
            className="plg-pill plg-pill--accent ui-picker__chip"
            key={`${value}-${index}`}
            onClick={() => onValues(values.filter((_, position) => position !== index))}
          >
            {value}
            <span aria-hidden="true">×</span>
          </button>
        ))}
        <input
          className={`plg-input plg-cond__inline${missing ? ' is-missing' : ''}`}
          placeholder={locale === 'es' ? 'añadir y pulsar Intro' : 'add and press Enter'}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            const input = event.currentTarget as HTMLInputElement;
            const value = input.value.trim();
            if (!value) return;
            onValues([...values, value]);
            input.value = '';
          }}
        />
      </span>
    );
  }

  return (
    <input
      className={`plg-input${missing ? ' is-missing' : ''}`}
      type={kind === 'number' ? 'number' : 'text'}
      value={filter.value}
      placeholder={missing ? copy.missing : ''}
      onInput={(event) => onValue((event.currentTarget as HTMLInputElement).value)}
    />
  );
}
