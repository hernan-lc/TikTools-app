import { useMemo, useState } from 'preact/hooks';

import { IconPencil, IconTrash } from '../components/icons.tsx';

import {
  BUILTIN_ACTION_TYPES,
  PLUGIN_DESCRIPTORS,
  actionTypesForPlugin,
  findActionType,
} from '../../automation/behavior/catalog.ts';
import {
  BEHAVIOR_TRIGGERS,
  createActionId,
  createEventId,
  deriveActionPermissions,
  readString,
  readStringMap,
} from '../../automation/behavior/schema.ts';
import type {
  ActionField,
  ActionTypeDefinition,
  BehaviorRun,
  BehaviorSnapshot,
  EventFilter,
  FilterOperator,
  LiveAction,
  LiveEvent,
  PluginStatus,
} from '../../automation/behavior/types.ts';
import type { AutomationEventType, JsonObject } from '../../automation/types.ts';
import { InfoTip } from '../components/ui/InfoTip.tsx';
import type { Locale } from '../i18n.ts';

type BehaviorViewProps = {
  locale: Locale;
  snapshot: BehaviorSnapshot;
  runs: BehaviorRun[];
  testRuns: BehaviorRun[];
  error?: string;
  onSaveAction: (action: LiveAction) => void;
  onDeleteAction: (id: string) => void;
  onSetActionEnabled: (id: string, enabled: boolean) => void;
  onTestAction: (action: LiveAction, trigger?: AutomationEventType) => void;
  onSaveEvent: (event: LiveEvent) => void;
  onDeleteEvent: (id: string) => void;
  onSetEventEnabled: (id: string, enabled: boolean) => void;
  onTestEvent: (event: LiveEvent) => void;
  onOpenPlugins: () => void;
};

type Screen =
  | { kind: 'list' }
  | { kind: 'picker' }
  | { kind: 'action'; action: LiveAction; isNew: boolean }
  | { kind: 'event'; event: LiveEvent; isNew: boolean };

const COPY = {
  es: {
    title: 'Comportamiento',
    lead: 'Arriba qué puede pasar, abajo cuándo pasa. Una acción se reutiliza en varios eventos.',
    actions: 'Acciones',
    events: 'Eventos',
    newAction: 'Nueva acción',
    newEvent: 'Nuevo evento',
    searchAction: 'Buscar acción',
    searchEvent: 'Buscar evento',
    colActive: 'Activa',
    colName: 'Nombre',
    colOrigin: 'Origen',
    colDoes: 'Qué hace',
    colLast: 'Última vez',
    colTrigger: 'Desencadenante',
    colFilters: 'Condiciones',
    colActions: 'Acciones',
    builtIn: 'Integrada',
    noActions: 'Todavía no hay acciones. Empieza por una integrada: llamar a una URL, emitir un evento, sumar puntos.',
    noEvents: 'Todavía no hay eventos. Un evento decide cuándo se ejecutan tus acciones.',
    noRuns: 'Sin ejecuciones',
    paused: 'Pausada',
    always: 'siempre',
    runs: 'Últimas ejecuciones',
    runsEmpty: 'Sin ejecuciones todavía.',
    pickTitle: 'Elige un tipo de acción',
    pickLead: 'Las integradas no dependen de nada. Las demás las aporta un plugin instalado.',
    builtInGroup: 'Integradas',
    builtInNote: 'siempre disponibles · sin dependencias',
    pluginNote: 'plugin',
    explore: 'Explorar plugins',
    missingTitle: '¿Falta una acción?',
    missingDesc: 'Las que necesitan una dependencia —audio, voz, OBS— llegan instalando un plugin. Cada plugin puede aportar varias.',
    back: 'Volver',
    save: 'Guardar',
    remove: 'Eliminar',
    edit: 'Editar',
    test: 'Probar',
    name: 'Nombre',
    permissions: 'Permisos',
    permissionsHint: 'Se derivan de lo que rellenas aquí; el motor rechaza cualquier destino fuera de la lista.',
    none: 'ninguno',
    console: 'Consola',
    consoleEmpty: 'Esperando una ejecución…',
    stepWhen: 'Cuándo',
    stepFilters: 'Sólo si…',
    stepFiltersHint: 'opcional · deben cumplirse todos',
    stepDo: 'Qué hace',
    trigger: 'Evento',
    addFilter: '+ Añadir condición',
    orHint: '¿Necesitas un «o»? Usa «es uno de» dentro de la condición.',
    noFilters: 'Sin condiciones: el evento se dispara siempre.',
    field: 'Campo',
    operator: 'Comparación',
    value: 'Valor',
    addValue: 'Añadir valor',
    runMode: 'Ejecutar sólo una, al azar',
    cooldown: 'Espera entre disparos',
    cooldownScope: 'Ámbito',
    perUser: 'por usuario',
    global: 'global',
    noCooldown: 'sin espera',
    pickActions: 'Marca las acciones que ejecuta',
    noActionsYet: 'Crea una acción primero.',
    confirmDeleteAction: '¿Eliminar esta acción? Los eventos que la usen dejarán de ejecutarla.',
    confirmDeleteEvent: '¿Eliminar este evento?',
    pluginMissing: 'plugin no instalado',
    advanced: 'Opciones avanzadas',
    addEntry: 'Añadir',
    next: 'Continuar',
    previous: 'Atrás',
    finish: 'Guardar evento',
    stepOf: (step: number) => `Paso ${step} de 3`,
    noneYet: 'sin definir',
    alwaysShort: 'siempre',
  },
  en: {
    title: 'Behavior',
    lead: 'What can happen on top, when it happens below. One action is reused by several events.',
    actions: 'Actions',
    events: 'Events',
    newAction: 'New action',
    newEvent: 'New event',
    searchAction: 'Search action',
    searchEvent: 'Search event',
    colActive: 'Active',
    colName: 'Name',
    colOrigin: 'Source',
    colDoes: 'What it does',
    colLast: 'Last run',
    colTrigger: 'Trigger',
    colFilters: 'Conditions',
    colActions: 'Actions',
    builtIn: 'Built-in',
    noActions: 'No actions yet. Start with a built-in one: call a URL, emit an event, give points.',
    noEvents: 'No events yet. An event decides when your actions run.',
    noRuns: 'No runs',
    paused: 'Paused',
    always: 'always',
    runs: 'Recent runs',
    runsEmpty: 'No runs yet.',
    pickTitle: 'Pick an action type',
    pickLead: 'Built-in ones depend on nothing. The rest come from an installed plugin.',
    builtInGroup: 'Built-in',
    builtInNote: 'always available · no dependencies',
    pluginNote: 'plugin',
    explore: 'Browse plugins',
    missingTitle: 'Missing an action?',
    missingDesc: 'Anything needing a dependency — audio, voice, OBS — arrives by installing a plugin. Each one may add several.',
    back: 'Back',
    save: 'Save',
    remove: 'Delete',
    edit: 'Edit',
    test: 'Run test',
    name: 'Name',
    permissions: 'Permissions',
    permissionsHint: 'Derived from what you fill in; the engine refuses any destination outside the list.',
    none: 'none',
    console: 'Console',
    consoleEmpty: 'Waiting for a run…',
    stepWhen: 'When',
    stepFilters: 'Only if…',
    stepFiltersHint: 'optional · all must pass',
    stepDo: 'What it does',
    trigger: 'Event',
    addFilter: '+ Add condition',
    orHint: 'Need an "or"? Use "is one of" inside the condition.',
    noFilters: 'No conditions: the event always fires.',
    field: 'Field',
    operator: 'Comparison',
    value: 'Value',
    addValue: 'Add value',
    runMode: 'Run only one, at random',
    cooldown: 'Cooldown',
    cooldownScope: 'Scope',
    perUser: 'per viewer',
    global: 'global',
    noCooldown: 'no cooldown',
    pickActions: 'Tick the actions it runs',
    noActionsYet: 'Create an action first.',
    confirmDeleteAction: 'Delete this action? Events using it will stop running it.',
    confirmDeleteEvent: 'Delete this event?',
    pluginMissing: 'plugin not installed',
    advanced: 'Advanced options',
    addEntry: 'Add',
    next: 'Continue',
    previous: 'Back',
    finish: 'Save event',
    stepOf: (step: number) => `Step ${step} of 3`,
    noneYet: 'not set',
    alwaysShort: 'always',
  },
} as const;

const TRIGGER_LABELS: Record<AutomationEventType, { es: string; en: string }> = {
  'tiktok.chat': { es: 'Alguien comenta', en: 'Someone comments' },
  'tiktok.gift': { es: 'Alguien envía un regalo', en: 'Someone sends a gift' },
  'tiktok.like': { es: 'Alguien da me gusta', en: 'Someone likes' },
  'tiktok.follow': { es: 'Alguien te sigue', en: 'Someone follows' },
  'tiktok.share': { es: 'Alguien comparte', en: 'Someone shares' },
  'tiktok.join': { es: 'Alguien entra al directo', en: 'Someone joins the live' },
  'tiktok.social': { es: 'Acción social', en: 'Social action' },
  'tiktok.room_stats': { es: 'Estado de la sala', en: 'Room stats' },
  'tiktok.connected': { es: 'Conexión iniciada', en: 'Connected' },
  'tiktok.disconnected': { es: 'Conexión terminada', en: 'Disconnected' },
  'points.awarded': { es: 'Se otorgan puntos', en: 'Points awarded' },
  'plugin.emit': { es: 'Evento interno', en: 'Internal event' },
};

const OPERATOR_LABELS: Array<{ id: FilterOperator; es: string; en: string }> = [
  { id: 'gte', es: 'es al menos', en: 'is at least' },
  { id: 'gt', es: 'es mayor que', en: 'is greater than' },
  { id: 'lte', es: 'es como mucho', en: 'is at most' },
  { id: 'lt', es: 'es menor que', en: 'is less than' },
  { id: 'eq', es: 'es igual a', en: 'is' },
  { id: 'neq', es: 'no es', en: 'is not' },
  { id: 'contains', es: 'contiene', en: 'contains' },
  { id: 'starts-with', es: 'empieza por', en: 'starts with' },
  { id: 'in', es: 'es uno de', en: 'is one of' },
  { id: 'is-true', es: 'es verdadero', en: 'is true' },
  { id: 'is-false', es: 'es falso o vacío', en: 'is false or empty' },
];

const COMMON_FIELDS = ['event.user.uniqueId', 'event.user.nickname'];
const FIELDS_BY_TRIGGER: Partial<Record<AutomationEventType, string[]>> = {
  'tiktok.gift': ['event.data.diamondCount', 'event.data.giftName', 'event.data.repeatCount', 'event.data.repeatEnd'],
  'tiktok.chat': ['event.data.comment'],
  'tiktok.like': ['event.data.count', 'event.data.total'],
  'tiktok.social': ['event.data.followCount', 'event.data.shareCount'],
  'tiktok.room_stats': ['event.data.viewers', 'event.data.totalUsers'],
  'points.awarded': ['event.data.delta', 'event.data.totalPoints', 'event.data.level'],
  'plugin.emit': ['event.data.emitType'],
};

const COOLDOWN_CHOICES = [0, 3_000, 5_000, 10_000, 30_000, 60_000];

export function BehaviorView(props: BehaviorViewProps) {
  const { locale, snapshot, runs, testRuns, error } = props;
  const copy = COPY[locale];
  const [screen, setScreen] = useState<Screen>({ kind: 'list' });
  const [actionQuery, setActionQuery] = useState('');
  const [eventQuery, setEventQuery] = useState('');

  const lastRunByAction = useMemo(() => {
    const map = new Map<string, BehaviorRun>();
    for (const run of runs) {
      if (run.test || !run.actionId) continue;
      if (!map.has(run.actionId)) map.set(run.actionId, run);
    }
    return map;
  }, [runs]);

  const availableTypes = useMemo(() => availableActionTypes(snapshot.plugins), [snapshot.plugins]);

  if (screen.kind === 'picker') {
    return (
      <ActionPicker
        locale={locale}
        plugins={snapshot.plugins}
        onCancel={() => setScreen({ kind: 'list' })}
        onOpenPlugins={props.onOpenPlugins}
        onPick={(type) => setScreen({ kind: 'action', action: createActionFromType(type, locale), isNew: true })}
      />
    );
  }

  if (screen.kind === 'action') {
    return (
      <ActionEditor
        key={screen.action.id}
        locale={locale}
        action={screen.action}
        isNew={screen.isNew}
        error={error}
        testRuns={testRuns}
        onCancel={() => setScreen({ kind: 'list' })}
        onSave={(action) => {
          props.onSaveAction(action);
          setScreen({ kind: 'list' });
        }}
        onDelete={(id) => {
          props.onDeleteAction(id);
          setScreen({ kind: 'list' });
        }}
        onTest={props.onTestAction}
      />
    );
  }

  if (screen.kind === 'event') {
    return (
      <EventEditor
        key={screen.event.id}
        locale={locale}
        event={screen.event}
        isNew={screen.isNew}
        actions={snapshot.actions}
        error={error}
        testRuns={testRuns}
        onCancel={() => setScreen({ kind: 'list' })}
        onSave={(event) => {
          props.onSaveEvent(event);
          setScreen({ kind: 'list' });
        }}
        onDelete={(id) => {
          props.onDeleteEvent(id);
          setScreen({ kind: 'list' });
        }}
        onTest={props.onTestEvent}
      />
    );
  }

  const visibleActions = snapshot.actions.filter((action) =>
    !actionQuery.trim() || action.name.toLowerCase().includes(actionQuery.trim().toLowerCase()));
  const visibleEvents = snapshot.events.filter((event) =>
    !eventQuery.trim()
    || event.name.toLowerCase().includes(eventQuery.trim().toLowerCase())
    || event.trigger.includes(eventQuery.trim().toLowerCase()));

  return (
    <div className="plg">
      <div className="plg-topbar">
        <div className="plg-topbar__text">
          <h2 className="plg-topbar__title">{copy.title}</h2>
          <span className="plg-topbar__subtitle">{copy.lead}</span>
        </div>
      </div>

      {error && <div className="plg-stack"><div className="plg-alert">{error}</div></div>}

      <div className="plg-body">
        <div className="plg-scroll">
          <div className="plg-section">
            <div className="plg-section__head">
              <div className="plg-section__title">
                <h3>{copy.actions}</h3>
                <span className="plg-section__count">{snapshot.actions.length}</span>
              </div>
              <div className="plg-section__tools">
                <input
                  className="plg-input"
                  type="search"
                  value={actionQuery}
                  placeholder={copy.searchAction}
                  onInput={(event) => setActionQuery((event.currentTarget as HTMLInputElement).value)}
                />
                <button type="button" className="plg-btn plg-btn--primary plg-btn--sm" onClick={() => setScreen({ kind: 'picker' })}>
                  {copy.newAction}
                </button>
              </div>
            </div>

            <div className="plg-table plg-table--actions">
              <div className="plg-table__head">
                <span>{copy.colActive}</span>
                <span>{copy.colName}</span>
                <span>{copy.colOrigin}</span>
                <span>{copy.colDoes}</span>
                <span>{copy.colLast}</span>
                <span />
              </div>

              {visibleActions.map((action) => {
                const type = findActionType(action.typeId);
                const lastRun = lastRunByAction.get(action.id);
                const failing = lastRun?.status === 'error';
                const usable = !type || type.source.kind === 'builtin' || availableTypes.has(action.typeId);
                return (
                  <div
                    className={`plg-table__row${action.enabled ? '' : ' is-off'}${failing && action.enabled ? ' has-error' : ''}`}
                    key={action.id}
                  >
                    <button
                      type="button"
                      className={`plg-switch${action.enabled ? ' is-on' : ''}`}
                      aria-label={action.name}
                      onClick={() => props.onSetActionEnabled(action.id, !action.enabled)}
                    >
                      <span className="plg-switch__track"><span className="plg-switch__thumb" /></span>
                    </button>
                    <button
                      type="button"
                      className="plg-table__link"
                      onClick={() => setScreen({ kind: 'action', action, isNew: false })}
                    >
                      {action.name}
                    </button>
                    <span className="plg-table__meta">
                      <span className="plg-table__origin">
                        {type ? originLabel(type, locale, copy.builtIn) : '—'}
                        {!usable && ` · ${copy.pluginMissing}`}
                      </span>
                      <span className="plg-pill plg-pill--mono">{type?.tag ?? '—'}</span>
                    </span>
                    <span className="plg-table__detail">{describeAction(action)}</span>
                    <span className={`plg-table__status${!action.enabled ? '' : failing ? ' is-err' : lastRun ? ' is-ok' : ''}`}>
                      <span className={`plg-dot${!action.enabled ? '' : failing ? ' is-err' : lastRun ? ' is-ok' : ''}`} />
                      {!action.enabled
                        ? copy.paused
                        : lastRun
                          ? `${lastRun.error ?? lastRun.summary} · ${relativeTime(lastRun.at, locale)}`
                          : copy.noRuns}
                    </span>
                    <span className="plg-table__actions">
                      <button
                        type="button"
                        className="plg-iconbtn"
                        aria-label={copy.edit}
                        data-tooltip={copy.edit}
                        data-tooltip-pos="left"
                        onClick={() => setScreen({ kind: 'action', action, isNew: false })}
                      >
                        <IconPencil />
                      </button>
                      <button
                        type="button"
                        className="plg-iconbtn is-danger"
                        aria-label={copy.remove}
                        data-tooltip={copy.remove}
                        data-tooltip-pos="left"
                        onClick={() => {
                          if (confirm(copy.confirmDeleteAction)) props.onDeleteAction(action.id);
                        }}
                      >
                        <IconTrash />
                      </button>
                    </span>
                  </div>
                );
              })}

              {visibleActions.length === 0 && (
                <div className="plg-empty">
                  <span className="plg-empty__desc">{copy.noActions}</span>
                  <button type="button" className="plg-btn plg-btn--primary" onClick={() => setScreen({ kind: 'picker' })}>
                    {copy.newAction}
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="plg-section">
            <div className="plg-section__head">
              <div className="plg-section__title">
                <h3>{copy.events}</h3>
                <span className="plg-section__count">{snapshot.events.length}</span>
              </div>
              <div className="plg-section__tools">
                <input
                  className="plg-input"
                  type="search"
                  value={eventQuery}
                  placeholder={copy.searchEvent}
                  onInput={(event) => setEventQuery((event.currentTarget as HTMLInputElement).value)}
                />
                <button
                  type="button"
                  className="plg-btn plg-btn--primary plg-btn--sm"
                  onClick={() => setScreen({ kind: 'event', event: createEvent(locale), isNew: true })}
                >
                  {copy.newEvent}
                </button>
              </div>
            </div>

            <div className="plg-table plg-table--events">
              <div className="plg-table__head">
                <span>{copy.colActive}</span>
                <span>{copy.colName}</span>
                <span>{copy.colTrigger}</span>
                <span>{copy.colFilters}</span>
                <span>{copy.colActions}</span>
                <span />
              </div>

              {visibleEvents.map((event) => (
                <div className={`plg-table__row${event.enabled ? '' : ' is-off'}`} key={event.id}>
                  <button
                    type="button"
                    className={`plg-switch${event.enabled ? ' is-on' : ''}`}
                    aria-label={event.name}
                    onClick={() => props.onSetEventEnabled(event.id, !event.enabled)}
                  >
                    <span className="plg-switch__track"><span className="plg-switch__thumb" /></span>
                  </button>
                  <button
                    type="button"
                    className="plg-table__link"
                    onClick={() => setScreen({ kind: 'event', event, isNew: false })}
                  >
                    {event.name}
                  </button>
                  <span className="plg-table__origin">{TRIGGER_LABELS[event.trigger][locale]}</span>
                  <span className="plg-table__chips">
                    {event.filters.length === 0 && <span className="plg-pill">{copy.always}</span>}
                    {event.filters.map((filter, index) => (
                      <span className="plg-pill plg-pill--mono" key={`${filter.path}-${index}`}>
                        {describeFilter(filter, locale)}
                      </span>
                    ))}
                  </span>
                  <span className="plg-table__chips">
                    {event.actionIds.map((id) => (
                      <span className="plg-pill plg-pill--accent" key={id}>
                        {snapshot.actions.find((action) => action.id === id)?.name ?? id}
                      </span>
                    ))}
                  </span>
                  <span className="plg-table__actions">
                    <button
                      type="button"
                      className="plg-iconbtn"
                      aria-label={copy.edit}
                      data-tooltip={copy.edit}
                      data-tooltip-pos="left"
                      onClick={() => setScreen({ kind: 'event', event, isNew: false })}
                    >
                      <IconPencil />
                    </button>
                    <button
                      type="button"
                      className="plg-iconbtn is-danger"
                      aria-label={copy.remove}
                      data-tooltip={copy.remove}
                      data-tooltip-pos="left"
                      onClick={() => {
                        if (confirm(copy.confirmDeleteEvent)) props.onDeleteEvent(event.id);
                      }}
                    >
                      <IconTrash />
                    </button>
                  </span>
                </div>
              ))}

              {visibleEvents.length === 0 && (
                <div className="plg-empty">
                  <span className="plg-empty__desc">{copy.noEvents}</span>
                  <button
                    type="button"
                    className="plg-btn plg-btn--primary"
                    onClick={() => setScreen({ kind: 'event', event: createEvent(locale), isNew: true })}
                  >
                    {copy.newEvent}
                  </button>
                </div>
              )}
            </div>
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
                  <span className="plg-run__name">{run.actionName}</span>
                  <span className="plg-run__detail">{run.error ?? run.summary}</span>
                </div>
                <span className="plg-run__time">{relativeTime(run.at, locale)}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

function ActionPicker({
  locale,
  plugins,
  onPick,
  onCancel,
  onOpenPlugins,
}: {
  locale: Locale;
  plugins: PluginStatus[];
  onPick: (type: ActionTypeDefinition) => void;
  onCancel: () => void;
  onOpenPlugins: () => void;
}) {
  const copy = COPY[locale];
  const [query, setQuery] = useState('');
  const matches = (type: ActionTypeDefinition): boolean =>
    !query.trim() || type.title[locale].toLowerCase().includes(query.trim().toLowerCase());

  const installed = plugins.filter((plugin) => plugin.installed && plugin.enabled);

  return (
    <div className="plg">
      <div className="plg-topbar">
        <button type="button" className="plg-btn plg-btn--icon" onClick={onCancel} aria-label={copy.back}>‹</button>
        <div className="plg-topbar__text">
          <h2 className="plg-topbar__title">{copy.pickTitle}</h2>
          <span className="plg-topbar__subtitle">{copy.pickLead}</span>
        </div>
        <div className="plg-topbar__actions">
          <button type="button" className="plg-btn plg-btn--sm" onClick={onOpenPlugins}>{copy.explore}</button>
        </div>
      </div>

      <div className="plg-toolbar">
        <input
          className="plg-input"
          type="search"
          value={query}
          placeholder={copy.searchAction}
          onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)}
        />
      </div>

      <div className="plg-scroll">
        <div className="plg-section">
          <div className="plg-group-head">
            <span className="plg-section-title">{copy.builtInGroup}</span>
            <span className="plg-group-note">{copy.builtInNote}</span>
          </div>
          <div className="plg-cards">
            {BUILTIN_ACTION_TYPES.filter(matches).map((type) => (
              <ActionTypeCard key={type.id} locale={locale} type={type} onPick={() => onPick(type)} />
            ))}
          </div>
        </div>

        {installed.map((plugin) => {
          const types = actionTypesForPlugin(plugin.descriptor.id).filter(matches);
          if (types.length === 0) return null;
          return (
            <div className="plg-section" key={plugin.descriptor.id}>
              <div className="plg-group-head">
                <span className="plg-section-title">{plugin.descriptor.name}</span>
                <span className="plg-pill">{copy.pluginNote}</span>
                <span className="plg-group-note">
                  {plugin.descriptor.dependency[locale]} · {types.length}
                </span>
              </div>
              <div className="plg-cards">
                {types.map((type) => (
                  <ActionTypeCard key={type.id} locale={locale} type={type} onPick={() => onPick(type)} />
                ))}
              </div>
            </div>
          );
        })}

        <div className="plg-section">
          <div className="plg-advanced">
            <div className="plg-field">
              <span className="plg-action-card__title">{copy.missingTitle}</span>
              <span className="plg-action-card__desc">{copy.missingDesc}</span>
            </div>
            <button type="button" className="plg-btn plg-btn--primary plg-btn--sm" onClick={onOpenPlugins}>
              {copy.explore}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActionTypeCard({
  locale,
  type,
  onPick,
}: {
  locale: Locale;
  type: ActionTypeDefinition;
  onPick: () => void;
}) {
  return (
    <button type="button" className="plg-action-card" onClick={onPick}>
      <span className="plg-action-card__head">
        <span className="plg-action-card__title">{type.title[locale]}</span>
        <span className="plg-pill plg-pill--mono">{type.tag}</span>
      </span>
      <span className="plg-action-card__desc">{type.description[locale]}</span>
    </button>
  );
}

function ActionEditor({
  locale,
  action,
  isNew,
  error,
  testRuns,
  onCancel,
  onSave,
  onDelete,
  onTest,
}: {
  locale: Locale;
  action: LiveAction;
  isNew: boolean;
  error?: string;
  testRuns: BehaviorRun[];
  onCancel: () => void;
  onSave: (action: LiveAction) => void;
  onDelete: (id: string) => void;
  onTest: (action: LiveAction, trigger?: AutomationEventType) => void;
}) {
  const copy = COPY[locale];
  const [draft, setDraft] = useState<LiveAction>(action);
  const type = findActionType(draft.typeId);
  const permissions = deriveActionPermissions(draft);
  const testRun = testRuns.find((run) => run.actionId === draft.id) ?? testRuns[0];

  const basicFields = (type?.fields ?? []).filter((field) => !field.advanced);
  const advancedFields = (type?.fields ?? []).filter((field) => field.advanced);

  const setField = (key: string, value: string): void =>
    setDraft((current) => ({ ...current, config: { ...current.config, [key]: value } }));
  const setMap = (key: string, value: Record<string, string>): void =>
    setDraft((current) => ({ ...current, config: { ...current.config, [key]: value as JsonObject } }));

  const renderField = (field: ActionField) => (
    <ActionFieldInput
      key={field.key}
      locale={locale}
      field={field}
      value={readString(draft.config[field.key])}
      entries={readStringMap(draft.config[field.key])}
      onChange={(value) => setField(field.key, value)}
      onChangeMap={(value) => setMap(field.key, value)}
    />
  );

  return (
    <div className="plg">
      <div className="plg-topbar">
        <button type="button" className="plg-btn plg-btn--icon" onClick={onCancel} aria-label={copy.back}>‹</button>
        <div className="plg-topbar__text">
          <h2 className="plg-topbar__title">{draft.name || copy.newAction}</h2>
          <span className="plg-topbar__subtitle plg-mono">
            {type ? `${originLabel(type, locale, copy.builtIn)} · ${type.tag}` : draft.typeId}
          </span>
        </div>
        <div className="plg-topbar__actions">
          {!isNew && (
            <button
              type="button"
              className="plg-btn plg-btn--danger plg-btn--sm"
              onClick={() => {
                if (confirm(copy.confirmDeleteAction)) onDelete(draft.id);
              }}
            >
              {copy.remove}
            </button>
          )}
          <button type="button" className="plg-btn plg-btn--primary plg-btn--sm" onClick={() => onSave(draft)}>
            {copy.save}
          </button>
        </div>
      </div>

      <div className="plg-scroll">
        <div className="plg-form">
          <div className="plg-form__main">
            {error && <div className="plg-alert">{error}</div>}

            <div className="plg-field">
              <div className="plg-label-row">
                <label className="plg-label">{copy.name}</label>
                {type && <InfoTip text={type.description[locale]} position="right" />}
              </div>
              <input
                className="plg-input"
                value={draft.name}
                onInput={(event) => setDraft((current) => ({ ...current, name: (event.currentTarget as HTMLInputElement).value }))}
              />
            </div>

            {basicFields.map(renderField)}

            {advancedFields.length > 0 && (
              <details className="plg-details">
                <summary>{copy.advanced}</summary>
                <div className="plg-details__body">{advancedFields.map(renderField)}</div>
              </details>
            )}
          </div>

          <div className="plg-side">
            <div className="plg-panel">
              <div className="plg-panel__head">
                <span className="plg-section-title">{copy.permissions}</span>
                <InfoTip text={copy.permissionsHint} position="left" />
              </div>
              <div className="plg-kv">
                <span className="plg-kv__key">network</span>
                <span className="plg-kv__value">{permissions.network.join(', ') || copy.none}</span>
              </div>
              <div className="plg-kv">
                <span className="plg-kv__key">capabilities</span>
                <span className="plg-kv__value">{permissions.capabilities.join(', ') || copy.none}</span>
              </div>
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

function ActionFieldInput({
  locale,
  field,
  value,
  entries,
  onChange,
  onChangeMap,
}: {
  locale: Locale;
  field: ActionField;
  value: string;
  entries: Record<string, string>;
  onChange: (value: string) => void;
  onChangeMap: (entries: Record<string, string>) => void;
}) {
  const copy = COPY[locale];
  const label = (
    <div className="plg-label-row">
      <label className="plg-label">{field.label[locale]}</label>
      {field.hint && <InfoTip text={field.hint[locale]} position="right" />}
    </div>
  );

  if (field.kind === 'keyvalue') {
    const rows = Object.entries(entries);
    return (
      <div className="plg-field">
        {label}
        {rows.map(([key, entry]) => (
          <div className="plg-kv-row" key={key}>
            <input
              className="plg-input plg-input--mono plg-input--key"
              value={key}
              onChange={(event) => {
                const next: Record<string, string> = {};
                for (const [name, val] of rows) next[name === key ? (event.currentTarget as HTMLInputElement).value : name] = val;
                onChangeMap(next);
              }}
            />
            <input
              className="plg-input plg-input--mono"
              value={entry}
              onInput={(event) => onChangeMap({ ...entries, [key]: (event.currentTarget as HTMLInputElement).value })}
            />
            <button
              type="button"
              className="plg-btn plg-btn--icon plg-btn--danger"
              aria-label={copy.remove}
              onClick={() => {
                const next = { ...entries };
                delete next[key];
                onChangeMap(next);
              }}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className="plg-btn plg-btn--sm"
          onClick={() => onChangeMap({ ...entries, [`campo-${rows.length + 1}`]: '' })}
        >
          + {copy.addEntry}
        </button>
      </div>
    );
  }

  if (field.kind === 'boolean') {
    return (
      <div className="plg-switch-row">
        <button
          type="button"
          className={`plg-switch${value === 'true' ? ' is-on' : ''}`}
          aria-label={field.label[locale]}
          onClick={() => onChange(value === 'true' ? 'false' : 'true')}
        >
          <span className="plg-switch__track"><span className="plg-switch__thumb" /></span>
        </button>
        <label className="plg-label" onClick={() => onChange(value === 'true' ? 'false' : 'true')}>
          {field.label[locale]}
        </label>
        {field.hint && <InfoTip text={field.hint[locale]} position="right" />}
      </div>
    );
  }

  return (
    <div className="plg-field">
      {label}
      {field.kind === 'select' && (
        <select className="plg-select" value={value} onChange={(event) => onChange((event.currentTarget as HTMLSelectElement).value)}>
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>{option.label[locale]}</option>
          ))}
        </select>
      )}
      {(field.kind === 'textarea' || field.kind === 'code') && (
        <textarea
          className={`plg-textarea${field.kind === 'code' ? ' plg-textarea--code' : ''}`}
          rows={field.kind === 'code' ? 16 : 6}
          spellcheck={false}
          value={value}
          onInput={(event) => onChange((event.currentTarget as HTMLTextAreaElement).value)}
        />
      )}
      {(field.kind === 'text' || field.kind === 'number') && (
        <input
          className={`plg-input${field.template ? ' plg-input--mono' : ''}`}
          type={field.kind === 'number' ? 'number' : 'text'}
          value={value}
          placeholder={field.placeholder}
          onInput={(event) => onChange((event.currentTarget as HTMLInputElement).value)}
        />
      )}
    </div>
  );
}

function EventEditor({
  locale,
  event,
  isNew,
  actions,
  error,
  testRuns,
  onCancel,
  onSave,
  onDelete,
  onTest,
}: {
  locale: Locale;
  event: LiveEvent;
  isNew: boolean;
  actions: LiveAction[];
  error?: string;
  testRuns: BehaviorRun[];
  onCancel: () => void;
  onSave: (event: LiveEvent) => void;
  onDelete: (id: string) => void;
  onTest: (event: LiveEvent) => void;
}) {
  const copy = COPY[locale];
  const [draft, setDraft] = useState<LiveEvent>(event);
  const [step, setStep] = useState(1);

  const update = (patch: Partial<LiveEvent>): void => setDraft((current) => ({ ...current, ...patch }));
  const updateFilter = (index: number, patch: Partial<EventFilter>): void =>
    setDraft((current) => ({
      ...current,
      filters: current.filters.map((filter, position) => (position === index ? { ...filter, ...patch } : filter)),
    }));

  const suggestions = [...(FIELDS_BY_TRIGGER[draft.trigger] ?? []), ...COMMON_FIELDS];
  const chosenNames = draft.actionIds
    .map((id) => actions.find((action) => action.id === id)?.name)
    .filter((name): name is string => Boolean(name));

  const steps = [
    { number: 1, label: copy.stepWhen, sub: TRIGGER_LABELS[draft.trigger][locale] },
    {
      number: 2,
      label: copy.stepFilters,
      sub: draft.filters.length === 0
        ? copy.alwaysShort
        : draft.filters.map((filter) => describeFilter(filter, locale)).join(' · '),
    },
    { number: 3, label: copy.stepDo, sub: chosenNames.length === 0 ? copy.noneYet : chosenNames.join(' · ') },
  ];

  return (
    <div className="plg">
      <div className="plg-topbar">
        <button type="button" className="plg-btn plg-btn--icon" onClick={onCancel} aria-label={copy.back}>‹</button>
        <div className="plg-topbar__text">
          <h2 className="plg-topbar__title">{draft.name || copy.newEvent}</h2>
          <span className="plg-topbar__subtitle plg-mono">{copy.stepOf(step)} · {draft.trigger}</span>
        </div>
        <div className="plg-topbar__actions">
          {!isNew && (
            <button
              type="button"
              className="plg-btn plg-btn--danger plg-btn--sm"
              onClick={() => {
                if (confirm(copy.confirmDeleteEvent)) onDelete(draft.id);
              }}
            >
              {copy.remove}
            </button>
          )}
          <button type="button" className="plg-btn plg-btn--primary plg-btn--sm" onClick={() => onSave(draft)}>
            {copy.save}
          </button>
        </div>
      </div>

      <div className="plg-scroll">
        <div className="plg-form">
          <div className="plg-form__main">
            {error && <div className="plg-alert">{error}</div>}

            <p className="plg-sentence">{sentenceFor(draft, actions, locale)}</p>

            <div className="plg-steps">
              {steps.map((entry) => (
                <button
                  type="button"
                  key={entry.number}
                  className={`plg-steps__item${step === entry.number ? ' is-active' : ''}${step > entry.number ? ' is-done' : ''}`}
                  onClick={() => setStep(entry.number)}
                >
                  <span className="plg-step__number">{entry.number}</span>
                  <span className="plg-steps__text">
                    <span className="plg-steps__label">{entry.label}</span>
                    <span className="plg-steps__sub">{entry.sub}</span>
                  </span>
                </button>
              ))}
            </div>

            {step === 1 && (
              <div className="plg-step__body">
                <div className="plg-inline">
                  <div className="plg-field">
                    <label className="plg-label">{copy.trigger}</label>
                    <select
                      className="plg-select"
                      value={draft.trigger}
                      onChange={(node) => update({ trigger: (node.currentTarget as HTMLSelectElement).value as AutomationEventType })}
                    >
                      {BEHAVIOR_TRIGGERS.map((trigger) => (
                        <option key={trigger} value={trigger}>{TRIGGER_LABELS[trigger][locale]}</option>
                      ))}
                    </select>
                  </div>
                  <div className="plg-field">
                    <label className="plg-label">{copy.name}</label>
                    <input
                      className="plg-input"
                      value={draft.name}
                      onInput={(node) => update({ name: (node.currentTarget as HTMLInputElement).value })}
                    />
                  </div>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="plg-step__body">
                <div className="plg-label-row">
                  <span className="plg-label">{copy.stepFiltersHint}</span>
                  <InfoTip text={copy.orHint} position="right" />
                </div>

                <datalist id="behavior-fields">
                  {suggestions.map((path) => <option value={path} key={path} />)}
                </datalist>

                {draft.filters.length === 0 && <span className="plg-note">{copy.noFilters}</span>}

                {draft.filters.map((filter, index) => (
                  <div className="plg-filter" key={`${index}-${filter.path}`}>
                    <span className="plg-filter__lead">{index === 0 ? copy.stepFilters : locale === 'es' ? 'y además…' : 'and also…'}</span>
                    <div className="plg-filter__controls">
                      <input
                        className="plg-input plg-input--mono"
                        list="behavior-fields"
                        value={filter.path}
                        placeholder="event.data.diamondCount"
                        onInput={(node) => updateFilter(index, { path: (node.currentTarget as HTMLInputElement).value })}
                      />
                      <select
                        className="plg-select"
                        value={filter.operator}
                        onChange={(node) => {
                          const operator = (node.currentTarget as HTMLSelectElement).value as FilterOperator;
                          updateFilter(index, { operator, values: operator === 'in' ? filter.values ?? [] : undefined });
                        }}
                      >
                        {OPERATOR_LABELS.map((operator) => (
                          <option key={operator.id} value={operator.id}>{operator[locale]}</option>
                        ))}
                      </select>
                      {filter.operator !== 'in' && filter.operator !== 'is-true' && filter.operator !== 'is-false' && (
                        <input
                          className="plg-input"
                          value={filter.value}
                          onInput={(node) => updateFilter(index, { value: (node.currentTarget as HTMLInputElement).value })}
                        />
                      )}
                      <button
                        type="button"
                        className="plg-iconbtn is-danger"
                        aria-label={copy.remove}
                        data-tooltip={copy.remove}
                        onClick={() => update({ filters: draft.filters.filter((_, position) => position !== index) })}
                      >
                        <IconTrash />
                      </button>
                    </div>

                    {filter.operator === 'in' && (
                      <ValueList
                        locale={locale}
                        values={filter.values ?? []}
                        onChange={(values) => updateFilter(index, { values })}
                      />
                    )}
                  </div>
                ))}

                <button
                  type="button"
                  className="plg-dashed"
                  onClick={() => update({
                    filters: [...draft.filters, { path: suggestions[0] ?? 'event.user.uniqueId', operator: 'gte', value: '' }],
                  })}
                >
                  {copy.addFilter}
                </button>
              </div>
            )}

            {step === 3 && (
              <div className="plg-step__body">
                <span className="plg-label">{copy.pickActions}</span>
                <div className="plg-chips" style="flex-wrap: wrap;">
                  {actions.map((action) => {
                    const active = draft.actionIds.includes(action.id);
                    return (
                      <button
                        type="button"
                        key={action.id}
                        className={`plg-chip${active ? ' is-active' : ''}`}
                        onClick={() => update({
                          actionIds: active
                            ? draft.actionIds.filter((id) => id !== action.id)
                            : [...draft.actionIds, action.id],
                        })}
                      >
                        {action.name}
                      </button>
                    );
                  })}
                  {actions.length === 0 && <span className="plg-note">{copy.noActionsYet}</span>}
                </div>

                <div className="plg-switch-row">
                  <button
                    type="button"
                    className={`plg-switch${draft.runMode === 'random' ? ' is-on' : ''}`}
                    aria-label={copy.runMode}
                    onClick={() => update({ runMode: draft.runMode === 'random' ? 'all' : 'random' })}
                  >
                    <span className="plg-switch__track"><span className="plg-switch__thumb" /></span>
                  </button>
                  <label
                    className="plg-label"
                    onClick={() => update({ runMode: draft.runMode === 'random' ? 'all' : 'random' })}
                  >
                    {copy.runMode}
                  </label>
                </div>

                <div className="plg-inline">
                  <div className="plg-field">
                    <label className="plg-label">{copy.cooldown}</label>
                    <select
                      className="plg-select"
                      value={String(draft.cooldownMs)}
                      onChange={(node) => update({ cooldownMs: Number((node.currentTarget as HTMLSelectElement).value) })}
                    >
                      {COOLDOWN_CHOICES.map((ms) => (
                        <option key={ms} value={String(ms)}>{ms === 0 ? copy.noCooldown : `${ms / 1000} s`}</option>
                      ))}
                    </select>
                  </div>
                  <div className="plg-field">
                    <div className="plg-label-row">
                      <label className="plg-label">{copy.cooldownScope}</label>
                      <InfoTip
                        text={locale === 'es'
                          ? 'Por usuario: la espera cuenta para cada espectador. Global: una sola espera para todos.'
                          : 'Per viewer: the cooldown counts per person. Global: one cooldown for everyone.'}
                        position="left"
                      />
                    </div>
                    <select
                      className="plg-select"
                      value={draft.cooldownScope}
                      onChange={(node) => update({ cooldownScope: (node.currentTarget as HTMLSelectElement).value === 'global' ? 'global' : 'user' })}
                    >
                      <option value="user">{copy.perUser}</option>
                      <option value="global">{copy.global}</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            <div className="plg-nav">
              <button
                type="button"
                className="plg-btn plg-btn--sm"
                disabled={step === 1}
                onClick={() => setStep((current) => Math.max(1, current - 1))}
              >
                {copy.previous}
              </button>
              <span className="plg-nav__spacer" />
              {step < 3 ? (
                <button
                  type="button"
                  className="plg-btn plg-btn--primary plg-btn--sm"
                  onClick={() => setStep((current) => Math.min(3, current + 1))}
                >
                  {copy.next}
                </button>
              ) : (
                <button type="button" className="plg-btn plg-btn--primary plg-btn--sm" onClick={() => onSave(draft)}>
                  {copy.finish}
                </button>
              )}
            </div>
          </div>

          <div className="plg-side">
            <button type="button" className="plg-btn plg-btn--block" onClick={() => onTest(draft)}>
              {copy.test}
            </button>
            {testRuns.map((run) => (
              <div className={`plg-panel ${run.status === 'error' ? 'plg-panel--err' : 'plg-panel--ok'}`} key={run.id}>
                <span className="plg-row__name">{run.actionName}</span>
                <span className="plg-mono">{run.error ?? run.summary}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ValueList({
  locale,
  values,
  onChange,
}: {
  locale: Locale;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const copy = COPY[locale];
  const [draft, setDraft] = useState('');

  return (
    <div className="plg-values">
      {values.map((value, index) => (
        <span className="plg-value" key={`${value}-${index}`}>
          {value}
          <button type="button" onClick={() => onChange(values.filter((_, position) => position !== index))}>×</button>
        </span>
      ))}
      <input
        className="plg-input plg-input--key"
        value={draft}
        placeholder={copy.addValue}
        onInput={(event) => setDraft((event.currentTarget as HTMLInputElement).value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || !draft.trim()) return;
          event.preventDefault();
          onChange([...values, draft.trim()]);
          setDraft('');
        }}
      />
    </div>
  );
}

function availableActionTypes(plugins: PluginStatus[]): Set<string> {
  const ids = new Set<string>();
  for (const type of BUILTIN_ACTION_TYPES) ids.add(type.id);
  for (const plugin of plugins) {
    if (!plugin.installed || !plugin.enabled) continue;
    for (const id of plugin.descriptor.actionTypeIds) ids.add(id);
  }
  return ids;
}

function createActionFromType(type: ActionTypeDefinition, locale: Locale): LiveAction {
  const config: JsonObject = {};
  for (const field of type.fields) {
    config[field.key] = field.kind === 'keyvalue' ? parseKeyValueDefault(field.value) : field.value;
  }
  return {
    schemaVersion: 1,
    id: createActionId(),
    name: type.title[locale],
    typeId: type.id,
    enabled: true,
    config,
  };
}

function parseKeyValueDefault(value: string): JsonObject {
  const entries: JsonObject = {};
  for (const line of value.split('\n')) {
    const index = line.indexOf('=');
    if (index <= 0) continue;
    entries[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return entries;
}

function createEvent(locale: Locale): LiveEvent {
  return {
    schemaVersion: 1,
    id: createEventId(),
    name: locale === 'es' ? 'Evento nuevo' : 'New event',
    enabled: false,
    trigger: 'tiktok.gift',
    filters: [],
    cooldownMs: 0,
    cooldownScope: 'user',
    actionIds: [],
    runMode: 'all',
  };
}

function originLabel(type: ActionTypeDefinition, locale: Locale, builtInLabel: string): string {
  const source = type.source;
  if (source.kind === 'builtin') return builtInLabel;
  const descriptor = PLUGIN_DESCRIPTORS.find((plugin) => plugin.id === source.pluginId);
  return descriptor?.name ?? source.pluginId;
}

function describeAction(action: LiveAction): string {
  switch (action.typeId) {
    case 'core.fetch': {
      const url = readString(action.config.url).replace(/^https?:\/\//, '').split('/')[0] ?? '';
      return `${readString(action.config.method)} ${url}`;
    }
    case 'core.emit':
      return `emit ${readString(action.config.type)}`;
    case 'core.points':
      return `${readString(action.config.delta)} · ${readString(action.config.uniqueId)}`;
    case 'core.delay':
      return `${readString(action.config.ms)} ms`;
    case 'core.log':
      return readString(action.config.message);
    case 'audio.play':
      return readString(action.config.file);
    case 'tts.speak':
      return readString(action.config.text);
    default:
      return action.typeId;
  }
}

function describeFilter(filter: EventFilter, locale: Locale): string {
  const operator = OPERATOR_LABELS.find((entry) => entry.id === filter.operator)?.[locale] ?? filter.operator;
  const field = filter.path.replace(/^event\.(data|user)\./, '');
  if (filter.operator === 'in') return `${field} ${operator} ${(filter.values ?? []).join(', ')}`;
  if (filter.operator === 'is-true' || filter.operator === 'is-false') return `${field} ${operator}`;
  return `${field} ${operator} ${filter.value}`;
}

function sentenceFor(event: LiveEvent, actions: LiveAction[], locale: Locale): string {
  const trigger = TRIGGER_LABELS[event.trigger][locale].toLowerCase();
  const filters = event.filters.map((filter) => describeFilter(filter, locale));
  const names = event.actionIds
    .map((id) => actions.find((action) => action.id === id)?.name)
    .filter((name): name is string => Boolean(name));

  const join = (items: string[]): string => {
    if (items.length === 0) return '—';
    if (items.length === 1) return items[0] as string;
    const last = items[items.length - 1] as string;
    return `${items.slice(0, -1).join(', ')} ${locale === 'es' ? 'y' : 'and'} ${last}`;
  };

  if (locale === 'es') {
    const condition = filters.length ? ` y ${join(filters)}` : '';
    const what = event.runMode === 'random' ? `una de: ${join(names)}` : join(names);
    return `Cuando ${trigger}${condition}, ejecuta ${what}.`;
  }

  const condition = filters.length ? ` and ${join(filters)}` : '';
  const what = event.runMode === 'random' ? `one of: ${join(names)}` : join(names);
  return `When ${trigger}${condition}, run ${what}.`;
}

function relativeTime(timestamp: number, locale: Locale): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 5) return locale === 'es' ? 'ahora' : 'now';
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.round(minutes / 60)} h`;
}
