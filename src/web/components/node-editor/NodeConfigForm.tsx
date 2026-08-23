import { useEffect, useRef, useState } from 'preact/hooks';

import type {
  AutomationEvent,
  AutomationEventType,
  AutomationScriptAnalysis,
  AutomationScriptCompletion,
  JsonObject,
  JsonValue,
  NodeDefinition,
  WorkflowNode,
} from '../../../automation/types.ts';
import { FormField } from '../ui/FormField.tsx';
import { TextInput } from '../ui/TextInput.tsx';
import { NumberInput } from '../ui/NumberInput.tsx';
import { Select } from '../ui/Select.tsx';
import { Checkbox } from '../ui/Checkbox.tsx';
import { TemplateField } from './TemplateField.tsx';
import { getTemplateSuggestions, type TemplateSuggestionScope } from './template-suggestions.ts';
import { AutocompletePortal } from './AutocompletePortal.tsx';
import { WORKFLOW_EVENT_CHOICES } from './WorkflowWizardModal.tsx';
import { asNumber, asString } from './graph.ts';
import { t, type Locale } from '../../i18n.ts';

type NodeConfigFormProps = {
  locale: Locale;
  node: WorkflowNode;
  definition?: NodeDefinition;
  analysis?: AutomationScriptAnalysis;
  eventType?: AutomationEventType;
  lastEvent?: AutomationEvent;
  onChange: (config: JsonObject) => void;
  onAnalyzeScript: (nodeId: string, source: string, offset: number, eventType?: AutomationEventType) => void;
};

export function NodeConfigForm({ locale, node, definition, analysis, eventType, lastEvent, onChange, onAnalyzeScript }: NodeConfigFormProps) {
  const ui = formLabels(locale);
  const update = (key: string, value: JsonValue): void => onChange({ ...node.config, [key]: value });
  const config = node.config;
  const templateValues = (scope: TemplateSuggestionScope = 'message') => getTemplateSuggestions(eventType, locale, lastEvent, scope);

  if (!definition) {
    return <GenericConfigForm locale={locale} node={node} onChange={onChange} />;
  }

  switch (node.type) {
    case 'trigger.event':
      return (
        <div className="node-editor-form-stack">
          <FormField label={ui.eventType} hint={ui.eventTypeHint}>
            <Select
              value={asString(config.eventType, 'tiktok.chat')}
              options={WORKFLOW_EVENT_CHOICES.map((choice) => ({ value: choice.value, label: locale === 'es' ? choice.es : choice.en }))}
              onValueChange={(value) => update('eventType', value)}
            />
          </FormField>
        </div>
      );
    case 'condition.compare':
      return (
        <div className="node-editor-form-stack">
          <FormField label={ui.valuePath} hint={ui.valuePathHint}>
            <TemplateField
              value={asString(config.leftPath)}
              onValueChange={(value) => update('leftPath', value)}
              suggestions={templateValues('compare')}
              suggestionMode="path"
              placeholder="event.data.diamondCount"
            />
          </FormField>
          <FormField label={ui.operator}>
            <Select
              value={asString(config.operator, 'equals')}
              options={[
                ['equals', ui.equals],
                ['not-equals', ui.notEquals],
                ['greater-than', ui.greaterThan],
                ['greater-or-equal', ui.greaterOrEqual],
                ['less-than', ui.lessThan],
                ['less-or-equal', ui.lessOrEqual],
                ['contains', ui.contains],
                ['starts-with', ui.startsWith],
                ['truthy', ui.truthy],
                ['falsy', ui.falsy],
              ].map(([value, label]) => ({ value: value ?? '', label: label ?? '' }))}
              onValueChange={(value) => update('operator', value)}
            />
          </FormField>
          <FormField label={ui.compareWith} hint={ui.compareWithHint}>
            <TextInput value={formatValue(config.right)} onValueChange={(value) => update('right', parseValue(value))} placeholder="100" />
          </FormField>
        </div>
      );
    case 'transform.template':
      return (
        <div className="node-editor-form-stack">
          <FormField label={ui.template} hint={ui.templateHint}>
            <TemplateField value={asString(config.template)} onValueChange={(value) => update('template', value)} suggestions={templateValues('message')} multiline rows={5} />
          </FormField>
        </div>
      );
    case 'transform.script':
      return <ScriptConfigForm locale={locale} node={node} analysis={analysis} eventType={eventType} lastEvent={lastEvent} onChange={onChange} onAnalyzeScript={onAnalyzeScript} />;
    case 'control.delay':
      return (
        <div className="node-editor-form-stack">
          <FormField label={ui.delay} hint={ui.delayHint}>
            <NumberInput value={asNumber(config.delayMs)} min={0} max={3_600_000} step={100} suffix="ms" onValueChange={(value) => update('delayMs', value)} />
          </FormField>
        </div>
      );
    case 'control.cooldown':
      return (
        <div className="node-editor-form-stack">
          <FormField label={ui.duration} hint={ui.cooldownHint}>
            <NumberInput value={asNumber(config.durationMs)} min={0} max={86_400_000} step={100} suffix="ms" onValueChange={(value) => update('durationMs', value)} />
          </FormField>
          <FormField label={ui.cooldownKey}>
            <TemplateField value={asString(config.key)} onValueChange={(value) => update('key', value)} suggestions={templateValues('identity')} placeholder="{{ event.user.uniqueId }}" />
          </FormField>
        </div>
      );
    case 'action.log':
      return (
        <div className="node-editor-form-stack">
        <FormField label={ui.message} hint={ui.templateHint}>
            <TemplateField value={asString(config.message)} onValueChange={(value) => update('message', value)} suggestions={templateValues('message')} multiline rows={5} />
          </FormField>
        </div>
      );
    case 'action.http':
      return <HttpConfigForm locale={locale} eventType={eventType} lastEvent={lastEvent} config={config} onChange={update} />;
    case 'action.play-sound':
      return (
        <div className="node-editor-form-stack">
          <FormField label={ui.filePath} hint={ui.filePathHint}>
            <TemplateField value={asString(config.filePath)} onValueChange={(value) => update('filePath', value)} suggestions={templateValues('sound-file')} placeholder="assets/sounds/alert.wav" />
          </FormField>
          <FormField label={ui.volume}>
            <NumberInput value={asNumber(config.volume, 1)} min={0} max={1} step={0.05} onValueChange={(value) => update('volume', value)} />
          </FormField>
          <FormField label={ui.overlap}>
            <Select value={asString(config.overlap, 'allow')} options={[{ value: 'allow', label: ui.allowOverlap }, { value: 'restart', label: ui.restartOverlap }, { value: 'drop', label: ui.dropOverlap }]} onValueChange={(value) => update('overlap', value)} />
          </FormField>
        </div>
      );
    case 'action.tts':
      return (
        <div className="node-editor-form-stack">
          <FormField label={ui.text} hint={ui.templateHint}>
            <TemplateField value={asString(config.text)} onValueChange={(value) => update('text', value)} suggestions={templateValues('text')} multiline rows={5} />
          </FormField>
          <FormField label={ui.voice}>
            <TextInput value={asString(config.voice, 'M1')} onValueChange={(value) => update('voice', value)} placeholder="M1" />
          </FormField>
          <FormField label={ui.language}>
            <Select value={asString(config.lang, 'en')} options={[{ value: 'en', label: 'English' }, { value: 'es', label: 'Español' }]} onValueChange={(value) => update('lang', value)} />
          </FormField>
          <FormField label={ui.audioFormat}>
            <Select value={asString(config.format, 'wav')} options={[{ value: 'wav', label: 'WAV' }, { value: 'ogg', label: 'OGG' }]} onValueChange={(value) => update('format', value)} />
          </FormField>
        </div>
      );
    case 'action.adjust-points':
      return (
        <div className="node-editor-form-stack">
          <FormField label={ui.viewer} hint={ui.viewerHint}>
            <TemplateField value={asString(config.uniqueId)} onValueChange={(value) => update('uniqueId', value)} suggestions={templateValues('identity')} placeholder="{{ event.user.uniqueId }}" />
          </FormField>
          <FormField label={ui.delta}>
            <NumberInput value={asNumber(config.delta, 10)} step={1} onValueChange={(value) => update('delta', value)} />
          </FormField>
        </div>
      );
    default:
      return <GenericConfigForm locale={locale} node={node} definition={definition} onChange={onChange} />;
  }
}

function ScriptConfigForm({ locale, node, analysis, eventType, lastEvent, onChange, onAnalyzeScript }: NodeConfigFormProps) {
  const source = asString(node.config.source);
  const [cursor, setCursor] = useState(source.length);
  const [completionIndex, setCompletionIndex] = useState(0);
  const [completionOpen, setCompletionOpen] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const completionAnchorRef = useRef<HTMLDivElement | null>(null);
  const completionKey = analysis?.completions.map((completion) => `${completion.label}:${completion.detail ?? ''}`).join('|') ?? '';
  const visibleCompletions = analysis?.completions.slice(0, 12) ?? [];

  useEffect(() => setCursor(source.length), [node.id, source]);
  useEffect(() => {
    setCompletionIndex(0);
    setCompletionOpen(visibleCompletions.length > 0);
  }, [completionKey]);

  const change = (nextSource: string, nextCursor: number): void => {
    setCursor(nextCursor);
    onChange({ ...node.config, source: nextSource });
    onAnalyzeScript(node.id, nextSource, nextCursor, eventType);
  };

  const applyCompletion = (completion: AutomationScriptCompletion): void => {
    const textarea = textareaRef.current;
    const offset = textarea?.selectionStart ?? cursor;
    const before = source.slice(0, offset);
    const match = before.match(/[A-Za-z0-9_$]*$/);
    const start = offset - (match?.[0]?.length ?? 0);
    const nextSource = `${source.slice(0, start)}${completion.label}${source.slice(offset)}`;
    const nextOffset = start + completion.label.length;
    change(nextSource, nextOffset);
    setCompletionOpen(false);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextOffset, nextOffset);
    });
  };

  const handleCompletionKeyDown = (event: KeyboardEvent): void => {
    const completions = visibleCompletions;
    if (!completionOpen || completions.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCompletionIndex((current) => (current + 1) % completions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCompletionIndex((current) => (current - 1 + completions.length) % completions.length);
    } else if (event.key === 'Tab' || event.key === 'Enter') {
      event.preventDefault();
      const selected = completions[completionIndex];
      if (selected) applyCompletion(selected);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setCompletionOpen(false);
    }
  };

  return (
    <div className="node-editor-form-stack">
      <div className="node-editor-script-context">
        <span>{t(locale, 'scriptEditor')}</span>
        <small>{lastEvent ? `${t(locale, 'lastEventContext')}: ${lastEvent.type}` : t(locale, 'noLastEventContext')}</small>
      </div>
      <FormField label={t(locale, 'scriptEditor')} hint={t(locale, 'scriptEditorHint')}>
        <div ref={completionAnchorRef} className="node-editor-script-editor">
          <textarea
            ref={textareaRef}
            className="node-editor-form-textarea node-editor-form-textarea--code"
            value={source}
            rows={12}
            spellcheck={false}
            onFocus={() => setCompletionOpen(true)}
            onKeyDown={handleCompletionKeyDown}
            onInput={(event) => {
              const target = event.currentTarget;
              change(target.value, target.selectionStart ?? target.value.length);
            }}
            onKeyUp={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Tab' || event.key === 'Enter' || event.key === 'Escape') return;
              setCursor(event.currentTarget.selectionStart ?? source.length);
              onAnalyzeScript(node.id, source, event.currentTarget.selectionStart ?? source.length, eventType);
            }}
            onClick={(event) => {
              setCursor(event.currentTarget.selectionStart ?? source.length);
              onAnalyzeScript(node.id, source, event.currentTarget.selectionStart ?? source.length, eventType);
            }}
          />
          <AutocompletePortal anchorRef={completionAnchorRef} cursorRef={textareaRef} cursorOffset={cursor} open={completionOpen && visibleCompletions.length > 0}>
            <div className="node-editor-code-completions" role="listbox">
              {visibleCompletions.map((completion, index) => (
                <button
                  key={`${completion.kind}:${completion.label}`}
                  type="button"
                  role="option"
                  aria-selected={index === completionIndex}
                  className={index === completionIndex ? 'is-selected' : ''}
                  title={completion.documentation ?? completion.detail ?? completion.label}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setCompletionIndex(index)}
                  onClick={() => applyCompletion(completion)}
                >
                  <strong>{completion.label}</strong>
                  <span>{completion.detail ?? completion.kind}</span>
                  {completion.valueSource === 'live-event' && completion.value !== undefined ? <code>{formatEditorValue(completion.value)}</code> : null}
                </button>
              ))}
              <small>↑ ↓ {locale === 'es' ? 'navegar' : 'navigate'} · Tab {locale === 'es' ? 'insertar' : 'insert'}</small>
            </div>
          </AutocompletePortal>
        </div>
      </FormField>
      {analysis?.diagnostics.length ? (
        <div className="node-editor-diagnostics" role="status">
          {analysis.diagnostics.map((diagnostic, index) => <div key={`${diagnostic.line}:${diagnostic.column}:${index}`} className="node-editor-diagnostic"><span>{diagnostic.line}:{diagnostic.column}</span> {diagnostic.message}</div>)}
        </div>
      ) : null}
      {analysis?.hover ? (
        <div className="node-editor-hover-card" role="status">
          <strong>{analysis.hover.detail}</strong>
          <span>{analysis.hover.documentation}</span>
          {analysis.hover.valueSource === 'live-event' && analysis.hover.value !== undefined
            ? analysis.hover.path === 'event.data'
              ? <pre>{formatEditorValue(analysis.hover.value, true)}</pre>
              : <code>{formatEditorValue(analysis.hover.value)}</code>
            : null}
        </div>
      ) : null}
    </div>
  );
}

function HttpConfigForm({ locale, eventType, lastEvent, config, onChange }: { locale: Locale; eventType?: AutomationEventType; lastEvent?: AutomationEvent; config: JsonObject; onChange: (key: string, value: JsonValue) => void }) {
  const ui = formLabels(locale);
  const templateValues = (scope: TemplateSuggestionScope) => getTemplateSuggestions(eventType, locale, lastEvent, scope);
  return (
    <div className="node-editor-form-stack">
      <FormField label={ui.method}>
        <Select value={asString(config.method, 'GET')} options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((value) => ({ value, label: value }))} onValueChange={(value) => onChange('method', value)} />
      </FormField>
      <FormField label={ui.url} hint={ui.templateHint}>
        <TemplateField value={asString(config.url)} onValueChange={(value) => onChange('url', value)} suggestions={templateValues('http-url')} placeholder="https://api.example.com/..." />
      </FormField>
      <FormField label={ui.requestBody}>
        <TemplateField value={asString(config.body)} onValueChange={(value) => onChange('body', value)} suggestions={templateValues('http-data')} multiline rows={4} placeholder="Optional request body" />
      </FormField>
      <FormField label={ui.headers} hint={ui.headersHint}>
        <TemplateField value={headersToText(config.headers)} onValueChange={(value) => onChange('headers', parseHeaders(value))} suggestions={templateValues('http-data')} multiline rows={4} placeholder="Authorization: Bearer {{ event.data.token }}" />
      </FormField>
      <FormField label={ui.timeout}>
        <NumberInput value={asNumber(config.timeoutMs, 10000)} min={100} max={120000} step={100} suffix="ms" onValueChange={(value) => onChange('timeoutMs', value)} />
      </FormField>
      <FormField label={ui.responseType}>
        <Select value={asString(config.responseType, 'auto')} options={[{ value: 'auto', label: 'Auto' }, { value: 'json', label: 'JSON' }, { value: 'text', label: 'Text' }, { value: 'bytes', label: 'Bytes' }]} onValueChange={(value) => onChange('responseType', value)} />
      </FormField>
      <FormField label={ui.redirect}>
        <Select value={asString(config.redirect, 'error')} options={[{ value: 'error', label: ui.blockRedirects }, { value: 'follow', label: ui.followRedirects }]} onValueChange={(value) => onChange('redirect', value)} />
      </FormField>
      <Checkbox checked={config.allowPrivateNetwork === true} onCheckedChange={(value) => onChange('allowPrivateNetwork', value)} label={ui.allowPrivateNetwork} />
    </div>
  );
}

function GenericConfigForm({ locale, node, definition, onChange }: { locale: Locale; node: WorkflowNode; definition?: NodeDefinition; onChange: (config: JsonObject) => void }) {
  const ui = formLabels(locale);
  const schemaProperties = definition && isJsonObject(definition.configSchema.properties) ? definition.configSchema.properties : {};
  const keys = [...new Set([...Object.keys(schemaProperties), ...Object.keys(node.config)])];
  if (keys.length === 0) return <p className="node-editor-form-empty">{ui.noForm}</p>;
  return (
    <div className="node-editor-form-stack">
      {keys.map((key) => {
        const schema = isJsonObject(schemaProperties[key]) ? schemaProperties[key] : {};
        const type = asString(schema.type, 'string');
        const value = node.config[key] ?? schema.default;
        if (type === 'boolean') {
          return <Checkbox key={key} checked={value === true} onCheckedChange={(next) => onChange({ ...node.config, [key]: next })} label={key} />;
        }
        if (type === 'number' || type === 'integer') {
          return <FormField key={key} label={key}><NumberInput value={asNumber(value)} onValueChange={(next) => onChange({ ...node.config, [key]: next })} /></FormField>;
        }
        if (Array.isArray(schema.enum)) {
          const options = schema.enum.filter((option): option is string => typeof option === 'string').map((option) => ({ value: option, label: option }));
          if (options.length > 0) return <FormField key={key} label={key}><Select value={asString(value, options[0]?.value)} options={options} onValueChange={(next) => onChange({ ...node.config, [key]: next })} /></FormField>;
        }
        return <FormField key={key} label={key}><TextInput value={asString(value)} onValueChange={(next) => onChange({ ...node.config, [key]: next })} /></FormField>;
      })}
    </div>
  );
}

function formatValue(value: JsonValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return '';
  return String(value);
}

function formatEditorValue(value: JsonValue, pretty = false): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    const serialized = JSON.stringify(value, pretty ? null : undefined, pretty ? 2 : undefined) ?? String(value);
    if (pretty) return serialized.length > 8_000 ? `${serialized.slice(0, 7_997)}...` : serialized;
    return serialized.length > 140 ? `${serialized.slice(0, 137)}...` : serialized;
  } catch {
    return String(value);
  }
}

function parseValue(value: string): JsonValue {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  const number = Number(trimmed);
  return Number.isFinite(number) && trimmed !== '' ? number : value;
}

function headersToText(value: JsonValue | undefined): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  return Object.entries(value).map(([key, raw]) => `${key}: ${typeof raw === 'string' ? raw : String(raw ?? '')}`).join('\n');
}

function parseHeaders(value: string): JsonObject {
  const headers: JsonObject = {};
  for (const line of value.split('\n')) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    if (key) headers[key] = line.slice(separator + 1).trim();
  }
  return headers;
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function formLabels(locale: Locale) {
  if (locale === 'es') {
    return {
      eventType: 'Evento que activa el flujo', eventTypeHint: 'El flujo comenzará cuando ocurra este evento.', valuePath: 'Valor del evento', valuePathHint: 'Ejemplo: event.data.diamondCount', operator: 'Operador', equals: 'Es igual a', notEquals: 'No es igual a', greaterThan: 'Es mayor que', greaterOrEqual: 'Es mayor o igual que', lessThan: 'Es menor que', lessOrEqual: 'Es menor o igual que', contains: 'Contiene', startsWith: 'Comienza con', truthy: 'Es verdadero', falsy: 'Es falso', compareWith: 'Comparar con', compareWithHint: 'Los números se guardan como números automáticamente.', template: 'Texto o plantilla', templateHint: 'Puedes usar valores como {{ event.user.uniqueId }}.', delay: 'Esperar', delayHint: 'Tiempo que se espera antes del siguiente paso.', duration: 'Duración', cooldownHint: 'El mismo usuario no podrá repetir el flujo durante este tiempo.', cooldownKey: 'Clave del cooldown', message: 'Mensaje', filePath: 'Archivo de sonido', filePathHint: 'Ruta local del archivo de audio.', volume: 'Volumen', overlap: 'Si ya está sonando', allowOverlap: 'Permitir mezcla', restartOverlap: 'Reiniciar sonido', dropOverlap: 'Ignorar nuevo sonido', text: 'Texto', voice: 'Voz', language: 'Idioma', audioFormat: 'Formato de audio', viewer: 'Usuario', viewerHint: 'Usa {{ event.user.uniqueId }} para el usuario del evento.', delta: 'Puntos a ajustar', method: 'Método', url: 'URL', requestBody: 'Cuerpo de la petición', headers: 'Cabeceras', headersHint: 'Una cabecera por línea: Nombre: valor', timeout: 'Tiempo máximo', responseType: 'Respuesta', redirect: 'Redirecciones', blockRedirects: 'Bloquear redirecciones', followRedirects: 'Seguir redirecciones', allowPrivateNetwork: 'Permitir red local', noForm: 'Este nodo no tiene opciones configurables.',
    };
  }
  return {
    eventType: 'Trigger event', eventTypeHint: 'The workflow starts when this event occurs.', valuePath: 'Event value', valuePathHint: 'Example: event.data.diamondCount', operator: 'Operator', equals: 'Equals', notEquals: 'Does not equal', greaterThan: 'Greater than', greaterOrEqual: 'Greater than or equal', lessThan: 'Less than', lessOrEqual: 'Less than or equal', contains: 'Contains', startsWith: 'Starts with', truthy: 'Is true', falsy: 'Is false', compareWith: 'Compare with', compareWithHint: 'Numbers are stored as numbers automatically.', template: 'Text or template', templateHint: 'You can use values such as {{ event.user.uniqueId }}.', delay: 'Wait', delayHint: 'Time to wait before the next step.', duration: 'Duration', cooldownHint: 'The same user cannot repeat the flow during this time.', cooldownKey: 'Cooldown key', message: 'Message', filePath: 'Sound file', filePathHint: 'Local audio file path.', volume: 'Volume', overlap: 'If already playing', allowOverlap: 'Allow overlap', restartOverlap: 'Restart sound', dropOverlap: 'Drop new sound', text: 'Text', voice: 'Voice', language: 'Language', audioFormat: 'Audio format', viewer: 'Viewer', viewerHint: 'Use {{ event.user.uniqueId }} for the event viewer.', delta: 'Points delta', method: 'Method', url: 'URL', requestBody: 'Request body', headers: 'Headers', headersHint: 'One header per line: Name: value', timeout: 'Timeout', responseType: 'Response', redirect: 'Redirects', blockRedirects: 'Block redirects', followRedirects: 'Follow redirects', allowPrivateNetwork: 'Allow local network', noForm: 'This node has no configurable options.',
  };
}
