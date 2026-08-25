import { useMemo, useState } from 'preact/hooks';

import { IconPencil, IconTrash } from '../components/icons.tsx';
import { ConditionTable } from '../components/ui/ConditionTable.tsx';
import { OPERATOR_LABELS } from '../components/condition-icons.tsx';
import { IconSelect } from '../components/ui/IconSelect.tsx';
import { findField } from '../../automation/behavior/fields.ts';

import { defaultActionConfig } from '../../automation/behavior/action-config.ts';
import { schemaForAction } from '../components/ui/SchemaForm.tsx';
import { SchemaForm } from '../components/ui/SchemaForm.tsx';
import {
  BEHAVIOR_TRIGGERS,
  createActionId,
  createEventId,
  deriveActionPermissions,
  readString,
} from '../../automation/behavior/schema.ts';
import type {
  ActionTypeDefinition,
  BehaviorRun,
  BehaviorSnapshot,
  EventFilter,
  FilterOperator,
  LiveAction,
  LiveEvent,
  I18nText,
  PluginStatus,
} from '../../automation/behavior/types.ts';
import type { AutomationEventType } from '../../automation/types.ts';
import { InfoTip } from '../components/ui/InfoTip.tsx';
import type { GiftCatalogEntry, ViewerRecord } from '../../shared/messages.ts';
import { i18nText, t, type Locale } from '../i18n.ts';

type BehaviorViewProps = {
  locale: Locale;
  snapshot: BehaviorSnapshot;
  /** Sources for the value pickers: the room's gifts and the known viewers. */
  gifts: GiftCatalogEntry[];
  viewers: ViewerRecord[];
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

/** Both tables sort the same four ways, from the header or from the control. */
type SortMode = 'name' | 'name-desc' | 'enabled' | 'disabled';

type Screen =
  | { kind: 'list' }
  | { kind: 'picker' }
  | { kind: 'action'; action: LiveAction; isNew: boolean }
  | { kind: 'event'; event: LiveEvent; isNew: boolean };

const COPY = {
  title: { default: "Behavior", i18key: "behavior.copy.title" },
  lead: { default: "What can happen on top, when it happens below. One action is reused by several events.", i18key: "behavior.copy.lead" },
  actions: { default: "Actions", i18key: "behavior.copy.actions" },
  events: { default: "Events", i18key: "behavior.copy.events" },
  newAction: { default: "New action", i18key: "behavior.copy.newAction" },
  newEvent: { default: "New event", i18key: "behavior.copy.newEvent" },
  searchAction: { default: "Search action", i18key: "behavior.copy.searchAction" },
  searchEvent: { default: "Search event", i18key: "behavior.copy.searchEvent" },
  sortBy: { default: "Sort", i18key: "behavior.copy.sortBy" },
  sortName: { default: "Name A-Z", i18key: "behavior.copy.sortName" },
  sortNameDesc: { default: "Name Z-A", i18key: "behavior.copy.sortNameDesc" },
  sortActive: { default: "Active first", i18key: "behavior.copy.sortActive" },
  sortInactive: { default: "Inactive first", i18key: "behavior.copy.sortInactive" },
  colActive: { default: "Active", i18key: "behavior.copy.colActive" },
  colName: { default: "Name", i18key: "behavior.copy.colName" },
  colOrigin: { default: "Source", i18key: "behavior.copy.colOrigin" },
  colDoes: { default: "What it does", i18key: "behavior.copy.colDoes" },
  colLast: { default: "Last run", i18key: "behavior.copy.colLast" },
  colTrigger: { default: "Trigger", i18key: "behavior.copy.colTrigger" },
  colFilters: { default: "Conditions", i18key: "behavior.copy.colFilters" },
  colActions: { default: "Actions", i18key: "behavior.copy.colActions" },
  builtIn: { default: "Built-in", i18key: "behavior.copy.builtIn" },
  noActions: { default: "No actions yet. Start with a built-in one: call a URL, emit an event, give points.", i18key: "behavior.copy.noActions" },
  noEvents: { default: "No events yet. An event decides when your actions run.", i18key: "behavior.copy.noEvents" },
  noRuns: { default: "No runs", i18key: "behavior.copy.noRuns" },
  paused: { default: "Paused", i18key: "behavior.copy.paused" },
  always: { default: "always", i18key: "behavior.copy.always" },
  runs: { default: "Recent runs", i18key: "behavior.copy.runs" },
  runsEmpty: { default: "No runs yet.", i18key: "behavior.copy.runsEmpty" },
  pickTitle: { default: "Pick an action type", i18key: "behavior.copy.pickTitle" },
  pickLead: { default: "Built-in ones depend on nothing. The rest come from an installed plugin.", i18key: "behavior.copy.pickLead" },
  builtInGroup: { default: "Built-in", i18key: "behavior.copy.builtInGroup" },
  builtInNote: { default: "always available · no dependencies", i18key: "behavior.copy.builtInNote" },
  pluginNote: { default: "plugin", i18key: "behavior.copy.pluginNote" },
  explore: { default: "Browse plugins", i18key: "behavior.copy.explore" },
  missingTitle: { default: "Missing an action?", i18key: "behavior.copy.missingTitle" },
  missingDesc: { default: "Anything needing a dependency — audio, voice, OBS — arrives by installing a plugin. Each one may add several.", i18key: "behavior.copy.missingDesc" },
  back: { default: "Back", i18key: "behavior.copy.back" },
  save: { default: "Save", i18key: "behavior.copy.save" },
  remove: { default: "Delete", i18key: "behavior.copy.remove" },
  edit: { default: "Edit", i18key: "behavior.copy.edit" },
  test: { default: "Run test", i18key: "behavior.copy.test" },
  name: { default: "Name", i18key: "behavior.copy.name" },
  permissions: { default: "Permissions", i18key: "behavior.copy.permissions" },
  permissionsHint: { default: "Derived from what you fill in; the engine refuses any destination outside the list.", i18key: "behavior.copy.permissionsHint" },
  none: { default: "none", i18key: "behavior.copy.none" },
  console: { default: "Console", i18key: "behavior.copy.console" },
  consoleEmpty: { default: "Waiting for a run…", i18key: "behavior.copy.consoleEmpty" },
  stepWhen: { default: "When", i18key: "behavior.copy.stepWhen" },
  stepFilters: { default: "Only if…", i18key: "behavior.copy.stepFilters" },
  stepFiltersHint: { default: "optional · all must pass", i18key: "behavior.copy.stepFiltersHint" },
  stepDo: { default: "What it does", i18key: "behavior.copy.stepDo" },
  trigger: { default: "Event", i18key: "behavior.copy.trigger" },
  addFilter: { default: "+ Add condition", i18key: "behavior.copy.addFilter" },
  orHint: { default: "Need an \"or\"? Use \"is one of\" inside the condition.", i18key: "behavior.copy.orHint" },
  noFilters: { default: "No conditions: the event always fires.", i18key: "behavior.copy.noFilters" },
  field: { default: "Field", i18key: "behavior.copy.field" },
  operator: { default: "Comparison", i18key: "behavior.copy.operator" },
  value: { default: "Value", i18key: "behavior.copy.value" },
  addValue: { default: "Add value", i18key: "behavior.copy.addValue" },
  runMode: { default: "Run only one, at random", i18key: "behavior.copy.runMode" },
  cooldown: { default: "Cooldown", i18key: "behavior.copy.cooldown" },
  cooldownScope: { default: "Scope", i18key: "behavior.copy.cooldownScope" },
  perUser: { default: "per viewer", i18key: "behavior.copy.perUser" },
  global: { default: "global", i18key: "behavior.copy.global" },
  noCooldown: { default: "no cooldown", i18key: "behavior.copy.noCooldown" },
  pickActions: { default: "Tick the actions it runs", i18key: "behavior.copy.pickActions" },
  noActionsYet: { default: "Create an action first.", i18key: "behavior.copy.noActionsYet" },
  confirmDeleteAction: { default: "Delete this action? Events using it will stop running it.", i18key: "behavior.copy.confirmDeleteAction" },
  confirmDeleteEvent: { default: "Delete this event?", i18key: "behavior.copy.confirmDeleteEvent" },
  pluginMissing: { default: "plugin not installed", i18key: "behavior.copy.pluginMissing" },
  advanced: { default: "Advanced options", i18key: "behavior.copy.advanced" },
  addEntry: { default: "Add", i18key: "behavior.copy.addEntry" },
  next: { default: "Continue", i18key: "behavior.copy.next" },
  previous: { default: "Back", i18key: "behavior.copy.previous" },
  finish: { default: "Save event", i18key: "behavior.copy.finish" },
  noneYet: { default: "not set", i18key: "behavior.copy.noneYet" },
  alwaysShort: { default: "always", i18key: "behavior.copy.alwaysShort" },
  stepOf: { default: "Step {step} of 3", i18key: "behavior.copy.stepOf" },
} as const;

type BehaviorCopy = { -readonly [Key in keyof typeof COPY]: string };

function copyFor(locale: Locale): BehaviorCopy {
  const copy = {} as BehaviorCopy;
  for (const [key, value] of Object.entries(COPY)) copy[key as keyof typeof COPY] = i18nText(locale, value);
  return copy;
}

const TRIGGER_LABELS: Record<AutomationEventType, I18nText> = {
  "tiktok.chat": { default: "Someone comments", i18key: "behavior.trigger.tiktok.chat" },
  "tiktok.gift": { default: "Someone sends a gift", i18key: "behavior.trigger.tiktok.gift" },
  "tiktok.like": { default: "Someone likes", i18key: "behavior.trigger.tiktok.like" },
  "tiktok.follow": { default: "Someone follows", i18key: "behavior.trigger.tiktok.follow" },
  "tiktok.share": { default: "Someone shares", i18key: "behavior.trigger.tiktok.share" },
  "tiktok.join": { default: "Someone joins the live", i18key: "behavior.trigger.tiktok.join" },
  "tiktok.social": { default: "Social action", i18key: "behavior.trigger.tiktok.social" },
  "tiktok.room_stats": { default: "Room stats", i18key: "behavior.trigger.tiktok.room_stats" },
  "tiktok.connected": { default: "Connected", i18key: "behavior.trigger.tiktok.connected" },
  "tiktok.disconnected": { default: "Disconnected", i18key: "behavior.trigger.tiktok.disconnected" },
  "points.awarded": { default: "Points awarded", i18key: "behavior.trigger.points.awarded" },
  "plugin.emit": { default: "Internal event", i18key: "behavior.trigger.plugin.emit" },
};

const COOLDOWN_CHOICES = [0, 3_000, 5_000, 10_000, 30_000, 60_000];

export function BehaviorView(props: BehaviorViewProps) {
  const { locale, snapshot, runs, testRuns, error } = props;
  const copy = copyFor(locale);
  const [screen, setScreen] = useState<Screen>({ kind: 'list' });
  const [actionQuery, setActionQuery] = useState('');
  const [eventQuery, setEventQuery] = useState('');
  const [actionSort, setActionSort] = useState<SortMode>('name');
  const [eventSort, setEventSort] = useState<SortMode>('name');

  const lastRunByAction = useMemo(() => {
    const map = new Map<string, BehaviorRun>();
    for (const run of runs) {
      if (run.test || !run.actionId) continue;
      if (!map.has(run.actionId)) map.set(run.actionId, run);
    }
    return map;
  }, [runs]);

  const availableTypes = useMemo(() => availableActionTypes(snapshot.plugins, snapshot.actionTypes), [snapshot.plugins, snapshot.actionTypes]);

  if (screen.kind === 'picker') {
    return (
      <ActionPicker
        locale={locale}
        plugins={snapshot.plugins}
        onCancel={() => setScreen({ kind: 'list' })}
        onOpenPlugins={props.onOpenPlugins}
        actionTypes={snapshot.actionTypes}
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
        actionTypes={snapshot.actionTypes}
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
        gifts={props.gifts}
        viewers={props.viewers}
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

  const sortRows = <T extends { name: string; enabled: boolean }>(rows: T[], sort: SortMode): T[] =>
    [...rows].sort((left, right) => {
      if (sort === 'enabled' || sort === 'disabled') {
        const delta = Number(right.enabled) - Number(left.enabled);
        if (delta !== 0) return sort === 'enabled' ? delta : -delta;
        return left.name.localeCompare(right.name);
      }
      const byName = left.name.localeCompare(right.name);
      return sort === 'name-desc' ? -byName : byName;
    });

  const visibleActions = snapshot.actions.filter((action) =>
    !actionQuery.trim() || action.name.toLowerCase().includes(actionQuery.trim().toLowerCase()));
  const visibleEvents = snapshot.events.filter((event) =>
    !eventQuery.trim()
    || event.name.toLowerCase().includes(eventQuery.trim().toLowerCase())
    || event.trigger.includes(eventQuery.trim().toLowerCase()));
  const sortedActions = sortRows(visibleActions, actionSort);
  const sortedEvents = sortRows(visibleEvents, eventSort);

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
                <SortControl locale={locale} value={actionSort} onChange={setActionSort} />
                <button type="button" className="plg-btn plg-btn--primary plg-btn--sm" onClick={() => setScreen({ kind: 'picker' })}>
                  {copy.newAction}
                </button>
              </div>
            </div>

            <div className="plg-table plg-table--actions">
              <div className="plg-table__head">
                <SortHeader
                  label={copy.colActive}
                  sort={actionSort}
                  onSort={setActionSort}
                  by="enabled"
                />
                <SortHeader label={copy.colName} sort={actionSort} onSort={setActionSort} by="name" />
                <span>{copy.colOrigin}</span>
                <span>{copy.colDoes}</span>
                <span>{copy.colLast}</span>
                <span />
              </div>

              {sortedActions.map((action) => {
                const type = snapshot.actionTypes.find((entry) => entry.id === action.typeId);
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
                <SortControl locale={locale} value={eventSort} onChange={setEventSort} />
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
                <SortHeader label={copy.colActive} sort={eventSort} onSort={setEventSort} by="enabled" />
                <SortHeader label={copy.colName} sort={eventSort} onSort={setEventSort} by="name" />
                <span>{copy.colTrigger}</span>
                <span>{copy.colFilters}</span>
                <span>{copy.colActions}</span>
                <span />
              </div>

              {sortedEvents.map((event) => (
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
                  <span className="plg-table__origin">{i18nText(locale, TRIGGER_LABELS[event.trigger])}</span>
                  <span className="plg-table__chips">
                    {event.filters.length === 0 && <span className="plg-pill">{copy.always}</span>}
                    {event.filters.map((filter, index) => (
                      <span className="plg-pill plg-pill--mono" key={`${filter.path}-${index}`}>
                        {describeFilter(filter, locale, event.trigger)}
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
  actionTypes,
  onPick,
  onCancel,
  onOpenPlugins,
}: {
  locale: Locale;
  plugins: PluginStatus[];
  actionTypes: ActionTypeDefinition[];
  onPick: (type: ActionTypeDefinition) => void;
  onCancel: () => void;
  onOpenPlugins: () => void;
}) {
  const copy = copyFor(locale);
  const [query, setQuery] = useState('');
  const matches = (type: ActionTypeDefinition): boolean =>
    !query.trim() || i18nText(locale, type.title).toLowerCase().includes(query.trim().toLowerCase());

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
            {actionTypes.filter((type) => type.source.kind === 'builtin').filter(matches).map((type) => (
              <ActionTypeCard key={type.id} locale={locale} type={type} onPick={() => onPick(type)} />
            ))}
          </div>
        </div>

        {installed.map((plugin) => {
          const types = actionTypes.filter((type) => type.source.kind === 'plugin' && type.source.pluginId === plugin.descriptor.id).filter(matches);
          if (types.length === 0) return null;
          return (
            <div className="plg-section" key={plugin.descriptor.id}>
              <div className="plg-group-head">
                <span className="plg-section-title">{i18nText(locale, plugin.descriptor.name)}</span>
                <span className="plg-pill">{copy.pluginNote}</span>
                <span className="plg-group-note">
                  {i18nText(locale, plugin.descriptor.dependency)} · {types.length}
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
        <span className="plg-action-card__title">{i18nText(locale, type.title)}</span>
        <span className="plg-pill plg-pill--mono">{type.tag}</span>
      </span>
      <span className="plg-action-card__desc">{i18nText(locale, type.description)}</span>
    </button>
  );
}

function ActionEditor({
  locale,
  action,
  actionTypes,
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
  actionTypes: ActionTypeDefinition[];
  isNew: boolean;
  error?: string;
  testRuns: BehaviorRun[];
  onCancel: () => void;
  onSave: (action: LiveAction) => void;
  onDelete: (id: string) => void;
  onTest: (action: LiveAction, trigger?: AutomationEventType) => void;
}) {
  const copy = copyFor(locale);
  const [draft, setDraft] = useState<LiveAction>(action);
  const type = actionTypes.find((entry) => entry.id === draft.typeId);
  const permissions = deriveActionPermissions(draft);
  const testRun = testRuns.find((run) => run.actionId === draft.id) ?? testRuns[0];

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
                {type && <InfoTip text={i18nText(locale, type.description)} position="right" />}
              </div>
              <input
                className="plg-input"
                value={draft.name}
                onInput={(event) => setDraft((current) => ({ ...current, name: (event.currentTarget as HTMLInputElement).value }))}
              />
            </div>

            {type ? (() => {
              const form = schemaForAction(type);
              return <SchemaForm locale={locale} schema={form.schema} uiHints={form.uiHints} value={draft.config} onChange={(config) => setDraft((current) => ({ ...current, config }))} />;
            })() : <div className="plg-alert">{draft.typeId}</div>}
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

function EventEditor({
  locale,
  event,
  isNew,
  actions,
  gifts,
  viewers,
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
  gifts: GiftCatalogEntry[];
  viewers: ViewerRecord[];
  error?: string;
  testRuns: BehaviorRun[];
  onCancel: () => void;
  onSave: (event: LiveEvent) => void;
  onDelete: (id: string) => void;
  onTest: (event: LiveEvent) => void;
}) {
  const copy = copyFor(locale);
  const [draft, setDraft] = useState<LiveEvent>(event);
  const [step, setStep] = useState(1);

  const update = (patch: Partial<LiveEvent>): void => setDraft((current) => ({ ...current, ...patch }));
  const chosenNames = draft.actionIds
    .map((id) => actions.find((action) => action.id === id)?.name)
    .filter((name): name is string => Boolean(name));

  const steps = [
    { number: 1, label: copy.stepWhen, sub: i18nText(locale, TRIGGER_LABELS[draft.trigger]) },
    {
      number: 2,
      label: copy.stepFilters,
      sub: draft.filters.length === 0
        ? copy.alwaysShort
        : draft.filters.map((filter) => describeFilter(filter, locale, draft.trigger)).join(' · '),
    },
    { number: 3, label: copy.stepDo, sub: chosenNames.length === 0 ? copy.noneYet : chosenNames.join(' · ') },
  ];

  return (
    <div className="plg">
      <div className="plg-topbar">
        <button type="button" className="plg-btn plg-btn--icon" onClick={onCancel} aria-label={copy.back}>‹</button>
        <div className="plg-topbar__text">
          <h2 className="plg-topbar__title">{draft.name || copy.newEvent}</h2>
          <span className="plg-topbar__subtitle plg-mono">{t(locale, 'behavior.copy.stepOf', { step })} · {draft.trigger}</span>
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
                        <option key={trigger} value={trigger}>{i18nText(locale, TRIGGER_LABELS[trigger])}</option>
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

                <ConditionTable
                  locale={locale}
                  trigger={draft.trigger}
                  filters={draft.filters}
                  gifts={gifts}
                  viewers={viewers}
                  onChange={(filters) => update({ filters })}
                />
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

                {draft.actionIds.length > 1 && (
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
                )}

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
                  {draft.cooldownMs > 0 && (
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
                  )}
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

/** A clickable column header that toggles between its two directions. */
function SortHeader({
  label,
  sort,
  onSort,
  by,
}: {
  label: string;
  sort: SortMode;
  onSort: (sort: SortMode) => void;
  by: 'name' | 'enabled';
}) {
  const modes: SortMode[] = by === 'name' ? ['name', 'name-desc'] : ['enabled', 'disabled'];
  const index = modes.indexOf(sort);
  const active = index >= 0;

  return (
    <button
      type="button"
      className={`plg-sorth${active ? ' is-active' : ''}`}
      aria-label={label}
      onClick={() => onSort(modes[index === 0 ? 1 : 0]!)}
    >
      {label}
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {active && index === 1 ? <path d="m6 9 6 6 6-6" /> : <path d="m6 15 6-6 6 6" />}
      </svg>
    </button>
  );
}

/** The same four orders as the headers, for the card layout on narrow screens. */
function SortControl({
  locale,
  value,
  onChange,
}: {
  locale: Locale;
  value: SortMode;
  onChange: (sort: SortMode) => void;
}) {
  const copy = copyFor(locale);
  return (
    <IconSelect
      className="plg-sort"
      ariaLabel={copy.sortBy}
      value={value}
      onChange={(next) => onChange(next as SortMode)}
      options={[
        { value: 'name', label: copy.sortName, icon: <SortGlyph direction="up" /> },
        { value: 'name-desc', label: copy.sortNameDesc, icon: <SortGlyph direction="down" /> },
        { value: 'enabled', label: copy.sortActive, icon: <SortGlyph direction="dot" /> },
        { value: 'disabled', label: copy.sortInactive, icon: <SortGlyph direction="dot-off" /> },
      ]}
    />
  );
}

function SortGlyph({ direction }: { direction: 'up' | 'down' | 'dot' | 'dot-off' }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {direction === 'up' && <path d="M6 16V5m0 0L3 8m3-3 3 3M12 6h9M12 12h6M12 18h3" />}
      {direction === 'down' && <path d="M6 5v11m0 0 3-3m-3 3-3-3M12 6h9M12 12h6M12 18h3" />}
      {direction === 'dot' && <path d="M5 8h14M5 16h14" />}
      {direction === 'dot-off' && <path d="M5 8h14M5 16h14M4 4l16 16" />}
    </svg>
  );
}

function availableActionTypes(plugins: PluginStatus[], actionTypes: ActionTypeDefinition[]): Set<string> {
  const ids = new Set<string>();
  for (const type of actionTypes) if (type.source.kind === 'builtin') ids.add(type.id);
  for (const plugin of plugins) {
    if (!plugin.installed || !plugin.enabled) continue;
    for (const type of actionTypes) {
      if (type.source.kind === 'plugin' && type.source.pluginId === plugin.descriptor.id) ids.add(type.id);
    }
  }
  return ids;
}

function createActionFromType(type: ActionTypeDefinition, locale: Locale): LiveAction {
  const config = defaultActionConfig(type);
  return {
    schemaVersion: 2,
    id: createActionId(),
    name: i18nText(locale, type.title),
    typeId: type.id,
    enabled: true,
    config,
  };
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

function originLabel(type: ActionTypeDefinition, _locale: Locale, builtInLabel: string): string {
  const source = type.source;
  if (source.kind === 'builtin') return builtInLabel;
  return source.pluginId;
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

function describeFilter(filter: EventFilter, locale: Locale, trigger?: AutomationEventType): string {
  const operator = i18nText(locale, OPERATOR_LABELS[filter.operator]);
  const field = (trigger && findField(trigger, filter.path) && i18nText(locale, findField(trigger, filter.path)!.label))
    ?? filter.path.replace(/^event\.(data|user)\./, '');
  if (filter.operator === 'is-true' || filter.operator === 'is-false') return `${field} ${operator}`;
  // A filter with no value yet reads as an ellipsis instead of a dangling word.
  const value = filter.operator === 'in' ? (filter.values ?? []).join(', ') : filter.value;
  return `${field} ${operator} ${value || '…'}`;
}

function sentenceFor(event: LiveEvent, actions: LiveAction[], locale: Locale): string {
  const trigger = i18nText(locale, TRIGGER_LABELS[event.trigger]).toLowerCase();
  const filters = event.filters.map((filter) => describeFilter(filter, locale, event.trigger));
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
