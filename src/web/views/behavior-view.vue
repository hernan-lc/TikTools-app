<script lang="tsx">
import { computed, nextTick, onMounted, ref } from 'vue';
import { defineVueComponent } from '../vue/component.ts';
import { Icon } from '../components/icons/index.ts';
import { ActionEditor } from './behavior/action-editor.vue';
import { ActionPicker } from './behavior/action-picker.vue';
import { EventEditor } from './behavior/event-editor.vue';
import { ProfileImportDialog } from './behavior/ProfileImportDialog.vue';
import { ProfileSelect } from './behavior/ProfileSelect.vue';
import { RuleTemplateModal } from './behavior/RuleTemplateModal.vue';
import type { AppliedRuleTemplate, RuleTemplate } from './behavior/rule-templates.ts';
import type { ProfilePack, RuleProfile } from '../features/rule-profiles.ts';
import { resolvedPacks } from '../features/rule-profiles.ts';
import { ActionsTable } from './behavior/ActionsTable.vue';
import { EventsTable } from './behavior/EventsTable.vue';
import { HotkeyFloatBadge } from './behavior/HotkeyFloatBadge.vue';
import {
  availableActionTypes,
  createActionFromType,
  relativeTime,
  type SortMode,
} from './behavior/helpers.vue';
import type {
  BehaviorRun,
  BehaviorSnapshot,
  LiveAction,
  LiveEvent,
} from '../../automation/behavior/types.ts';
import type { ActionOptionItem, GiftCatalogEntry, HotkeyStatusData, OpenMediaPicker, ViewerRecord } from '../../shared/messages.ts';
import { t, type Locale } from '../i18n.ts';
import type { LastHotkeyEvent } from '../features/automation.ts';

type BehaviorViewProps = {
  locale: Locale;
  snapshot: BehaviorSnapshot;
  /** Sources for the value pickers: the room's gifts and the known viewers. */
  gifts: GiftCatalogEntry[];
  viewers: ViewerRecord[];
  runs: BehaviorRun[];
  testRuns: BehaviorRun[];
  /** Runtime globals for `{{ globals.* }}` autocomplete in action editors. */
  globals: Record<string, string>;
  hotkeyStatus?: HotkeyStatusData | null;
  lastHotkeyEvent?: LastHotkeyEvent | null;
  hotkeyAccessPending?: boolean;
  onRequestHotkeyAccess: () => void;
  error?: string;
  onSaveAction: (action: LiveAction) => void;
  onDeleteAction: (id: string) => void;
  onSetActionEnabled: (id: string, enabled: boolean) => void;
  onTestAction: (action: LiveAction, trigger?: string) => void;
  onSaveEvent: (event: LiveEvent) => void;
  onDeleteEvent: (id: string) => void;
  onSetEventEnabled: (id: string, enabled: boolean) => void;
  onTestEvent: (event: LiveEvent) => void;
  onFireEvent: (event: LiveEvent) => void;
  onOpenPlugins: () => void;
  onOpenMediaPicker: OpenMediaPicker;
  /** On-demand option lists keyed by options source. */
  actionOptions: Record<string, ActionOptionItem[]>;
  /** Per-source fetch errors for the option lists above. */
  actionOptionErrors: Record<string, string>;
  onGetActionOptions: (source: string, refresh?: boolean) => void;
  onApplyRuleTemplate: (actions: LiveAction[], event: LiveEvent) => void;
  ruleTemplateCustom: RuleTemplate[];
  ruleTemplateError: string | null;
  onLoadRuleTemplateCustom: () => Promise<void>;
  onImportRuleTemplates: (templates: RuleTemplate[]) => Promise<number>;
  onDeleteRuleTemplateCustom: (id: string) => void;
  ruleProfilePacks: ProfilePack[];
  activeRuleProfileId: string;
  ruleProfileError: string | null;
  ruleProfileNotice: string | null;
  onApplyRuleProfile: (profile: RuleProfile, applied: AppliedRuleTemplate[]) => Promise<void>;
  onSwitchRuleProfile: (id: string) => Promise<void>;
  onCreateRuleProfile: (name: string) => Promise<void>;
  onDeleteRuleProfile: (id: string) => Promise<void>;
  onExportRuleProfile: (id: string) => void;
};

type Screen =
  | { kind: 'list' }
  | { kind: 'picker' }
  | { kind: 'action'; action: LiveAction; isNew: boolean }
  | { kind: 'event'; event: LiveEvent; isNew: boolean };

export const BehaviorView = defineVueComponent<BehaviorViewProps>(
  [
    'locale',
    'snapshot',
    'gifts',
    'viewers',
    'runs',
    'testRuns',
    'globals',
    'hotkeyStatus',
    'lastHotkeyEvent',
    'hotkeyAccessPending',
    'onRequestHotkeyAccess',
    'error',
    'onSaveAction',
    'onDeleteAction',
    'onSetActionEnabled',
    'onTestAction',
    'onSaveEvent',
    'onDeleteEvent',
    'onSetEventEnabled',
    'onTestEvent',
    'onFireEvent',
    'onOpenPlugins',
    'onOpenMediaPicker',
    'actionOptions',
    'actionOptionErrors',
    'onGetActionOptions',
    'onApplyRuleTemplate',
    'ruleTemplateCustom',
    'ruleTemplateError',
    'onLoadRuleTemplateCustom',
    'onImportRuleTemplates',
    'onDeleteRuleTemplateCustom',
    'ruleProfilePacks',
    'activeRuleProfileId',
    'ruleProfileError',
    'ruleProfileNotice',
    'onApplyRuleProfile',
    'onSwitchRuleProfile',
    'onCreateRuleProfile',
    'onDeleteRuleProfile',
    'onExportRuleProfile',
  ],
  (props) => {
  const screen = ref<Screen>({ kind: 'list' });
  const templateModalOpen = ref(false);
  const profileImportOpen = ref(false);

  // Search and sort state lives here, not in the tables: the editor
  // screens replace the whole list, so table-local refs would drop the
  // user's filters on every edit round-trip (the "similar approach to
  // query params" for a webview with no router — the parent outlives
  // the screen swap and restores the list exactly as it was left).
  const actionQuery = ref('');
  const actionSort = ref<SortMode>('name');
  const eventQuery = ref('');
  const eventSort = ref<SortMode>('name');
  const scrollRef = ref<HTMLElement | null>(null);
  const savedScrollTop = ref(0);
  const returnFocusId = ref<string | null>(null);

  /** Snapshots the list scroll position before an editor screen replaces it. */
  const captureListState = (): void => {
    savedScrollTop.value = scrollRef.value?.scrollTop ?? 0;
  };

  /**
   * Returns to the list from any editor screen, restoring the saved
   * scroll position and focusing the edit control of the row that was
   * edited, so the user lands back exactly where they started instead
   * of at the top of a reloaded list with focus lost.
   */
  const returnToList = (): void => {
    screen.value = { kind: 'list' };
    const focusId = returnFocusId.value;
    returnFocusId.value = null;
    void nextTick(() => {
      const container = scrollRef.value;
      if (!container) return;
      container.scrollTop = savedScrollTop.value;
      if (focusId) {
        for (const control of Array.from(
          container.querySelectorAll<HTMLElement>('[data-edit-id]'),
        )) {
          if (control.dataset.editId === focusId) {
            control.focus();
            break;
          }
        }
      }
    });
  };

  const openActionEditor = (action: LiveAction): void => {
    captureListState();
    returnFocusId.value = action.id;
    screen.value = { kind: 'action', action, isNew: false };
  };

  const openEventEditor = (event: LiveEvent): void => {
    captureListState();
    returnFocusId.value = event.id;
    screen.value = { kind: 'event', event, isNew: false };
  };

  const openActionPicker = (): void => {
    captureListState();
    returnFocusId.value = null;
    screen.value = { kind: 'picker' };
  };

  const openNewEvent = (event: LiveEvent): void => {
    captureListState();
    returnFocusId.value = null;
    screen.value = { kind: 'event', event, isNew: true };
  };

  onMounted(() => {
    void props.onLoadRuleTemplateCustom();
  });

  const lastRunByAction = computed(() => {
    const map = new Map<string, BehaviorRun>();
    for (const run of props.runs) {
      if (run.test || !run.actionId) continue;
      if (!map.has(run.actionId)) map.set(run.actionId, run);
    }
    return map;
  });

  const availableTypes = computed(() => availableActionTypes(props.snapshot.plugins, props.snapshot.actionTypes));

  // The tables list only the active pack's rules, so switching profiles
  // replaces the whole view instead of showing foreign rules as disabled.
  // Hidden records stay stored (and disabled) until their pack is active.
  const resolvedProfiles = computed(() => resolvedPacks(
    props.ruleProfilePacks,
    props.snapshot.events.map((event) => event.id),
    props.snapshot.actions.map((action) => action.id),
  ));
  const activePack = computed(() =>
    resolvedProfiles.value.find((pack) => pack.id === props.activeRuleProfileId) ?? null,
  );
  const visibleEvents = computed(() => {
    const pack = activePack.value;
    if (!pack) return props.snapshot.events;
    const ids = new Set(pack.eventIds);
    return props.snapshot.events.filter((event) => ids.has(event.id));
  });
  const visibleActions = computed(() => {
    const pack = activePack.value;
    if (!pack) return props.snapshot.actions;
    const ids = new Set(pack.actionIds);
    return props.snapshot.actions.filter((action) => ids.has(action.id));
  });

  return () => {
  const locale = props.locale;
  const snapshot = props.snapshot;
  const runs = props.runs;
  const testRuns = props.testRuns;
  const error = props.error;
  const currentScreen = screen.value;

  if (currentScreen.kind === 'picker') {
    return (
      <ActionPicker
        locale={locale}
        plugins={snapshot.plugins}
        onCancel={returnToList}
        onOpenPlugins={props.onOpenPlugins}
        actionTypes={snapshot.actionTypes}
        onPick={(type) => { screen.value = { kind: 'action', action: createActionFromType(type, locale), isNew: true }; }}
      />
    );
  }

  if (currentScreen.kind === 'action') {
    return (
      <ActionEditor
        key={currentScreen.action.id}
        locale={locale}
        action={currentScreen.action}
        actionTypes={snapshot.actionTypes}
        isNew={currentScreen.isNew}
        error={error}
        testRuns={testRuns}
        globals={props.globals}
        actionOptions={props.actionOptions}
        actionOptionErrors={props.actionOptionErrors}
        onGetActionOptions={props.onGetActionOptions}
        onOpenMediaPicker={props.onOpenMediaPicker}
        onCancel={returnToList}
        onSave={(action) => {
          props.onSaveAction(action);
          returnToList();
        }}
        onDelete={(id) => {
          props.onDeleteAction(id);
          returnToList();
        }}
        onTest={props.onTestAction}
      />
    );
  }

  if (currentScreen.kind === 'event') {
    return (
      <EventEditor
        key={currentScreen.event.id}
        locale={locale}
        event={currentScreen.event}
        isNew={currentScreen.isNew}
        actions={visibleActions.value}
        eventTypes={snapshot.eventTypes ?? []}
        hotkeyStatus={props.hotkeyStatus}
        gifts={props.gifts}
        viewers={props.viewers}
        error={error}
        testRuns={testRuns}
        onCancel={returnToList}
        onSave={(event) => {
          props.onSaveEvent(event);
          returnToList();
        }}
        onDelete={(id) => {
          props.onDeleteEvent(id);
          returnToList();
        }}
        onTest={props.onTestEvent}
        onFire={props.onFireEvent}
      />
    );
  }

  return (
    <div class="plg plg--behavior">
      {error && <div class="plg-stack"><div class="plg-alert">{error}</div></div>}

      <HotkeyFloatBadge
        locale={locale}
        plugins={snapshot.plugins}
        hotkeyStatus={props.hotkeyStatus}
        lastHotkeyEvent={props.lastHotkeyEvent}
        accessPending={props.hotkeyAccessPending}
        onRequestAccess={props.onRequestHotkeyAccess}
      />

      <div class="plg-body">
        <div class="plg-scroll" ref={scrollRef}>
          <div class="plg-section">
            <div class="plg-section__head">
              <div class="plg-section__title">
                <span class="plg-section__icon" aria-hidden="true">
                  <Icon name="template" size={16} />
                </span>
                <h3>{t(locale, 'behavior.copy.libraryTitle')}</h3>
              </div>
              <div class="rule-template-head-tools">
                <ProfileSelect
                  locale={locale}
                  packs={resolvedProfiles.value}
                  activeId={props.activeRuleProfileId}
                  error={props.ruleProfileError ?? ''}
                  notice={props.ruleProfileNotice ?? ''}
                  onSwitch={props.onSwitchRuleProfile}
                  onCreate={props.onCreateRuleProfile}
                  onDelete={props.onDeleteRuleProfile}
                  onExport={props.onExportRuleProfile}
                  onOpenImport={() => { profileImportOpen.value = true; }}
                />
                <button
                  type="button"
                  class="plg-btn plg-btn--sm"
                  onClick={() => { templateModalOpen.value = true; }}
                >
                  <Icon name="template" size={14} />
                  <span>{t(locale, 'behavior.copy.fromTemplate')}</span>
                </button>
              </div>
            </div>
            <p class="plg-note">{t(locale, 'behavior.copy.libraryLead')}</p>
          </div>
          <ActionsTable
            locale={locale}
            actions={visibleActions.value}
            actionTypes={snapshot.actionTypes}
            availableTypes={availableTypes.value}
            lastRunByAction={lastRunByAction.value}
            query={actionQuery.value}
            sort={actionSort.value}
            onQueryChange={(next) => { actionQuery.value = next; }}
            onSortChange={(next) => { actionSort.value = next; }}
            onSetEnabled={props.onSetActionEnabled}
            onDelete={props.onDeleteAction}
            onEdit={openActionEditor}
            onNew={openActionPicker}
          />
          <EventsTable
            locale={locale}
            events={visibleEvents.value}
            actions={visibleActions.value}
            eventTypes={snapshot.eventTypes ?? []}
            query={eventQuery.value}
            sort={eventSort.value}
            onQueryChange={(next) => { eventQuery.value = next; }}
            onSortChange={(next) => { eventSort.value = next; }}
            onSetEnabled={props.onSetEventEnabled}
            onDelete={props.onDeleteEvent}
            onEdit={openEventEditor}
            onNew={openNewEvent}
          />
        </div>

      {templateModalOpen.value && (
        <RuleTemplateModal
          locale={locale}
          snapshot={snapshot}
          customTemplates={props.ruleTemplateCustom}
          customError={props.ruleTemplateError}
          onClose={() => { templateModalOpen.value = false; }}
          onApply={props.onApplyRuleTemplate}
          onImport={props.onImportRuleTemplates}
          onDeleteCustom={props.onDeleteRuleTemplateCustom}
        />
      )}

      {profileImportOpen.value && (
        <ProfileImportDialog
          locale={locale}
          profilesError={props.ruleProfileError ?? ''}
          onClose={() => { profileImportOpen.value = false; }}
          onApplyProfile={props.onApplyRuleProfile}
        />
      )}

        <aside class="plg-body__aside">
          <div class="plg-toolbar">
            <span class="plg-section-title">{t(locale, 'behavior.copy.runs')}</span>
          </div>
          <div class="plg-runs">
            {runs.length === 0 && <p class="plg-note">{t(locale, 'behavior.copy.runsEmpty')}</p>}
            {runs.slice(0, 20).map((run) => (
              <div class="plg-run" key={run.id}>
                <span class={`plg-dot${run.status === 'ok' ? ' is-ok' : run.status === 'error' ? ' is-err' : ''}`} />
                <div class="plg-run__text">
                  <span class="plg-run__name">{run.actionName}</span>
                  <span class="plg-run__detail">{run.error ?? run.summary}</span>
                </div>
                <span class="plg-run__time">{relativeTime(run.at, locale)}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
  };
  },
);

export default BehaviorView;
</script>

<style scoped>
.rule-template-head-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
</style>
