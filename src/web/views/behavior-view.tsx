import { useEffect, useMemo, useState } from 'preact/hooks';

import { IconPencil, IconTrash } from '../components/icons.tsx';
import { ConditionTable } from '../components/ui/ConditionTable.tsx';
import { OPERATOR_LABELS } from '../components/condition-icons.tsx';
import { IconSelect } from '../components/ui/IconSelect.tsx';
import { findField } from '../../automation/behavior/fields.ts';

import { defaultActionConfig } from '../../automation/behavior/action-config.ts';
import { sampleEventFor } from '../../automation/behavior/samples.ts';
import { schemaForAction, useFieldSuggestions } from '../components/ui/SchemaForm.tsx';
import { SchemaForm } from '../components/ui/SchemaForm.tsx';
import { CodeEditor, formatJsonText } from '../components/ui/CodeEditor.tsx';
import { TemplateField } from '../components/node-editor/TemplateField.tsx';
import { PermissionCards, TestConsole } from '../components/ui/FieldPanels.tsx';
import {
  getFetchUrlTemplates,
  isLocalFetchUrl,
  type TemplateSuggestionScope,
} from '../components/node-editor/template-suggestions.ts';
import {
  BEHAVIOR_TRIGGERS,
  createActionId,
  createEventId,
  deriveActionPermissions,
  readString,
  readStringMap,
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
import type { AutomationEventType, JsonObject, JsonValue } from '../../automation/types.ts';
import { InfoTip } from '../components/ui/InfoTip.tsx';
import type { ActionOptionItem, GiftCatalogEntry, ViewerRecord } from '../../shared/messages.ts';
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
  /** On-demand option lists keyed by options source (e.g. `tts.voices`). */
  actionOptions: Record<string, ActionOptionItem[]>;
  onGetActionOptions: (source: string) => void;
};

/** Both tables sort the same four ways, from the header or from the control. */
type SortMode = 'name' | 'name-desc' | 'enabled' | 'disabled';

type Screen =
  | { kind: 'list' }
  | { kind: 'picker' }
  | { kind: 'action'; action: LiveAction; isNew: boolean }
  | { kind: 'event'; event: LiveEvent; isNew: boolean };

/** Fields whose select options come from the host on demand (`optionsFrom` in uiHints). */
function fieldsWithOptions(uiHints?: JsonObject): Array<{ key: string; source: string }> {
  if (!uiHints || typeof uiHints !== 'object' || Array.isArray(uiHints)) return [];
  const fields = uiHints.fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return [];
  const result: Array<{ key: string; source: string }> = [];
  for (const [key, hint] of Object.entries(fields as JsonObject)) {
    if (hint && typeof hint === 'object' && !Array.isArray(hint)) {
      const source = (hint as JsonObject).optionsFrom;
      if (typeof source === 'string' && /^[a-z][a-z0-9._-]{0,63}$/.test(source)) result.push({ key, source });
    }
  }
  return result;
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
        actionOptions={props.actionOptions}
        onGetActionOptions={props.onGetActionOptions}
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
          <h2 className="plg-topbar__title">{t(locale, 'behavior.copy.title')}</h2>
          <span className="plg-topbar__subtitle">{t(locale, 'behavior.copy.lead')}</span>
        </div>
      </div>

      {error && <div className="plg-stack"><div className="plg-alert">{error}</div></div>}

      <div className="plg-body">
        <div className="plg-scroll">
          <div className="plg-section">
            <div className="plg-section__head">
              <div className="plg-section__title">
                <h3>{t(locale, 'behavior.copy.actions')}</h3>
                <span className="plg-section__count">{snapshot.actions.length}</span>
              </div>
              <div className="plg-section__tools">
                <input
                  className="plg-input"
                  type="search"
                  value={actionQuery}
                  placeholder={t(locale, 'behavior.copy.searchAction')}
                  onInput={(event) => setActionQuery((event.currentTarget as HTMLInputElement).value)}
                />
                <SortControl locale={locale} value={actionSort} onChange={setActionSort} />
                <button type="button" className="plg-btn plg-btn--primary plg-btn--sm" onClick={() => setScreen({ kind: 'picker' })}>
                  {t(locale, 'behavior.copy.newAction')}
                </button>
              </div>
            </div>

            <div className="plg-table plg-table--actions">
              <div className="plg-table__head">
                <SortHeader
                  label={t(locale, 'behavior.copy.colActive')}
                  sort={actionSort}
                  onSort={setActionSort}
                  by="enabled"
                />
                <SortHeader label={t(locale, 'behavior.copy.colName')} sort={actionSort} onSort={setActionSort} by="name" />
                <span>{t(locale, 'behavior.copy.colOrigin')}</span>
                <span>{t(locale, 'behavior.copy.colDoes')}</span>
                <span>{t(locale, 'behavior.copy.colLast')}</span>
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
                        {type ? originLabel(type, locale, t(locale, 'behavior.copy.builtIn')) : '—'}
                        {!usable && ` · ${t(locale, 'behavior.copy.pluginMissing')}`}
                      </span>
                      <span className="plg-pill plg-pill--mono">{type?.tag ?? '—'}</span>
                    </span>
                    <span className="plg-table__detail">{describeAction(action)}</span>
                    <span className={`plg-table__status${!action.enabled ? '' : failing ? ' is-err' : lastRun ? ' is-ok' : ''}`}>
                      <span className={`plg-dot${!action.enabled ? '' : failing ? ' is-err' : lastRun ? ' is-ok' : ''}`} />
                      {!action.enabled
                        ? t(locale, 'behavior.copy.paused')
                        : lastRun
                          ? `${lastRun.error ?? lastRun.summary} · ${relativeTime(lastRun.at, locale)}`
                          : t(locale, 'behavior.copy.noRuns')}
                    </span>
                    <span className="plg-table__actions">
                      <button
                        type="button"
                        className="plg-iconbtn"
                        aria-label={t(locale, 'behavior.copy.edit')}
                        data-tooltip={t(locale, 'behavior.copy.edit')}
                        data-tooltip-pos="left"
                        onClick={() => setScreen({ kind: 'action', action, isNew: false })}
                      >
                        <IconPencil />
                      </button>
                      <button
                        type="button"
                        className="plg-iconbtn is-danger"
                        aria-label={t(locale, 'behavior.copy.remove')}
                        data-tooltip={t(locale, 'behavior.copy.remove')}
                        data-tooltip-pos="left"
                        onClick={() => {
                          if (confirm(t(locale, 'behavior.copy.confirmDeleteAction'))) props.onDeleteAction(action.id);
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
                  <span className="plg-empty__desc">{t(locale, 'behavior.copy.noActions')}</span>
                  <button type="button" className="plg-btn plg-btn--primary" onClick={() => setScreen({ kind: 'picker' })}>
                    {t(locale, 'behavior.copy.newAction')}
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="plg-section">
            <div className="plg-section__head">
              <div className="plg-section__title">
                <h3>{t(locale, 'behavior.copy.events')}</h3>
                <span className="plg-section__count">{snapshot.events.length}</span>
              </div>
              <div className="plg-section__tools">
                <input
                  className="plg-input"
                  type="search"
                  value={eventQuery}
                  placeholder={t(locale, 'behavior.copy.searchEvent')}
                  onInput={(event) => setEventQuery((event.currentTarget as HTMLInputElement).value)}
                />
                <SortControl locale={locale} value={eventSort} onChange={setEventSort} />
                <button
                  type="button"
                  className="plg-btn plg-btn--primary plg-btn--sm"
                  onClick={() => setScreen({ kind: 'event', event: createEvent(locale), isNew: true })}
                >
                  {t(locale, 'behavior.copy.newEvent')}
                </button>
              </div>
            </div>

            <div className="plg-table plg-table--events">
              <div className="plg-table__head">
                <SortHeader label={t(locale, 'behavior.copy.colActive')} sort={eventSort} onSort={setEventSort} by="enabled" />
                <SortHeader label={t(locale, 'behavior.copy.colName')} sort={eventSort} onSort={setEventSort} by="name" />
                <span>{t(locale, 'behavior.copy.colTrigger')}</span>
                <span>{t(locale, 'behavior.copy.colFilters')}</span>
                <span>{t(locale, 'behavior.copy.colActions')}</span>
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
                    {event.filters.length === 0 && <span className="plg-pill">{t(locale, 'behavior.copy.always')}</span>}
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
                      aria-label={t(locale, 'behavior.copy.edit')}
                      data-tooltip={t(locale, 'behavior.copy.edit')}
                      data-tooltip-pos="left"
                      onClick={() => setScreen({ kind: 'event', event, isNew: false })}
                    >
                      <IconPencil />
                    </button>
                    <button
                      type="button"
                      className="plg-iconbtn is-danger"
                      aria-label={t(locale, 'behavior.copy.remove')}
                      data-tooltip={t(locale, 'behavior.copy.remove')}
                      data-tooltip-pos="left"
                      onClick={() => {
                        if (confirm(t(locale, 'behavior.copy.confirmDeleteEvent'))) props.onDeleteEvent(event.id);
                      }}
                    >
                      <IconTrash />
                    </button>
                  </span>
                </div>
              ))}

              {visibleEvents.length === 0 && (
                <div className="plg-empty">
                  <span className="plg-empty__desc">{t(locale, 'behavior.copy.noEvents')}</span>
                  <button
                    type="button"
                    className="plg-btn plg-btn--primary"
                    onClick={() => setScreen({ kind: 'event', event: createEvent(locale), isNew: true })}
                  >
                    {t(locale, 'behavior.copy.newEvent')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <aside className="plg-body__aside">
          <div className="plg-toolbar">
            <span className="plg-section-title">{t(locale, 'behavior.copy.runs')}</span>
          </div>
          <div className="plg-runs">
            {runs.length === 0 && <p className="plg-note">{t(locale, 'behavior.copy.runsEmpty')}</p>}
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
  const [query, setQuery] = useState('');
  const matches = (type: ActionTypeDefinition): boolean =>
    !query.trim() || i18nText(locale, type.title).toLowerCase().includes(query.trim().toLowerCase());

  const installed = plugins.filter((plugin) => plugin.installed && plugin.enabled);

  return (
    <div className="plg">
      <div className="plg-topbar">
        <button type="button" className="plg-btn plg-btn--icon" onClick={onCancel} aria-label={t(locale, 'behavior.copy.back')}>‹</button>
        <div className="plg-topbar__text">
          <h2 className="plg-topbar__title">{t(locale, 'behavior.copy.pickTitle')}</h2>
          <span className="plg-topbar__subtitle">{t(locale, 'behavior.copy.pickLead')}</span>
        </div>
        <div className="plg-topbar__actions">
          <button type="button" className="plg-btn plg-btn--sm" onClick={onOpenPlugins}>{t(locale, 'behavior.copy.explore')}</button>
        </div>
      </div>

      <div className="plg-toolbar">
        <input
          className="plg-input"
          type="search"
          value={query}
          placeholder={t(locale, 'behavior.copy.searchAction')}
          onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)}
        />
      </div>

      <div className="plg-scroll">
        <div className="plg-section">
          <div className="plg-group-head">
            <span className="plg-section-title">{t(locale, 'behavior.copy.builtInGroup')}</span>
            <span className="plg-group-note">{t(locale, 'behavior.copy.builtInNote')}</span>
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
                <span className="plg-pill">{t(locale, 'behavior.copy.pluginNote')}</span>
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
              <span className="plg-action-card__title">{t(locale, 'behavior.copy.missingTitle')}</span>
              <span className="plg-action-card__desc">{t(locale, 'behavior.copy.missingDesc')}</span>
            </div>
            <button type="button" className="plg-btn plg-btn--primary plg-btn--sm" onClick={onOpenPlugins}>
              {t(locale, 'behavior.copy.explore')}
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
  actionOptions,
  onGetActionOptions,
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
  actionOptions: Record<string, ActionOptionItem[]>;
  onGetActionOptions: (source: string) => void;
  onCancel: () => void;
  onSave: (action: LiveAction) => void;
  onDelete: (id: string) => void;
  onTest: (action: LiveAction, trigger?: AutomationEventType) => void;
}) {
  const [draft, setDraft] = useState<LiveAction>(action);
  const type = actionTypes.find((entry) => entry.id === draft.typeId);
  const permissions = deriveActionPermissions(draft, type);
  const testRun = testRuns.find((run) => run.actionId === draft.id) ?? testRuns[0];
  const form = type ? schemaForAction(type) : undefined;
  const dynamicFields = useMemo(() => fieldsWithOptions(form?.uiHints), [form?.uiHints]);
  useEffect(() => {
    for (const field of dynamicFields) onGetActionOptions(field.source);
  }, [type?.id]);
  const fieldOptions = useMemo(() => {
    const merged: Record<string, Array<{ value: string; label: string }>> = {};
    for (const field of dynamicFields) {
      const options = actionOptions[field.source];
      if (options && options.length > 0) merged[field.key] = options;
    }
    return merged;
  }, [dynamicFields, actionOptions]);

  // Generic autocomplete context: the registry sample event, so `{{ }}`
  // works even before the first live event arrives. Any object can be pushed
  // here — SchemaForm merges it with the trigger scope.
  const suggestionContext = useMemo(() => ({ event: sampleEventFor('tiktok.gift') }) as unknown as JsonObject, []);
  const suggestionScopes = useMemo<Partial<Record<string, TemplateSuggestionScope>>>(() => {
    if (draft.typeId === 'core.fetch') {
      return { url: 'http-url', body: 'http-data', headers: 'http-data', emitResponseAs: 'identity', uniqueId: 'identity' };
    }
    if (draft.typeId === 'core.emit') return { type: 'identity', data: 'http-data' };
    if (draft.typeId === 'core.points') return { uniqueId: 'identity' };
    if (draft.typeId === 'core.log') return { message: 'message' };
    return {};
  }, [draft.typeId]);
  const suggestionsFor = useFieldSuggestions({ locale, suggestionContext, suggestionScopes });
  const isFetch = draft.typeId === 'core.fetch';

  return (
    <div className="plg">
      <div className="plg-topbar">
        <button
          type="button"
          className="plg-btn plg-btn--icon"
          onClick={onCancel}
          aria-label={t(locale, 'behavior.copy.back')}
          data-tooltip={t(locale, 'behavior.copy.backHint')}
          data-tooltip-pos="bottom"
          data-tooltip-wide=""
        >
          ‹
        </button>
        <div className="plg-topbar__text">
          <h2 className="plg-topbar__title">{draft.name || t(locale, 'behavior.copy.newAction')}</h2>
          <span
            className="plg-topbar__subtitle plg-mono"
            data-tooltip={type ? `${i18nText(locale, type.description)}${t(locale, 'behavior.copy.typeHint') ? ` — ${t(locale, 'behavior.copy.typeHint')}` : ''}` : draft.typeId}
            data-tooltip-pos="bottom"
            data-tooltip-wide=""
          >
            {type ? `${originLabel(type, locale, t(locale, 'behavior.copy.builtIn'))} · ${type.tag}` : draft.typeId}
          </span>
        </div>
        <div className="plg-topbar__actions">
          {!isNew && (
            <button
              type="button"
              className="plg-btn plg-btn--danger plg-btn--sm"
              data-tooltip={t(locale, 'behavior.copy.deleteHint')}
              data-tooltip-pos="bottom"
              data-tooltip-wide=""
              onClick={() => {
                if (confirm(t(locale, 'behavior.copy.confirmDeleteAction'))) onDelete(draft.id);
              }}
            >
              {t(locale, 'behavior.copy.remove')}
            </button>
          )}
          <button
            type="button"
            className="plg-btn plg-btn--primary plg-btn--sm"
            data-tooltip={t(locale, 'behavior.copy.saveHint')}
            data-tooltip-pos="bottom"
            data-tooltip-wide=""
            onClick={() => onSave(draft)}
          >
            {t(locale, 'behavior.copy.save')}
          </button>
        </div>
      </div>

      <div className="plg-scroll">
        <div className="plg-form">
          <div className="plg-form__main">
            {error && <div className="plg-alert">{error}</div>}

            <div className="plg-field">
              <span className="act-label">{t(locale, 'behavior.editor.actionName')}</span>
              <input
                className="plg-input act-name-input"
                value={draft.name}
                aria-label={t(locale, 'behavior.editor.actionName')}
                placeholder={type ? i18nText(locale, type.title) : undefined}
                onInput={(event) => setDraft((current) => ({ ...current, name: (event.currentTarget as HTMLInputElement).value }))}
              />
            </div>

            {form ? (
              <>
                {dynamicFields.length > 0 && (
                  <div className="plg-row">
                    <button
                      type="button"
                      className="plg-btn plg-btn--sm"
                      onClick={() => { for (const field of dynamicFields) onGetActionOptions(field.source); }}
                    >
                      {t(locale, 'behavior.copy.refreshOptions')}
                    </button>
                  </div>
                )}
                {isFetch ? (
                  <FetchFields
                    locale={locale}
                    draft={draft}
                    form={form}
                    suggestionsFor={suggestionsFor}
                    suggestionContext={suggestionContext}
                    onPatchConfig={(patch) => setDraft((current) => ({ ...current, config: { ...current.config, ...patch } }))}
                  />
                ) : (
                  <SchemaForm
                    locale={locale}
                    schema={form.schema}
                    uiHints={form.uiHints}
                    value={draft.config}
                    fieldOptions={fieldOptions}
                    suggestionContext={suggestionContext}
                    suggestionScopes={suggestionScopes}
                    onChange={(config) => setDraft((current) => ({ ...current, config }))}
                  />
                )}
              </>
            ) : <div className="plg-alert">{draft.typeId}</div>}
          </div>

          <div className="plg-side act-side">
            <PermissionCards
              locale={locale}
              network={permissions.network}
              capabilities={permissions.capabilities}
              noneLabel={t(locale, 'behavior.copy.none')}
            />
            <TestConsole
              locale={locale}
              run={testRun}
              headers={isFetch ? readStringMap(draft.config.headers) : undefined}
              onRun={() => onTest(draft)}
              emptyLabel={t(locale, 'behavior.copy.consoleEmpty')}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Endpoint + tabbed body layout for `core.fetch`, following the webhook-editor mockup. */
function FetchFields({
  locale,
  draft,
  form,
  suggestionsFor,
  suggestionContext,
  onPatchConfig,
}: {
  locale: Locale;
  draft: LiveAction;
  form: { schema: JsonObject; uiHints?: JsonObject };
  suggestionsFor: (name: string, template: boolean) => Array<{ value: string; label: string }>;
  suggestionContext: JsonObject;
  onPatchConfig: (patch: JsonObject) => void;
}) {
  const [tab, setTab] = useState<'body' | 'headers' | 'auth'>('body');
  const method = readString(draft.config.method) || 'POST';
  const isGet = method.toUpperCase() === 'GET';
  const activeTab: 'body' | 'headers' | 'auth' = isGet && tab === 'body' ? 'headers' : tab;
  const headers = readStringMap(draft.config.headers);
  const headerCount = Object.keys(headers).length;
  const body = readString(draft.config.body);

  const properties = objectPropertiesOf(form.schema.properties);
  const fieldHints = objectPropertiesOf(
    form.uiHints && typeof form.uiHints.fields === 'object' && !Array.isArray(form.uiHints.fields)
      ? form.uiHints.fields as JsonObject
      : undefined,
  );
  const advancedKeys = Object.keys(properties).filter((key) => {
    const hint = fieldHints[key];
    return hint !== undefined && (hint as JsonObject).advanced === true && key !== 'headers';
  });
  const advancedSummary = advancedKeys
    .map((key) => fieldTitle(properties[key], locale) || key)
    .slice(0, 3)
    .join(', ');
  const headersForm = stripAdvanced(pickForm(form, ['headers']));
  const advancedForm = stripAdvanced(pickForm(form, advancedKeys));

  const formatBody = (): void => {
    const formatted = formatJsonText(body);
    if (formatted !== null && formatted !== body) onPatchConfig({ body: formatted });
  };

  const urlValue = readString(draft.config.url);
  const allowPrivate = readString(draft.config.allowPrivateNetwork) === 'true';
  const showLocalHint = urlValue.trim().length > 0 && isLocalFetchUrl(urlValue) && !allowPrivate;
  const urlPresets = useMemo(() => getFetchUrlTemplates(), []);

  return (
    <div className="act-fetch">
      <div className="plg-field">
        <span className="act-label">
          {t(locale, 'behavior.editor.endpoint')}
          {fieldHint(fieldHints.url, locale) && <InfoTip text={fieldHint(fieldHints.url, locale)} position="right" />}
        </span>
        <div className="act-endpoint">
          <select
            className="act-method"
            value={method}
            aria-label={fieldTitle(properties.method, locale) || 'Method'}
            onChange={(event) => onPatchConfig({ method: (event.currentTarget as HTMLSelectElement).value })}
          >
            {methodOptions(properties.method, fieldHints.method, locale).map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <TemplateField
            locale={locale}
            value={urlValue}
            onValueChange={(next) => onPatchConfig({ url: next })}
            suggestions={suggestionsFor('url', true)}
            ariaLabel={fieldTitle(properties.url, locale) || 'URL'}
            placeholder={fieldPlaceholder(fieldHints.url) ?? 'https://'}
            bareWordTrigger={false}
            urlPresets={urlPresets}
          />
        </div>
        {showLocalHint && (
          <p className="act-localhint" role="note">
            <span>{t(locale, 'behavior.editor.localNetHint')}</span>
            <button type="button" className="act-preset" onClick={() => onPatchConfig({ allowPrivateNetwork: true })}>
              {t(locale, 'behavior.editor.enableLocalNet')}
            </button>
          </p>
        )}
      </div>

      <div className="act-tabrow">
        <div className="act-tabs" role="tablist">
          {!isGet && (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'body'}
              className={`act-tab${activeTab === 'body' ? ' is-active' : ''}`}
              onClick={() => setTab('body')}
            >
              {t(locale, 'behavior.editor.bodyTab')}
            </button>
          )}
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'headers'}
            className={`act-tab${activeTab === 'headers' ? ' is-active' : ''}`}
            onClick={() => setTab('headers')}
          >
            {t(locale, 'behavior.editor.headersTab')}
            {headerCount > 0 && <span className="act-tabcount">{headerCount}</span>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'auth'}
            className={`act-tab${activeTab === 'auth' ? ' is-active' : ''}`}
            onClick={() => setTab('auth')}
          >
            {t(locale, 'behavior.editor.authTab')}
          </button>
        </div>
        {activeTab === 'body' && (
          <button type="button" className="act-format" onClick={formatBody}>
            <span aria-hidden="true">☰</span> {t(locale, 'behavior.editor.format')}
          </button>
        )}
      </div>

      {activeTab === 'body' && (
        <CodeEditor
          locale={locale}
          language="json"
          value={body}
          onValueChange={(next) => onPatchConfig({ body: next })}
          suggestions={suggestionsFor('body', true)}
          filename="payload.json"
          mime="application/json"
          rows={7}
          ariaLabel={fieldTitle(properties.body, locale) || 'Body'}
        />
      )}

      {activeTab === 'headers' && (
        <div className="act-headers">
          <SchemaForm
            locale={locale}
            schema={headersForm.schema}
            uiHints={headersForm.uiHints}
            value={draft.config}
            suggestionContext={suggestionContext}
            suggestionScopes={{ headers: 'http-data' }}
            onChange={(config) => onPatchConfig({ headers: config.headers ?? {} })}
          />
        </div>
      )}

      {activeTab === 'auth' && (
        <div className="act-auth-empty">{t(locale, 'behavior.editor.authEmpty')}</div>
      )}

      {advancedKeys.length > 0 && (
        <details className="plg-details act-adv">
          <summary>
            <span>{t(locale, 'behavior.copy.advanced')}</span>
            {advancedSummary && <span className="act-adv__summary">{advancedSummary}</span>}
          </summary>
          <div className="plg-details__body">
            <SchemaForm
              locale={locale}
              schema={advancedForm.schema}
              uiHints={advancedForm.uiHints}
              value={draft.config}
              onChange={(config) => onPatchConfig(config)}
            />
          </div>
        </details>
      )}
    </div>
  );
}

/** Helpers to slice a form schema down to the fields a tab owns. */
function objectPropertiesOf(value: JsonValue | undefined): Record<string, JsonObject> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, JsonObject] => Boolean(entry[1]) && typeof entry[1] === 'object' && !Array.isArray(entry[1])),
  );
}

function pickForm(form: { schema: JsonObject; uiHints?: JsonObject }, keys: string[]): { schema: JsonObject; uiHints?: JsonObject } {
  const properties = objectPropertiesOf(form.schema.properties);
  const pickedProperties: JsonObject = {};
  for (const key of keys) if (properties[key]) pickedProperties[key] = properties[key] as JsonValue;
  const fields = objectPropertiesOf(
    form.uiHints && typeof form.uiHints.fields === 'object' && !Array.isArray(form.uiHints.fields)
      ? form.uiHints.fields as JsonObject
      : undefined,
  );
  const pickedFields: JsonObject = {};
  for (const key of keys) if (fields[key]) pickedFields[key] = fields[key] as JsonValue;
  return {
    schema: { ...form.schema, properties: pickedProperties },
    uiHints: form.uiHints ? { ...form.uiHints, fields: pickedFields } : undefined,
  };
}

function stripAdvanced(form: { schema: JsonObject; uiHints?: JsonObject }): { schema: JsonObject; uiHints?: JsonObject } {
  if (!form.uiHints || typeof form.uiHints.fields !== 'object' || Array.isArray(form.uiHints.fields)) return form;
  const fields: JsonObject = {};
  for (const [key, hint] of Object.entries(form.uiHints.fields as JsonObject)) {
    if (hint && typeof hint === 'object' && !Array.isArray(hint)) {
      const { advanced: _dropped, ...rest } = hint as JsonObject;
      void _dropped;
      fields[key] = rest as JsonValue;
    } else {
      fields[key] = hint as JsonValue;
    }
  }
  return { schema: form.schema, uiHints: { ...form.uiHints, fields } };
}

function fieldTitle(schema: JsonObject | undefined, locale: Locale): string {
  if (!schema) return '';
  const title = (schema as JsonObject).title;
  return i18nText(locale, title);
}

function fieldHint(hint: JsonObject | undefined, locale: Locale): string {
  if (!hint) return '';
  return i18nText(locale, (hint as JsonObject).hint);
}

function fieldPlaceholder(hint: JsonObject | undefined): string | undefined {
  if (!hint) return undefined;
  const placeholder = (hint as JsonObject).placeholder;
  return typeof placeholder === 'string' ? placeholder : undefined;
}

function methodOptions(
  schema: JsonObject | undefined,
  hint: JsonObject | undefined,
  locale: Locale,
): Array<{ value: string; label: string }> {
  const values = schema && Array.isArray((schema as JsonObject).enum)
    ? ((schema as JsonObject).enum as JsonValue[]).filter((entry): entry is string => typeof entry === 'string')
    : [];
  const hinted = hint && Array.isArray((hint as JsonObject).options)
    ? ((hint as JsonObject).options as JsonValue[]).filter((entry): entry is JsonObject => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
    : [];
  const fallback = values.length > 0 ? values : ['GET', 'POST', 'PUT', 'DELETE'];
  return fallback.map((value) => {
    const labeled = hinted.find((entry) => entry.value === value);
    return { value, label: labeled ? i18nText(locale, labeled.label) || value : value };
  });
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
  const [draft, setDraft] = useState<LiveEvent>(event);
  const [step, setStep] = useState(1);

  const update = (patch: Partial<LiveEvent>): void => setDraft((current) => ({ ...current, ...patch }));
  const chosenNames = draft.actionIds
    .map((id) => actions.find((action) => action.id === id)?.name)
    .filter((name): name is string => Boolean(name));

  const steps = [
    { number: 1, label: t(locale, 'behavior.copy.stepWhen'), sub: i18nText(locale, TRIGGER_LABELS[draft.trigger]) },
    {
      number: 2,
      label: t(locale, 'behavior.copy.stepFilters'),
      sub: draft.filters.length === 0
        ? t(locale, 'behavior.copy.alwaysShort')
        : draft.filters.map((filter) => describeFilter(filter, locale, draft.trigger)).join(' · '),
    },
    { number: 3, label: t(locale, 'behavior.copy.stepDo'), sub: chosenNames.length === 0 ? t(locale, 'behavior.copy.noneYet') : chosenNames.join(' · ') },
  ];

  return (
    <div className="plg">
      <div className="plg-topbar">
        <button type="button" className="plg-btn plg-btn--icon" onClick={onCancel} aria-label={t(locale, 'behavior.copy.back')}>‹</button>
        <div className="plg-topbar__text">
          <h2 className="plg-topbar__title">{draft.name || t(locale, 'behavior.copy.newEvent')}</h2>
          <span className="plg-topbar__subtitle plg-mono">{t(locale, 'behavior.copy.stepOf', { step })} · {draft.trigger}</span>
        </div>
        <div className="plg-topbar__actions">
          {!isNew && (
            <button
              type="button"
              className="plg-btn plg-btn--danger plg-btn--sm"
              onClick={() => {
                if (confirm(t(locale, 'behavior.copy.confirmDeleteEvent'))) onDelete(draft.id);
              }}
            >
              {t(locale, 'behavior.copy.remove')}
            </button>
          )}
          <button type="button" className="plg-btn plg-btn--primary plg-btn--sm" onClick={() => onSave(draft)}>
            {t(locale, 'behavior.copy.save')}
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
                    <label className="plg-label">{t(locale, 'behavior.copy.trigger')}</label>
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
                    <label className="plg-label">{t(locale, 'behavior.copy.name')}</label>
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
                  <span className="plg-label">{t(locale, 'behavior.copy.stepFiltersHint')}</span>
                  <InfoTip text={t(locale, 'behavior.copy.orHint')} position="right" />
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
                <span className="plg-label">{t(locale, 'behavior.copy.pickActions')}</span>
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
                  {actions.length === 0 && <span className="plg-note">{t(locale, 'behavior.copy.noActionsYet')}</span>}
                </div>

                {draft.actionIds.length > 1 && (
                  <div className="plg-switch-row">
                    <button
                      type="button"
                      className={`plg-switch${draft.runMode === 'random' ? ' is-on' : ''}`}
                      aria-label={t(locale, 'behavior.copy.runMode')}
                      onClick={() => update({ runMode: draft.runMode === 'random' ? 'all' : 'random' })}
                    >
                      <span className="plg-switch__track"><span className="plg-switch__thumb" /></span>
                    </button>
                    <label
                      className="plg-label"
                      onClick={() => update({ runMode: draft.runMode === 'random' ? 'all' : 'random' })}
                    >
                      {t(locale, 'behavior.copy.runMode')}
                    </label>
                  </div>
                )}

                <div className="plg-inline">
                  <div className="plg-field">
                    <label className="plg-label">{t(locale, 'behavior.copy.cooldown')}</label>
                    <select
                      className="plg-select"
                      value={String(draft.cooldownMs)}
                      onChange={(node) => update({ cooldownMs: Number((node.currentTarget as HTMLSelectElement).value) })}
                    >
                      {COOLDOWN_CHOICES.map((ms) => (
                        <option key={ms} value={String(ms)}>{ms === 0 ? t(locale, 'behavior.copy.noCooldown') : `${ms / 1000} s`}</option>
                      ))}
                    </select>
                  </div>
                  {draft.cooldownMs > 0 && (
                  <div className="plg-field">
                    <div className="plg-label-row">
                      <label className="plg-label">{t(locale, 'behavior.copy.cooldownScope')}</label>
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
                      <option value="user">{t(locale, 'behavior.copy.perUser')}</option>
                      <option value="global">{t(locale, 'behavior.copy.global')}</option>
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
                {t(locale, 'behavior.copy.previous')}
              </button>
              <span className="plg-nav__spacer" />
              {step < 3 ? (
                <button
                  type="button"
                  className="plg-btn plg-btn--primary plg-btn--sm"
                  onClick={() => setStep((current) => Math.min(3, current + 1))}
                >
                  {t(locale, 'behavior.copy.next')}
                </button>
              ) : (
                <button type="button" className="plg-btn plg-btn--primary plg-btn--sm" onClick={() => onSave(draft)}>
                  {t(locale, 'behavior.copy.finish')}
                </button>
              )}
            </div>
          </div>

          <div className="plg-side">
            <button type="button" className="plg-btn plg-btn--block" onClick={() => onTest(draft)}>
              {t(locale, 'behavior.copy.test')}
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
  return (
    <IconSelect
      className="plg-sort"
      ariaLabel={t(locale, 'behavior.copy.sortBy')}
      value={value}
      onChange={(next) => onChange(next as SortMode)}
      options={[
        { value: 'name', label: t(locale, 'behavior.copy.sortName'), icon: <SortGlyph direction="up" /> },
        { value: 'name-desc', label: t(locale, 'behavior.copy.sortNameDesc'), icon: <SortGlyph direction="down" /> },
        { value: 'enabled', label: t(locale, 'behavior.copy.sortActive'), icon: <SortGlyph direction="dot" /> },
        { value: 'disabled', label: t(locale, 'behavior.copy.sortInactive'), icon: <SortGlyph direction="dot-off" /> },
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
    name: t(locale, 'newEventDefault'),
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
    return `${items.slice(0, -1).join(', ')} ${t(locale, 'andWord')} ${last}`;
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
  if (seconds < 5) return t(locale, 'nowWord');
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.round(minutes / 60)} h`;
}
