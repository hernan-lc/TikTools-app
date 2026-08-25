import { useMemo } from 'preact/hooks';

import type { JsonObject, JsonValue } from '../../../automation/types.ts';
import type { ActionTypeDefinition, Localized } from '../../../automation/behavior/types.ts';
import { TemplateField } from '../node-editor/TemplateField.tsx';
import type { TemplateSuggestion } from '../node-editor/template-suggestions.ts';
import type { Locale } from '../../i18n.ts';

export type SchemaFormProps = {
  locale: Locale;
  schema: JsonObject;
  uiHints?: JsonObject;
  value: JsonObject;
  onChange: (value: JsonObject) => void;
  templateSuggestions?: TemplateSuggestion[];
};

/**
 * Small, deliberately bounded JSON Schema renderer. It renders data, never
 * code: plugin packages can describe forms but cannot inject DOM or Preact.
 */
export function SchemaForm({ locale, schema, uiHints, value, onChange, templateSuggestions = [] }: SchemaFormProps) {
  const properties = useMemo(() => objectProperties(schema.properties), [schema]);
  const hints = objectProperties(uiHints?.fields);
  const visible = Object.entries(properties).filter(([key]) => applies(hints[key]?.showIf, value));
  const basic = visible.filter(([key]) => hints[key]?.advanced !== true);
  const advanced = visible.filter(([key]) => hints[key]?.advanced === true);
  const update = (key: string, next: JsonValue): void => onChange({ ...value, [key]: next });

  return (
    <div className="plg-form__schema">
      {basic.map(([key, field]) => (
        <SchemaField key={key} locale={locale} name={key} schema={field} hint={hints[key]} value={value[key]} onChange={(next) => update(key, next)} templateSuggestions={templateSuggestions} />
      ))}
      {advanced.length > 0 && (
        <details className="plg-details">
          <summary>{locale === 'es' ? 'Opciones avanzadas' : 'Advanced options'}</summary>
          <div className="plg-details__body">
            {advanced.map(([key, field]) => (
              <SchemaField key={key} locale={locale} name={key} schema={field} hint={hints[key]} value={value[key]} onChange={(next) => update(key, next)} templateSuggestions={templateSuggestions} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

export function schemaForAction(type: ActionTypeDefinition): { schema: JsonObject; uiHints?: JsonObject } {
  return {
    schema: type.configSchema ?? legacySchema(type),
    uiHints: type.uiHints ?? legacyHints(type),
  };
}

function SchemaField({ locale, name, schema, hint, value, onChange, templateSuggestions }: {
  locale: Locale;
  name: string;
  schema: JsonObject;
  hint?: JsonObject;
  value: JsonValue | undefined;
  onChange: (value: JsonValue) => void;
  templateSuggestions: TemplateSuggestion[];
}) {
  const label = localized(schema.title, locale) || name;
  const hintText = localized(hint?.hint, locale);
  const kind = typeof hint?.kind === 'string' ? hint.kind : schema.format === 'code' ? 'code' : schema.type;
  const template = hint?.template === true;
  const displayValue = toDisplayValue(value, schema.type);
  const labelNode = (
    <div className="plg-label-row">
      <label className="plg-label">{label}</label>
      {hintText ? <span className="plg-field-hint">{hintText}</span> : null}
    </div>
  );

  if (kind === 'boolean' || schema.type === 'boolean') {
    const checked = value === true || value === 'true';
    return (
      <div className="plg-switch-row">
        <button type="button" className={`plg-switch${checked ? ' is-on' : ''}`} aria-label={label} onClick={() => onChange(!checked)}>
          <span className="plg-switch__track"><span className="plg-switch__thumb" /></span>
        </button>
        <label className="plg-label" onClick={() => onChange(!checked)}>{label}</label>
        {hintText ? <span className="plg-field-hint">{hintText}</span> : null}
      </div>
    );
  }

  if (kind === 'keyvalue' || (schema.type === 'object' && schema.additionalProperties !== undefined)) {
    const entries = value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
    return (
      <div className="plg-field">
        {labelNode}
        {Object.entries(entries).map(([key, entry]) => (
          <div className="plg-kv-row" key={key}>
            <input className="plg-input plg-input--mono plg-input--key" value={key} onInput={(event) => {
              const next: JsonObject = {};
              for (const [currentKey, currentValue] of Object.entries(entries)) next[currentKey === key ? event.currentTarget.value : currentKey] = currentValue;
              onChange(next);
            }} />
            <input className="plg-input plg-input--mono" value={String(entry ?? '')} onInput={(event) => onChange({ ...entries, [key]: event.currentTarget.value })} />
            <button type="button" className="plg-btn plg-btn--icon plg-btn--danger" onClick={() => {
              const next = { ...entries };
              delete next[key];
              onChange(next);
            }}>×</button>
          </div>
        ))}
        <button type="button" className="plg-btn plg-btn--sm" onClick={() => onChange({ ...entries, [`field-${Object.keys(entries).length + 1}`]: '' })}>
          + {locale === 'es' ? 'Añadir' : 'Add'}
        </button>
      </div>
    );
  }

  const schemaOptions = Array.isArray(schema.enum) ? schema.enum.filter((entry): entry is string => typeof entry === 'string').map((value) => ({ value, label: value })) : [];
  const hintedOptions = Array.isArray(hint?.options)
    ? hint.options.filter((entry): entry is JsonObject => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry)).map((entry) => ({
      value: typeof entry.value === 'string' ? entry.value : '',
      label: localized(entry.label, locale) || (typeof entry.value === 'string' ? entry.value : ''),
    }))
    : [];
  const options = schemaOptions.length > 0 ? schemaOptions : hintedOptions;
  if (options.length > 0) {
    return (
      <div className="plg-field">
        {labelNode}
        <select className="plg-select" value={displayValue} onChange={(event) => onChange(event.currentTarget.value)}>
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
    );
  }

  if (kind === 'textarea' || kind === 'code' || schema.type === 'array' || schema.format === 'json') {
    const text = schema.type === 'array' ? formatJson(value) : schema.format === 'json' && typeof value === 'string' ? value : displayValue;
    return (
      <div className="plg-field">
        {labelNode}
        <textarea
          className={`plg-textarea${kind === 'code' ? ' plg-textarea--code' : ''}`}
          rows={kind === 'code' ? 16 : 6}
          spellcheck={false}
          value={text}
          onInput={(event) => {
            const next = event.currentTarget.value;
            if (schema.type === 'array') {
              try { onChange(JSON.parse(next) as JsonValue); } catch { onChange(next); }
            } else onChange(next);
          }}
        />
      </div>
    );
  }

  const control = template ? (
    <TemplateField value={displayValue} onValueChange={onChange} suggestions={templateSuggestions} multiline={kind === 'textarea'} />
  ) : (
    <input
      className={`plg-input${template ? ' plg-input--mono' : ''}`}
      type={kind === 'number' || schema.type === 'number' || schema.type === 'integer' ? 'number' : 'text'}
      value={displayValue}
      placeholder={typeof hint?.placeholder === 'string' ? hint.placeholder : undefined}
      onInput={(event) => {
        const next = event.currentTarget.value;
        onChange(kind === 'number' || schema.type === 'number' || schema.type === 'integer' ? (next === '' ? '' : Number(next)) : next);
      }}
    />
  );
  return <div className="plg-field">{labelNode}{control}</div>;
}

function objectProperties(value: JsonValue | undefined): Record<string, JsonObject> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, JsonObject] => Boolean(entry[1]) && typeof entry[1] === 'object' && !Array.isArray(entry[1])));
}

function localized(value: JsonValue | undefined, locale: Locale): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const candidate = (value as JsonObject)[locale];
    return typeof candidate === 'string' ? candidate : '';
  }
  return '';
}

function applies(value: JsonValue | undefined, config: JsonObject): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return true;
  const condition = value as JsonObject;
  const key = typeof condition.key === 'string' ? condition.key : '';
  if (!key) return true;
  const current = String(config[key] ?? '');
  const equals = Array.isArray(condition.equals) ? condition.equals : [];
  const notEquals = Array.isArray(condition.notEquals) ? condition.notEquals : [];
  if (equals.length > 0 && !equals.some((entry) => String(entry) === current)) return false;
  if (notEquals.some((entry) => String(entry) === current)) return false;
  return true;
}

function toDisplayValue(value: JsonValue | undefined, type: JsonValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return type === 'object' || type === 'array' ? formatJson(value) : JSON.stringify(value);
}

function formatJson(value: JsonValue | undefined): string {
  if (value === undefined) return '';
  try { return JSON.stringify(value, null, 2) ?? ''; } catch { return ''; }
}

function legacySchema(type: ActionTypeDefinition): JsonObject {
  const properties: JsonObject = {};
  for (const field of type.fields ?? []) properties[field.key] = { type: field.kind === 'number' ? 'number' : field.kind === 'boolean' ? 'boolean' : field.kind === 'keyvalue' ? 'object' : 'string', title: field.label, default: field.value };
  return { type: 'object', properties };
}

function legacyHints(type: ActionTypeDefinition): JsonObject {
  const fields: JsonObject = {};
  for (const field of type.fields ?? []) fields[field.key] = { kind: field.kind, placeholder: field.placeholder, template: field.template, advanced: field.advanced, hint: field.hint, showIf: field.showIf, options: field.options } as unknown as JsonValue;
  return { fields };
}
