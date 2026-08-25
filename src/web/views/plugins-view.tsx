import { useMemo, useState } from 'preact/hooks';

import { LIVE_PLUGIN_TEMPLATES, createLivePluginFromTemplate, findLivePluginTemplate } from '../../automation/live-plugins/templates.ts';
import type { LivePluginTemplate } from '../../automation/live-plugins/templates.ts';
import {
  LIVE_PLUGIN_TRIGGERS,
  createLivePluginId,
  deriveLivePluginPermissions,
} from '../../automation/live-plugins/schema.ts';
import type {
  LivePlugin,
  LivePluginAction,
  LivePluginCondition,
  LivePluginOperator,
  LivePluginRecord,
  LivePluginRun,
} from '../../automation/live-plugins/types.ts';
import type { AutomationEventType } from '../../automation/types.ts';
import type { Locale } from '../i18n.ts';

type PluginsViewProps = {
  locale: Locale;
  plugins: LivePluginRecord[];
  runs: LivePluginRun[];
  testRun?: LivePluginRun;
  error?: string;
  onSave: (plugin: LivePlugin) => void;
  onDelete: (id: string) => void;
  onSetEnabled: (id: string, enabled: boolean) => void;
  onTest: (plugin: LivePlugin) => void;
};

type Screen =
  | { kind: 'list' }
  | { kind: 'gallery' }
  | { kind: 'editor'; plugin: LivePlugin; isNew: boolean };

type ListFilter = 'all' | 'template' | 'code' | 'errors';

const COPY = {
  es: {
    title: 'Plugins',
    lead: 'Cada plugin escucha un evento y hace una cosa.',
    active: 'activos',
    withErrors: 'con errores',
    newPlugin: 'Nuevo',
    search: 'Buscar por nombre o evento',
    all: 'Todos',
    templates: 'Plantilla',
    code: 'Código',
    errors: 'Errores',
    emptyTitle: 'Todavía no hay plugins',
    emptyDesc: 'Empieza por una plantilla: llamar a una URL, avisar al overlay, sonido, voz o puntos.',
    emptyFilterTitle: 'Nada con este filtro',
    emptyFilterDesc: 'Ningún plugin coincide con la búsqueda o el filtro.',
    clear: 'Limpiar',
    runs: 'Últimas ejecuciones',
    runsEmpty: 'Sin ejecuciones todavía.',
    addTitle: 'Añadir plugin',
    gallery: 'Galería',
    installed: 'Instalados',
    import: 'Importar',
    searchTemplate: 'Buscar plantilla',
    duplicate: 'Duplicar',
    importHint: 'Pega el JSON de un plugin exportado.',
    importAction: 'Importar JSON',
    importError: 'Ese JSON no es un plugin válido.',
    cancel: 'Cancelar',
    continue: 'Continuar',
    save: 'Guardar',
    remove: 'Eliminar',
    back: 'Volver',
    when: 'Cuándo',
    event: 'Evento',
    onlyIf: 'Sólo si',
    optional: '(opcional)',
    cooldown: 'Espera entre disparos',
    cooldownScope: 'Ámbito',
    perUser: 'por usuario',
    global: 'global',
    noCooldown: 'sin espera',
    request: 'Petición',
    url: 'URL',
    body: 'Cuerpo',
    headers: 'Cabeceras',
    options: 'Opciones',
    addHeader: '+ Añadir cabecera',
    addField: '+ Añadir campo',
    timeout: 'Tiempo máximo (ms)',
    localNetwork: 'Permitir red local',
    emitResponse: 'Emitir la respuesta como',
    internalEvent: 'Evento interno',
    data: 'Datos',
    file: 'Archivo',
    volume: 'Volumen',
    text: 'Texto',
    voice: 'Voz',
    lang: 'Idioma',
    viewer: 'Espectador',
    delta: 'Puntos',
    script: 'Código',
    scriptHint: 'Devuelve { emit, fetch, emitResponseAs, log }. Sin require, fs, process ni módulos nativos.',
    permissions: 'Permisos',
    permissionsHint: 'Se generan desde el plugin. El motor rechaza cualquier destino fuera de esta lista.',
    none: 'ninguno',
    test: 'Probar con el último evento',
    console: 'Consola',
    consoleEmpty: 'Esperando una ejecución…',
    name: 'Nombre',
    paused: 'Pausado',
    noRuns: 'Sin ejecuciones',
    confirmDelete: '¿Eliminar este plugin?',
  },
  en: {
    title: 'Plugins',
    lead: 'Each plugin listens to one event and does one thing.',
    active: 'active',
    withErrors: 'failing',
    newPlugin: 'New',
    search: 'Search by name or event',
    all: 'All',
    templates: 'Template',
    code: 'Code',
    errors: 'Errors',
    emptyTitle: 'No plugins yet',
    emptyDesc: 'Start from a template: call a URL, notify the overlay, sound, voice, or points.',
    emptyFilterTitle: 'Nothing here',
    emptyFilterDesc: 'No plugin matches the search or the filter.',
    clear: 'Clear',
    runs: 'Recent runs',
    runsEmpty: 'No runs yet.',
    addTitle: 'Add plugin',
    gallery: 'Gallery',
    installed: 'Installed',
    import: 'Import',
    searchTemplate: 'Search template',
    duplicate: 'Duplicate',
    importHint: 'Paste the JSON of an exported plugin.',
    importAction: 'Import JSON',
    importError: 'That JSON is not a valid plugin.',
    cancel: 'Cancel',
    continue: 'Continue',
    save: 'Save',
    remove: 'Delete',
    back: 'Back',
    when: 'When',
    event: 'Event',
    onlyIf: 'Only if',
    optional: '(optional)',
    cooldown: 'Cooldown',
    cooldownScope: 'Scope',
    perUser: 'per viewer',
    global: 'global',
    noCooldown: 'no cooldown',
    request: 'Request',
    url: 'URL',
    body: 'Body',
    headers: 'Headers',
    options: 'Options',
    addHeader: '+ Add header',
    addField: '+ Add field',
    timeout: 'Timeout (ms)',
    localNetwork: 'Allow local network',
    emitResponse: 'Emit the response as',
    internalEvent: 'Internal event',
    data: 'Data',
    file: 'File',
    volume: 'Volume',
    text: 'Text',
    voice: 'Voice',
    lang: 'Language',
    viewer: 'Viewer',
    delta: 'Points',
    script: 'Code',
    scriptHint: 'Return { emit, fetch, emitResponseAs, log }. No require, fs, process, or native modules.',
    permissions: 'Permissions',
    permissionsHint: 'Derived from the plugin. The engine refuses any destination outside this list.',
    none: 'none',
    test: 'Run with the last event',
    console: 'Console',
    consoleEmpty: 'Waiting for a run…',
    name: 'Name',
    paused: 'Paused',
    noRuns: 'No runs',
    confirmDelete: 'Delete this plugin?',
  },
} as const;

const TRIGGER_LABELS: Record<AutomationEventType, { es: string; en: string }> = {
  'tiktok.chat': { es: 'Comentario', en: 'Comment' },
  'tiktok.gift': { es: 'Regalo', en: 'Gift' },
  'tiktok.like': { es: 'Me gusta', en: 'Like' },
  'tiktok.follow': { es: 'Nuevo seguidor', en: 'New follower' },
  'tiktok.share': { es: 'Compartido', en: 'Share' },
  'tiktok.join': { es: 'Entra al directo', en: 'Joins the live' },
  'tiktok.social': { es: 'Acción social', en: 'Social action' },
  'tiktok.room_stats': { es: 'Estado de la sala', en: 'Room stats' },
  'tiktok.connected': { es: 'Conectado', en: 'Connected' },
  'tiktok.disconnected': { es: 'Desconectado', en: 'Disconnected' },
  'points.awarded': { es: 'Puntos otorgados', en: 'Points awarded' },
  'plugin.emit': { es: 'Evento interno', en: 'Internal event' },
};

const OPERATOR_LABELS: Array<{ id: LivePluginOperator; label: string }> = [
  { id: 'greater-or-equal', label: '≥' },
  { id: 'greater-than', label: '>' },
  { id: 'less-or-equal', label: '≤' },
  { id: 'less-than', label: '<' },
  { id: 'equals', label: '=' },
  { id: 'not-equals', label: '≠' },
  { id: 'contains', label: 'contiene' },
  { id: 'starts-with', label: 'empieza por' },
];

const COOLDOWN_CHOICES = [0, 3_000, 5_000, 10_000, 30_000, 60_000];

export function PluginsView({
  locale,
  plugins,
  runs,
  testRun,
  error,
  onSave,
  onDelete,
  onSetEnabled,
  onTest,
}: PluginsViewProps) {
  const copy = COPY[locale];
  const [screen, setScreen] = useState<Screen>({ kind: 'list' });
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ListFilter>('all');

  const lastRunByPlugin = useMemo(() => {
    const map = new Map<string, LivePluginRun>();
    for (const run of runs) {
      if (run.test) continue;
      if (!map.has(run.pluginId)) map.set(run.pluginId, run);
    }
    return map;
  }, [runs]);

  const visible = plugins.filter((record) => {
    const plugin = record.plugin;
    const failing = lastRunByPlugin.get(plugin.id)?.status === 'error';
    if (filter === 'template' && plugin.mode !== 'template') return false;
    if (filter === 'code' && plugin.mode !== 'code') return false;
    if (filter === 'errors' && !failing) return false;
    if (!query.trim()) return true;
    const needle = query.trim().toLowerCase();
    return plugin.name.toLowerCase().includes(needle) || plugin.trigger.includes(needle);
  });

  const activeCount = plugins.filter((record) => record.plugin.enabled).length;
  const failingCount = plugins.filter((record) => lastRunByPlugin.get(record.plugin.id)?.status === 'error').length;

  const openTemplate = (template: LivePluginTemplate): void => {
    setScreen({
      kind: 'editor',
      plugin: createLivePluginFromTemplate(template, locale, createLivePluginId()),
      isNew: true,
    });
  };

  if (screen.kind === 'editor') {
    return (
      <PluginEditor
        key={screen.plugin.id}
        locale={locale}
        plugin={screen.plugin}
        isNew={screen.isNew}
        error={error}
        testRun={testRun?.pluginId === screen.plugin.id ? testRun : undefined}
        onCancel={() => setScreen({ kind: 'list' })}
        onSave={(plugin) => {
          onSave(plugin);
          setScreen({ kind: 'list' });
        }}
        onDelete={(id) => {
          onDelete(id);
          setScreen({ kind: 'list' });
        }}
        onTest={onTest}
      />
    );
  }

  return (
    <div className="plg">
      <div className="plg-topbar">
        <div className="plg-topbar__text">
          <h2 className="plg-topbar__title">{copy.title}</h2>
          <span className="plg-topbar__subtitle">
            {plugins.length === 0
              ? copy.lead
              : `${activeCount} ${copy.active} · ${failingCount} ${copy.withErrors}`}
          </span>
        </div>
        <div className="plg-topbar__actions">
          <button type="button" className="plg-btn plg-btn--primary" onClick={() => setScreen({ kind: 'gallery' })}>
            <PlusIcon />
            {copy.newPlugin}
          </button>
        </div>
      </div>

      <div className="plg-toolbar">
        <input
          className="plg-input"
          type="search"
          value={query}
          placeholder={copy.search}
          onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)}
        />
        <div className="plg-chips">
          {([
            ['all', `${copy.all} · ${plugins.length}`],
            ['template', `${copy.templates} · ${plugins.filter((r) => r.plugin.mode === 'template').length}`],
            ['code', `${copy.code} · ${plugins.filter((r) => r.plugin.mode === 'code').length}`],
            ['errors', `${copy.errors} · ${failingCount}`],
          ] as Array<[ListFilter, string]>).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`plg-chip${filter === id ? ' is-active' : ''}`}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="plg-stack"><div className="plg-alert">{error}</div></div>}

      <div className="plg-body">
        <div className="plg-scroll">
          <div className="plg-stack">
            {visible.map((record) => (
              <PluginRow
                key={record.plugin.id}
                locale={locale}
                plugin={record.plugin}
                lastRun={lastRunByPlugin.get(record.plugin.id)}
                onOpen={() => setScreen({ kind: 'editor', plugin: record.plugin, isNew: false })}
                onToggle={() => onSetEnabled(record.plugin.id, !record.plugin.enabled)}
              />
            ))}

            {visible.length === 0 && (
              <div className="plg-empty">
                <span className="plg-empty__title">
                  {plugins.length === 0 ? copy.emptyTitle : copy.emptyFilterTitle}
                </span>
                <span className="plg-empty__desc">
                  {plugins.length === 0 ? copy.emptyDesc : copy.emptyFilterDesc}
                </span>
                {plugins.length === 0 ? (
                  <button type="button" className="plg-btn plg-btn--primary" onClick={() => setScreen({ kind: 'gallery' })}>
                    {copy.newPlugin}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="plg-btn"
                    onClick={() => {
                      setFilter('all');
                      setQuery('');
                    }}
                  >
                    {copy.clear}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <aside className="plg-body__aside">
          <div className="plg-toolbar">
            <span className="plg-section-title">{copy.runs}</span>
          </div>
          <div className="plg-runs">
            {runs.length === 0 && <p className="plg-note">{copy.runsEmpty}</p>}
            {runs.slice(0, 20).map((run) => (
              <div className="plg-run" key={run.id}>
                <span className={`plg-dot${run.status === 'ok' ? ' is-ok' : run.status === 'error' ? ' is-err' : ''}`} />
                <div className="plg-run__text">
                  <span className="plg-run__name">{run.pluginName}</span>
                  <span className="plg-run__detail">{run.error ?? run.summary}</span>
                </div>
                <span className="plg-run__time">{relativeTime(run.at, locale)}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>

      {screen.kind === 'gallery' && (
        <PluginGallery
          locale={locale}
          plugins={plugins}
          onClose={() => setScreen({ kind: 'list' })}
          onPickTemplate={openTemplate}
          onPickPlugin={(plugin) => setScreen({ kind: 'editor', plugin, isNew: true })}
        />
      )}
    </div>
  );
}

function PluginRow({
  locale,
  plugin,
  lastRun,
  onOpen,
  onToggle,
}: {
  locale: Locale;
  plugin: LivePlugin;
  lastRun?: LivePluginRun;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const copy = COPY[locale];
  const failing = lastRun?.status === 'error';
  const statusClass = !plugin.enabled ? '' : failing ? ' is-err' : lastRun ? ' is-ok' : '';
  const statusText = !plugin.enabled
    ? copy.paused
    : lastRun
      ? `${lastRun.error ?? lastRun.summary} · ${relativeTime(lastRun.at, locale)}`
      : copy.noRuns;

  return (
    <div className={`plg-row${plugin.enabled ? '' : ' is-off'}${failing && plugin.enabled ? ' has-error' : ''}`}>
      <button type="button" className="plg-row__open" onClick={onOpen}>
        <span className="plg-row__head">
          <span className="plg-row__name">{plugin.name}</span>
          <span className="plg-tag">{plugin.mode === 'code' ? copy.code : copy.templates}</span>
        </span>
        <span className="plg-row__detail">{describeAction(plugin)}</span>
        <span className={`plg-row__status${statusClass}`}>
          <span className={`plg-dot${!plugin.enabled ? '' : failing ? ' is-err' : lastRun ? ' is-ok' : ''}`} />
          {statusText}
        </span>
      </button>
      <button
        type="button"
        className={`plg-switch${plugin.enabled ? ' is-on' : ''}`}
        aria-label={plugin.name}
        onClick={onToggle}
      >
        <span className="plg-switch__track"><span className="plg-switch__thumb" /></span>
      </button>
    </div>
  );
}

function PluginGallery({
  locale,
  plugins,
  onClose,
  onPickTemplate,
  onPickPlugin,
}: {
  locale: Locale;
  plugins: LivePluginRecord[];
  onClose: () => void;
  onPickTemplate: (template: LivePluginTemplate) => void;
  onPickPlugin: (plugin: LivePlugin) => void;
}) {
  const copy = COPY[locale];
  const [tab, setTab] = useState<'gallery' | 'installed' | 'import'>('gallery');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'all' | 'fetch' | 'emit' | 'code'>('all');
  const [selectedId, setSelectedId] = useState(LIVE_PLUGIN_TEMPLATES[0]?.id ?? 'webhook');
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');

  const templates = LIVE_PLUGIN_TEMPLATES.filter((template) => {
    if (kind !== 'all' && template.tag !== kind) return false;
    if (!query.trim()) return true;
    const needle = query.trim().toLowerCase();
    return template.title[locale].toLowerCase().includes(needle)
      || template.description[locale].toLowerCase().includes(needle);
  });
  const selected = findLivePluginTemplate(selectedId) ?? LIVE_PLUGIN_TEMPLATES[0];

  const handleImport = (): void => {
    try {
      const parsed = JSON.parse(importText) as Partial<LivePlugin>;
      const template = findLivePluginTemplate(String(parsed.templateId ?? 'webhook'));
      if (!template || !parsed.action || !parsed.trigger) throw new Error('invalid');
      onPickPlugin({
        ...createLivePluginFromTemplate(template, locale, createLivePluginId()),
        name: typeof parsed.name === 'string' ? parsed.name : template.defaultName[locale],
        trigger: parsed.trigger,
        condition: parsed.condition,
        cooldownMs: typeof parsed.cooldownMs === 'number' ? parsed.cooldownMs : 0,
        cooldownScope: parsed.cooldownScope === 'global' ? 'global' : 'user',
        action: parsed.action as LivePluginAction,
      });
    } catch {
      setImportError(copy.importError);
    }
  };

  return (
    <div className="plg-modal" role="dialog" aria-modal="true">
      <div className="plg-modal__card">
        <div className="plg-topbar">
          <div className="plg-topbar__text">
            <h2 className="plg-topbar__title">{copy.addTitle}</h2>
            <span className="plg-topbar__subtitle">{templates.length} · {LIVE_PLUGIN_TEMPLATES.length}</span>
          </div>
          <button type="button" className="plg-btn plg-btn--icon" onClick={onClose} aria-label={copy.cancel}>×</button>
        </div>

        <div className="plg-tabs">
          {([
            ['gallery', copy.gallery],
            ['installed', `${copy.installed} · ${plugins.length}`],
            ['import', copy.import],
          ] as Array<['gallery' | 'installed' | 'import', string]>).map(([id, label]) => (
            <button key={id} type="button" className={`plg-tab${tab === id ? ' is-active' : ''}`} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'gallery' && (
          <>
            <div className="plg-toolbar">
              <input
                className="plg-input"
                type="search"
                value={query}
                placeholder={copy.searchTemplate}
                onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)}
              />
              <div className="plg-chips">
                {([['all', copy.all], ['fetch', 'fetch'], ['emit', 'emit'], ['code', copy.code]] as Array<
                  ['all' | 'fetch' | 'emit' | 'code', string]
                >).map(([id, label]) => (
                  <button key={id} type="button" className={`plg-chip${kind === id ? ' is-active' : ''}`} onClick={() => setKind(id)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="plg-modal__body">
              <div className="plg-grid">
                {templates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    className={`plg-card${selectedId === template.id ? ' is-active' : ''}`}
                    onClick={() => setSelectedId(template.id)}
                    onDblClick={() => onPickTemplate(template)}
                  >
                    <span className="plg-card__thumb">{template.preview}</span>
                    <span className="plg-card__body">
                      <span className="plg-card__head">
                        <span className="plg-card__title">{template.title[locale]}</span>
                        <span className="plg-tag plg-tag--mono">{template.tag}</span>
                      </span>
                      <span className="plg-card__desc">{template.description[locale]}</span>
                      <span className="plg-mono">{template.permission[locale]}</span>
                    </span>
                  </button>
                ))}
                {templates.length === 0 && (
                  <div className="plg-empty">
                    <span className="plg-empty__title">{copy.emptyFilterTitle}</span>
                    <button type="button" className="plg-btn" onClick={() => { setKind('all'); setQuery(''); }}>
                      {copy.clear}
                    </button>
                  </div>
                )}
              </div>

              {selected && (
                <div className="plg-detail">
                  <div className="plg-card__thumb">{selected.preview}</div>
                  <div className="plg-group">
                    <span className="plg-card__title">{selected.title[locale]}</span>
                    <p className="plg-note">{selected.description[locale]}</p>
                  </div>
                  <div className="plg-group">
                    <span className="plg-section-title">{copy.event}</span>
                    <span className="plg-mono">{selected.defaultTrigger}</span>
                  </div>
                  <div className="plg-group">
                    <span className="plg-section-title">{copy.permissions}</span>
                    <span className="plg-mono">{selected.permission[locale]}</span>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {tab === 'installed' && (
          <div className="plg-scroll">
            <div className="plg-stack">
              {plugins.map((record) => (
                <div className="plg-row" key={record.plugin.id}>
                  <button
                    type="button"
                    className="plg-row__open"
                    onClick={() => onPickPlugin({
                      ...record.plugin,
                      id: createLivePluginId(),
                      name: `${record.plugin.name} (2)`,
                      enabled: false,
                    })}
                  >
                    <span className="plg-row__head">
                      <span className="plg-row__name">{record.plugin.name}</span>
                      <span className="plg-tag">{copy.duplicate}</span>
                    </span>
                    <span className="plg-row__detail">{describeAction(record.plugin)}</span>
                  </button>
                </div>
              ))}
              {plugins.length === 0 && <p className="plg-note">{copy.emptyDesc}</p>}
            </div>
          </div>
        )}

        {tab === 'import' && (
          <div className="plg-scroll">
            <div className="plg-form">
              <div className="plg-field">
                <label className="plg-label">{copy.importHint}</label>
                <textarea
                  className="plg-textarea"
                  rows={10}
                  value={importText}
                  onInput={(event) => {
                    setImportText((event.currentTarget as HTMLTextAreaElement).value);
                    setImportError('');
                  }}
                />
                {importError && <div className="plg-alert">{importError}</div>}
                <button type="button" className="plg-btn plg-btn--primary" onClick={handleImport} disabled={!importText.trim()}>
                  {copy.importAction}
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === 'gallery' && selected && (
          <div className="plg-modal__foot">
            <div className="plg-modal__foot-text">
              <span className="plg-row__name">{selected.title[locale]}</span>
              <span className="plg-mono">{selected.permission[locale]}</span>
            </div>
            <button type="button" className="plg-btn plg-btn--ghost" onClick={onClose}>{copy.cancel}</button>
            <button type="button" className="plg-btn plg-btn--primary" onClick={() => onPickTemplate(selected)}>
              {copy.continue}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function PluginEditor({
  locale,
  plugin,
  isNew,
  error,
  testRun,
  onCancel,
  onSave,
  onDelete,
  onTest,
}: {
  locale: Locale;
  plugin: LivePlugin;
  isNew: boolean;
  error?: string;
  testRun?: LivePluginRun;
  onCancel: () => void;
  onSave: (plugin: LivePlugin) => void;
  onDelete: (id: string) => void;
  onTest: (plugin: LivePlugin) => void;
}) {
  const copy = COPY[locale];
  const [draft, setDraft] = useState<LivePlugin>(plugin);
  const [tab, setTab] = useState<'body' | 'headers' | 'options'>('body');
  const template = findLivePluginTemplate(draft.templateId);
  const form = template?.form ?? (draft.action.kind === 'code' ? 'code' : 'fetch');
  const permissions = deriveLivePluginPermissions(draft);

  const update = (patch: Partial<LivePlugin>): void => setDraft((current) => ({ ...current, ...patch }));
  const updateAction = (patch: Partial<LivePluginAction>): void =>
    setDraft((current) => ({ ...current, action: { ...current.action, ...patch } as LivePluginAction }));

  return (
    <div className="plg">
      <div className="plg-topbar">
        <button type="button" className="plg-btn plg-btn--icon" onClick={onCancel} aria-label={copy.back}>‹</button>
        <div className="plg-topbar__text">
          <h2 className="plg-topbar__title">{draft.name || copy.newPlugin}</h2>
          <span className="plg-topbar__subtitle plg-mono">
            {(draft.mode === 'code' ? copy.code : copy.templates)} · {draft.trigger}
          </span>
        </div>
        <div className="plg-topbar__actions">
          {!isNew && (
            <button
              type="button"
              className="plg-btn plg-btn--danger plg-btn--sm"
              onClick={() => {
                if (confirm(copy.confirmDelete)) onDelete(draft.id);
              }}
            >
              {copy.remove}
            </button>
          )}
          <button type="button" className="plg-btn plg-btn--primary" onClick={() => onSave(draft)}>
            {copy.save}
          </button>
        </div>
      </div>

      <div className="plg-scroll">
        <div className="plg-form">
          <div className="plg-form__main">
            {error && <div className="plg-alert">{error}</div>}

            <div className="plg-group">
              <span className="plg-section-title">{copy.when}</span>
              <div className="plg-field">
                <label className="plg-label">{copy.name}</label>
                <input
                  className="plg-input"
                  value={draft.name}
                  onInput={(event) => update({ name: (event.currentTarget as HTMLInputElement).value })}
                />
              </div>
              <div className="plg-field">
                <label className="plg-label">{copy.event}</label>
                <select
                  className="plg-select"
                  value={draft.trigger}
                  onChange={(event) => update({ trigger: (event.currentTarget as HTMLSelectElement).value as AutomationEventType })}
                >
                  {LIVE_PLUGIN_TRIGGERS.map((trigger) => (
                    <option key={trigger} value={trigger}>
                      {TRIGGER_LABELS[trigger][locale]} · {trigger}
                    </option>
                  ))}
                </select>
              </div>

              <ConditionField locale={locale} condition={draft.condition} onChange={(condition) => update({ condition })} />

              <div className="plg-inline">
                <div className="plg-field">
                  <label className="plg-label">{copy.cooldown}</label>
                  <select
                    className="plg-select"
                    value={String(draft.cooldownMs)}
                    onChange={(event) => update({ cooldownMs: Number((event.currentTarget as HTMLSelectElement).value) })}
                  >
                    {COOLDOWN_CHOICES.map((ms) => (
                      <option key={ms} value={String(ms)}>{ms === 0 ? copy.noCooldown : `${ms / 1000} s`}</option>
                    ))}
                  </select>
                </div>
                <div className="plg-field">
                  <label className="plg-label">{copy.cooldownScope}</label>
                  <select
                    className="plg-select"
                    value={draft.cooldownScope}
                    onChange={(event) => update({ cooldownScope: (event.currentTarget as HTMLSelectElement).value === 'global' ? 'global' : 'user' })}
                  >
                    <option value="user">{copy.perUser}</option>
                    <option value="global">{copy.global}</option>
                  </select>
                </div>
              </div>
              <p className="plg-note">
                {locale === 'es'
                  ? 'El filtro y la espera son campos de este formulario, no pasos aparte.'
                  : 'The filter and the cooldown are fields of this form, not separate steps.'}
              </p>
            </div>

            {form === 'fetch' && draft.action.kind === 'fetch' && (
              <FetchForm
                locale={locale}
                action={draft.action}
                tab={tab}
                onTab={setTab}
                onChange={(patch) => updateAction(patch)}
              />
            )}

            {form === 'code' && draft.action.kind === 'code' && (
              <div className="plg-group">
                <span className="plg-section-title">{copy.script}</span>
                <textarea
                  className="plg-textarea plg-textarea--code"
                  spellcheck={false}
                  value={draft.action.source}
                  onInput={(event) => updateAction({ source: (event.currentTarget as HTMLTextAreaElement).value })}
                />
                <p className="plg-note">{copy.scriptHint}</p>
              </div>
            )}

            {draft.action.kind === 'emit' && form !== 'fetch' && form !== 'code' && (
              <EmitForm
                locale={locale}
                form={form}
                action={draft.action}
                onChange={(patch) => updateAction(patch)}
              />
            )}
          </div>

          <div className="plg-side">
            <div className="plg-panel">
              <span className="plg-section-title">{copy.permissions}</span>
              <div className="plg-kv">
                <span className="plg-kv__key">network</span>
                <span className="plg-kv__value">{permissions.network.join(', ') || copy.none}</span>
              </div>
              <div className="plg-kv">
                <span className="plg-kv__key">capabilities</span>
                <span className="plg-kv__value">{permissions.capabilities.join(', ') || copy.none}</span>
              </div>
              <div className="plg-kv">
                <span className="plg-kv__key">local</span>
                <span className="plg-kv__value">{permissions.localNetwork ? 'sí' : 'no'}</span>
              </div>
              <p className="plg-note">{copy.permissionsHint}</p>
            </div>

            <button type="button" className="plg-btn plg-btn--block" onClick={() => onTest(draft)}>
              {copy.test}
            </button>

            {testRun && (
              <div className={`plg-panel ${testRun.status === 'error' ? 'plg-panel--err' : 'plg-panel--ok'}`}>
                <span className="plg-row__name">{testRun.error ?? testRun.summary}</span>
                <span className="plg-mono">{testRun.durationMs} ms</span>
              </div>
            )}

            <div className="plg-panel">
              <span className="plg-section-title">{copy.console}</span>
              <div className="plg-console">
                {(testRun?.logs.length ? testRun.logs : [copy.consoleEmpty]).map((line, index) => (
                  <div key={`${index}-${line}`}>{line}</div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConditionField({
  locale,
  condition,
  onChange,
}: {
  locale: Locale;
  condition?: LivePluginCondition;
  onChange: (condition: LivePluginCondition | undefined) => void;
}) {
  const copy = COPY[locale];
  const current = condition ?? { path: '', operator: 'greater-or-equal' as LivePluginOperator, value: '' };

  return (
    <div className="plg-field">
      <label className="plg-label">
        {copy.onlyIf} <span>{copy.optional}</span>
      </label>
      <div className="plg-kv-row">
        <input
          className="plg-input plg-input--mono"
          placeholder="event.data.diamondCount"
          value={current.path}
          onInput={(event) => {
            const path = (event.currentTarget as HTMLInputElement).value;
            onChange(path.trim() ? { ...current, path } : undefined);
          }}
        />
        <select
          className="plg-select plg-input--key"
          value={current.operator}
          onChange={(event) => onChange({ ...current, operator: (event.currentTarget as HTMLSelectElement).value as LivePluginOperator })}
        >
          {OPERATOR_LABELS.map((operator) => (
            <option key={operator.id} value={operator.id}>{operator.label}</option>
          ))}
        </select>
        <input
          className="plg-input plg-input--key"
          value={current.value}
          onInput={(event) => onChange({ ...current, value: (event.currentTarget as HTMLInputElement).value })}
        />
      </div>
    </div>
  );
}

function FetchForm({
  locale,
  action,
  tab,
  onTab,
  onChange,
}: {
  locale: Locale;
  action: Extract<LivePluginAction, { kind: 'fetch' }>;
  tab: 'body' | 'headers' | 'options';
  onTab: (tab: 'body' | 'headers' | 'options') => void;
  onChange: (patch: Partial<Extract<LivePluginAction, { kind: 'fetch' }>>) => void;
}) {
  const copy = COPY[locale];

  return (
    <div className="plg-group">
      <span className="plg-section-title">{copy.request}</span>
      <div className="plg-chips">
        {(['GET', 'POST', 'PUT', 'DELETE'] as const).map((method) => (
          <button
            key={method}
            type="button"
            className={`plg-chip${action.method === method ? ' is-active' : ''}`}
            onClick={() => onChange({ method })}
          >
            {method}
          </button>
        ))}
      </div>
      <div className="plg-field">
        <label className="plg-label">{copy.url}</label>
        <input
          className="plg-input plg-input--mono"
          value={action.url}
          placeholder="https://hooks.example.com/live"
          onInput={(event) => onChange({ url: (event.currentTarget as HTMLInputElement).value })}
        />
      </div>

      <div className="plg-tabs">
        {([['body', copy.body], ['headers', `${copy.headers} · ${Object.keys(action.headers).length}`], ['options', copy.options]] as Array<
          ['body' | 'headers' | 'options', string]
        >).map(([id, label]) => (
          <button key={id} type="button" className={`plg-tab${tab === id ? ' is-active' : ''}`} onClick={() => onTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'body' && (
        <textarea
          className="plg-textarea"
          rows={8}
          spellcheck={false}
          value={action.body}
          onInput={(event) => onChange({ body: (event.currentTarget as HTMLTextAreaElement).value })}
        />
      )}

      {tab === 'headers' && (
        <KeyValueEditor
          entries={action.headers}
          addLabel={copy.addHeader}
          onChange={(headers) => onChange({ headers })}
        />
      )}

      {tab === 'options' && (
        <>
          <div className="plg-field">
            <label className="plg-label">{copy.timeout}</label>
            <input
              className="plg-input"
              type="number"
              min={100}
              max={120000}
              value={String(action.timeoutMs ?? 5000)}
              onInput={(event) => onChange({ timeoutMs: Number((event.currentTarget as HTMLInputElement).value) })}
            />
          </div>
          <div className="plg-field">
            <label className="plg-label">{copy.emitResponse} <span>{copy.optional}</span></label>
            <input
              className="plg-input plg-input--mono"
              placeholder="overlay.webhook.done"
              value={action.emitResponseAs ?? ''}
              onInput={(event) => {
                const value = (event.currentTarget as HTMLInputElement).value.trim();
                onChange({ emitResponseAs: value || undefined });
              }}
            />
          </div>
          <label className="plg-kv-row">
            <button
              type="button"
              className={`plg-switch${action.allowPrivateNetwork ? ' is-on' : ''}`}
              onClick={() => onChange({ allowPrivateNetwork: !action.allowPrivateNetwork })}
            >
              <span className="plg-switch__track"><span className="plg-switch__thumb" /></span>
            </button>
            <span className="plg-label">{copy.localNetwork}</span>
          </label>
        </>
      )}
    </div>
  );
}

function EmitForm({
  locale,
  form,
  action,
  onChange,
}: {
  locale: Locale;
  form: string;
  action: Extract<LivePluginAction, { kind: 'emit' }>;
  onChange: (patch: Partial<Extract<LivePluginAction, { kind: 'emit' }>>) => void;
}) {
  const copy = COPY[locale];
  const labels: Record<string, string> = {
    file: copy.file,
    volume: copy.volume,
    text: copy.text,
    voice: copy.voice,
    lang: copy.lang,
    uniqueId: copy.viewer,
    delta: copy.delta,
  };
  const setField = (key: string, value: string): void => onChange({ data: { ...action.data, [key]: value } });

  return (
    <div className="plg-group">
      <span className="plg-section-title">{copy.internalEvent}</span>
      {form === 'emit' ? (
        <div className="plg-field">
          <label className="plg-label">{copy.internalEvent}</label>
          <input
            className="plg-input plg-input--mono"
            value={action.type}
            onInput={(event) => onChange({ type: (event.currentTarget as HTMLInputElement).value })}
          />
        </div>
      ) : (
        <p className="plg-note">
          <span className="plg-mono">{action.type}</span>
          {' — '}
          {locale === 'es'
            ? 'el anfitrión lo conecta con la capacidad correspondiente.'
            : 'the host binds it to the matching capability.'}
        </p>
      )}

      {Object.entries(action.data).map(([key, value]) => (
        <div className="plg-field" key={key}>
          <label className="plg-label">{labels[key] ?? key}</label>
          <input
            className="plg-input plg-input--mono"
            value={value}
            onInput={(event) => setField(key, (event.currentTarget as HTMLInputElement).value)}
          />
        </div>
      ))}

      {form === 'emit' && (
        <KeyValueEditor entries={action.data} addLabel={copy.addField} onChange={(data) => onChange({ data })} showKeys />
      )}
    </div>
  );
}

function KeyValueEditor({
  entries,
  addLabel,
  onChange,
  showKeys = true,
}: {
  entries: Record<string, string>;
  addLabel: string;
  onChange: (entries: Record<string, string>) => void;
  showKeys?: boolean;
}) {
  const rows = Object.entries(entries);

  const rename = (from: string, to: string): void => {
    const next: Record<string, string> = {};
    for (const [key, value] of rows) next[key === from ? to : key] = value;
    onChange(next);
  };

  return (
    <div className="plg-group">
      {showKeys && rows.map(([key, value]) => (
        <div className="plg-kv-row" key={key}>
          <input
            className="plg-input plg-input--mono plg-input--key"
            value={key}
            onChange={(event) => rename(key, (event.currentTarget as HTMLInputElement).value)}
          />
          <input
            className="plg-input plg-input--mono"
            value={value}
            onInput={(event) => onChange({ ...entries, [key]: (event.currentTarget as HTMLInputElement).value })}
          />
          <button
            type="button"
            className="plg-btn plg-btn--icon plg-btn--danger"
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
        onClick={() => onChange({ ...entries, [`campo-${rows.length + 1}`]: '' })}
      >
        {addLabel}
      </button>
    </div>
  );
}

function describeAction(plugin: LivePlugin): string {
  if (plugin.action.kind === 'fetch') {
    const host = plugin.action.url.replace(/^https?:\/\//, '').split('/')[0] ?? plugin.action.url;
    return `${plugin.trigger} → ${plugin.action.method} ${host}`;
  }
  if (plugin.action.kind === 'emit') return `${plugin.trigger} → emit ${plugin.action.type}`;
  return `${plugin.trigger} → napi-vm`;
}

function relativeTime(timestamp: number, locale: Locale): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 5) return locale === 'es' ? 'ahora' : 'now';
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.round(minutes / 60)} h`;
}

function PlusIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}
