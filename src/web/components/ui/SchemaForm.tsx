import { useMemo } from 'preact/hooks';

import type { AutomationEvent, AutomationEventType, JsonObject, JsonValue } from '../../../automation/types.ts';
import type { ActionTypeDefinition, Localized } from '../../../automation/behavior/types.ts';
import { TemplateField } from '../node-editor/TemplateField.tsx';
import { getTemplateSuggestions, type TemplateSuggestion, type TemplateSuggestionScope } from '../node-editor/template-suggestions.ts';
import type { AutocompleteItem } from '../autocomplete/autocomplete.ts';
import { mergeSuggestions, suggestionsFromObject } from '../autocomplete/autocomplete.ts';
import { FieldLabel, TemplateTokensLine } from './FieldLabel.tsx';
import { AdvancedSection } from './FieldPanels.tsx';
import { InfoTip } from './InfoTip.tsx';
import { i18nText, t, type Locale } from '../../i18n.ts';

export type FieldOption = { value: string; label: string };

export type SchemaFormProps = {
  locale: Locale;
  schema: JsonObject;
  uiHints?: JsonObject;
  value: JsonObject;
  onChange: (value: JsonObject) => void;
  /** Legacy: a ready-made list. New code can use suggestionContext/scopes. */
  templateSuggestions?: TemplateSuggestion[];
  /** Any object pushed as autocomplete (live event, custom schema sample…). */
  suggestionContext?: JsonValue | AutomationEvent;
  /** Per-field scopes, e.g. `{ url: 'http-url', body: 'http-data' }`. */
  suggestionScopes?: Partial<Record<string, TemplateSuggestionScope>>;
  /** Trigger used to pick trigger-specific paths when no explicit list given. */
  eventType?: AutomationEventType;
  lastEvent?: AutomationEvent;
  /** Dynamic per-field options fetched on demand (voices, devices, …). */
  fieldOptions?: Record<string, FieldOption[]>;
};

/** Default scope per field name so Call-URL-like forms work with zero config. */
function defaultScopeFor(name: string, template: boolean): TemplateSuggestionScope {
  const key = name.toLowerCase();
  if (key.includes('url') || key.includes('link') || key.includes('endpoint') || key.includes('webhook')) return 'http-url';
  if (key.includes('uniqueid') || key.includes('viewer') || key.includes('user') || key === 'key' || key === 'type') return 'identity';
  if (key.includes('file') || key.includes('sound') || key.includes('audio') || key.includes('path')) return 'sound-file';
  if (key.includes('comment') || key.includes('message') || key.includes('text')) return 'text';
  if (key.includes('leftpath') || key.includes('path')) return 'compare';
  return template ? 'http-data' : 'message';
}

/**
 * Small, deliberately bounded JSON Schema renderer. It renders data, never
 * code: plugin packages can describe forms but cannot inject DOM or Preact.
 *
 * Every field gets a tooltip (InfoTip) when it has a hint, a `{{ }}` badge
 * when it is templated, and autocomplete when it can use `{{ event.* }}` —
 * from the trigger scope plus any object pushed via `suggestionContext`.
 */
export function SchemaForm({
  locale,
  schema,
  uiHints,
  value,
  onChange,
  templateSuggestions = [],
  suggestionContext,
  suggestionScopes = {},
  eventType,
  lastEvent,
  fieldOptions = {},
}: SchemaFormProps) {
  const properties = useMemo(() => objectProperties(schema.properties), [schema]);
  const hints = objectProperties(uiHints?.fields);
  const visible = Object.entries(properties).filter(([key]) => applies(hints[key]?.showIf, value));
  const basic = visible.filter(([key]) => hints[key]?.advanced !== true);
  const advanced = visible.filter(([key]) => hints[key]?.advanced === true);
  const update = (key: string, next: JsonValue): void => onChange({ ...value, [key]: next });

  const contextItems = useMemo<AutocompleteItem[]>(() => {
    if (suggestionContext === undefined) return [];
    const root = suggestionContext as JsonValue;
    // `AutomationEvent` arrives as `{ type, user, data… }` — expose as `event.*`.
    if (root !== null && typeof root === 'object' && !Array.isArray(root) && 'type' in (root as JsonObject) && !('event' in (root as JsonObject))) {
      return suggestionsFromObject({ event: root } as unknown as JsonValue, '', { maxItems: 80 });
    }
    return suggestionsFromObject(root, '', { maxItems: 80 });
  }, [suggestionContext]);

  const suggestionsFor = (name: string, template: boolean): TemplateSuggestion[] => {
    const scope = suggestionScopes[name] ?? defaultScopeFor(name, template);
    const scoped = getTemplateSuggestions(eventType, locale, lastEvent, scope, undefined);
    const merged = mergeSuggestions(scoped, contextItems, templateSuggestions);
    return merged as TemplateSuggestion[];
  };

  return (
    <div className="plg-form__schema">
      {basic.map(([key, field]) => (
        <SchemaField
          key={key}
          locale={locale}
          name={key}
          schema={field}
          hint={hints[key]}
          value={value[key]}
          onChange={(next) => update(key, next)}
          templateSuggestions={suggestionsFor(key, (hints[key]?.template as boolean) === true)}
          fieldOptions={fieldOptions[key]}
        />
      ))}
      {advanced.length > 0 && (
        <AdvancedSection
          title={t(locale, 'advancedOptions')}
          hint={locale === 'es'
            ? 'Headers, timeout, evento de respuesta y red local. No hace falta tocarlo para un webhook normal.'
            : 'Headers, timeout, response event and local network. Not needed for a plain webhook.'}
          count={advanced.length}
        >
          {advanced.map(([key, field]) => (
            <SchemaField
              key={key}
              locale={locale}
              name={key}
              schema={field}
              hint={hints[key]}
              value={value[key]}
              onChange={(next) => update(key, next)}
              templateSuggestions={suggestionsFor(key, (hints[key]?.template as boolean) === true)}
              fieldOptions={fieldOptions[key]}
            />
          ))}
        </AdvancedSection>
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

function SchemaField({ locale, name, schema, hint, value, onChange, templateSuggestions, fieldOptions }: {
  locale: Locale;
  name: string;
  schema: JsonObject;
  hint?: JsonObject;
  value: JsonValue | undefined;
  onChange: (value: JsonValue) => void;
  templateSuggestions: TemplateSuggestion[];
  fieldOptions?: FieldOption[];
}) {
  const label = localized(schema.title, locale) || name;
  const description = typeof schema.description === 'string' ? schema.description : localized(schema.description as JsonValue, locale);
  const hintText = localized(hint?.hint, locale) || description;
  const placeholder = typeof hint?.placeholder === 'string' ? hint.placeholder : typeof schema.example === 'string' ? schema.example : undefined;
  const kind = typeof hint?.kind === 'string' ? hint.kind : schema.format === 'code' ? 'code' : schema.type;
  const template = hint?.template === true;
  const displayValue = toDisplayValue(value, schema.type);
  const hasAutocomplete = template || templateSuggestions.length > 0;

  if (kind === 'boolean' || schema.type === 'boolean') {
    const checked = value === true || value === 'true';
    return (
      <div className="plg-field">
        <div className="plg-switch-row">
          <button
            type="button"
            className={`plg-switch${checked ? ' is-on' : ''}`}
            aria-label={label}
            data-tooltip={hintText || undefined}
            data-tooltip-pos="right"
            data-tooltip-wide={hintText ? '' : undefined}
            onClick={() => onChange(!checked)}
          >
            <span className="plg-switch__track"><span className="plg-switch__thumb" /></span>
          </button>
          <label className="plg-label" onClick={() => onChange(!checked)}>{label}</label>
          {hintText ? <InfoTip text={hintText} position="right" /> : null}
        </div>
        {hintText ? <span className="plg-field-hint">{hintText}</span> : null}
      </div>
    );
  }

  if (kind === 'keyvalue' || (schema.type === 'object' && schema.additionalProperties !== undefined)) {
    return (
      <KeyValueEditor
        locale={locale}
        label={label}
        hintText={hintText}
        placeholder={placeholder}
        entries={value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}}
        suggestions={templateSuggestions}
        onChange={onChange}
      />
    );
  }

  const schemaOptions = Array.isArray(schema.enum) ? schema.enum.filter((entry): entry is string => typeof entry === 'string').map((value) => ({ value, label: value })) : [];
  const hintedOptions = Array.isArray(hint?.options)
    ? hint.options.filter((entry): entry is JsonObject => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry)).map((entry) => ({
      value: typeof entry.value === 'string' ? entry.value : '',
      label: localized(entry.label, locale) || (typeof entry.value === 'string' ? entry.value : ''),
      hint: localized((entry as JsonObject).hint, locale) || undefined,
    }))
    : [];
  const dynamicOptions = Array.isArray(fieldOptions) ? fieldOptions.filter((entry) => entry && typeof entry.value === 'string') : [];
  const options = schemaOptions.length > 0 ? schemaOptions : dynamicOptions.length > 0 ? dynamicOptions : hintedOptions;
  if (options.length > 0) {
    return (
      <SelectField
        label={label}
        hintText={hintText}
        template={template}
        value={displayValue}
        options={options as Array<{ value: string; label: string; hint?: string }>}
        onChange={onChange}
      />
    );
  }

  if (kind === 'textarea' || kind === 'code' || schema.type === 'array' || schema.format === 'json') {
    // Templated textareas (Body…) get full autocomplete + highlight + hover type.
    if (hasAutocomplete && schema.type !== 'array' && kind !== 'code') {
      return (
        <div className="plg-field">
          <FieldLabel label={label} hint={hintText} example={placeholder} template={template} />
          {hintText ? <span className="plg-field-hint">{hintText}</span> : null}
          <TemplateField
            value={schema.format === 'json' && typeof value === 'string' ? value : displayValue}
            onValueChange={onChange}
            suggestions={templateSuggestions}
            multiline
            rows={6}
            ariaLabel={label}
            placeholder={placeholder}
          />
          {template ? <TemplateTokensLine value={displayValue} /> : null}
        </div>
      );
    }
    const text = schema.type === 'array' ? formatJson(value) : schema.format === 'json' && typeof value === 'string' ? value : displayValue;
    return (
      <div className="plg-field">
        <FieldLabel label={label} hint={hintText} example={placeholder} template={template} />
        {hintText ? <span className="plg-field-hint">{hintText}</span> : null}
        <textarea
          className={`plg-textarea${kind === 'code' ? ' plg-textarea--code' : ''}`}
          rows={kind === 'code' ? 16 : 6}
          spellcheck={false}
          value={text}
          placeholder={placeholder}
          aria-label={label}
          data-tooltip={hintText || undefined}
          onInput={(event) => {
            const next = event.currentTarget.value;
            if (schema.type === 'array') {
              try { onChange(JSON.parse(next) as JsonValue); } catch { onChange(next); }
            } else onChange(next);
          }}
        />
        {template ? <TemplateTokensLine value={displayValue} /> : null}
      </div>
    );
  }

  if (kind === 'number' || schema.type === 'number' || schema.type === 'integer') {
    return (
      <div className="plg-field">
        <FieldLabel label={label} hint={hintText} example={placeholder} />
        <input
          className="plg-input plg-input--mono"
          type="number"
          value={displayValue}
          placeholder={placeholder}
          aria-label={label}
          data-tooltip={hintText || undefined}
          data-tooltip-pos="right"
          data-tooltip-wide={hintText ? '' : undefined}
          onInput={(event) => {
            const next = event.currentTarget.value;
            onChange(next === '' ? '' : Number(next));
          }}
        />
        {hintText ? <span className="plg-field-hint">{hintText}</span> : null}
      </div>
    );
  }

  // Text: templated (or with pushed suggestions) → autocomplete input.
  if (hasAutocomplete) {
    return (
      <div className="plg-field">
        <FieldLabel label={label} hint={hintText} example={placeholder} template={template} />
        {hintText ? <span className="plg-field-hint">{hintText}</span> : null}
        <TemplateField
          value={displayValue}
          onValueChange={onChange}
          suggestions={templateSuggestions}
          placeholder={placeholder}
          ariaLabel={label}
        />
        {template ? <TemplateTokensLine value={displayValue} /> : null}
      </div>
    );
  }

  return (
    <div className="plg-field">
      <FieldLabel label={label} hint={hintText} example={placeholder} />
      <input
        className="plg-input"
        type="text"
        value={displayValue}
        placeholder={placeholder}
        aria-label={label}
        data-tooltip={hintText || undefined}
        data-tooltip-pos="right"
        data-tooltip-wide={hintText ? '' : undefined}
        onInput={(event) => onChange(event.currentTarget.value)}
      />
      {hintText ? <span className="plg-field-hint">{hintText}</span> : null}
    </div>
  );
}

/** Select with tooltips on the label and on every option (`title`). */
function SelectField({
  label,
  hintText,
  template,
  value,
  options,
  onChange,
}: {
  label: string;
  hintText: string;
  template?: boolean;
  value: string;
  options: Array<{ value: string; label: string; hint?: string }>;
  onChange: (value: JsonValue) => void;
}) {
  return (
    <div className="plg-field">
      <FieldLabel label={label} hint={hintText} template={template} />
      {hintText ? <span className="plg-field-hint">{hintText}</span> : null}
      <select
        className="plg-select"
        value={value}
        aria-label={label}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} title={option.hint ?? option.label}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Headers-style editor: keys are plain, values get template autocomplete. */
function KeyValueEditor({
  locale,
  label,
  hintText,
  placeholder,
  entries,
  suggestions,
  onChange,
}: {
  locale: Locale;
  label: string;
  hintText: string;
  placeholder?: string;
  entries: JsonObject;
  suggestions: TemplateSuggestion[];
  onChange: (value: JsonValue) => void;
}) {
  const removeLabel = locale === 'es' ? 'Quitar cabecera' : 'Remove header';
  const keyLabel = locale === 'es' ? 'Nombre de la cabecera' : 'Header name';
  const valueLabel = locale === 'es' ? 'Valor (acepta {{ }})' : 'Value (supports {{ }})';
  return (
    <div className="plg-field">
      <FieldLabel
        label={label}
        hint={hintText || (locale === 'es' ? 'Una por línea conceptual: nombre y valor. El valor acepta {{ }}.' : 'One header per row: name and value. Values accept {{ }}.')}
        template
      />
      {hintText ? <span className="plg-field-hint">{hintText}</span> : null}
      {Object.entries(entries).map(([key, entry]) => (
        <div className="plg-kv-row" key={key}>
          <input
            className="plg-input plg-input--mono plg-input--key"
            value={key}
            aria-label={keyLabel}
            data-tooltip={keyLabel}
            data-tooltip-pos="right"
            placeholder="content-type"
            onInput={(event) => {
              const next: JsonObject = {};
              for (const [currentKey, currentValue] of Object.entries(entries)) next[currentKey === key ? event.currentTarget.value : currentKey] = currentValue;
              onChange(next);
            }}
          />
          <span className="plg-kv-row__value">
            <TemplateField
              value={String(entry ?? '')}
              onValueChange={(next) => onChange({ ...entries, [key]: next })}
              suggestions={suggestions}
              ariaLabel={valueLabel}
              placeholder={placeholder ?? 'application/json'}
            />
          </span>
          <button
            type="button"
            className="plg-btn plg-btn--icon plg-btn--danger"
            aria-label={removeLabel}
            data-tooltip={removeLabel}
            data-tooltip-pos="left"
            onClick={() => {
              const next = { ...entries };
              delete next[key];
              onChange(next);
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="plg-btn plg-btn--sm"
        data-tooltip={locale === 'es' ? 'Añade una cabecera más' : 'Add another header'}
        data-tooltip-pos="bottom"
        onClick={() => onChange({ ...entries, [`field-${Object.keys(entries).length + 1}`]: '' })}
      >
        + {t(locale, 'add')}
      </button>
    </div>
  );
}

function objectProperties(value: JsonValue | undefined): Record<string, JsonObject> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, JsonObject] => Boolean(entry[1]) && typeof entry[1] === 'object' && !Array.isArray(entry[1])));
}

function localized(value: JsonValue | undefined, locale: Locale): string {
  return i18nText(locale, value);
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
