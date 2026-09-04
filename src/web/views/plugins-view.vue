<script lang="tsx">
import { ref } from 'vue';
import { defineVueComponent } from '../vue/component.ts';

import type { ActionTypeDefinition, LiveAction, PluginStatus } from '../../automation/behavior/types.ts';
import type { JsonObject } from '../../automation/types.ts';
import type { PluginSettingValues } from '../../shared/messages.ts';
import type { PluginSettingsState } from '../types.ts';
import { SchemaForm } from '../components/ui/SchemaForm.vue';
import { i18nText, t, type Locale } from '../i18n.ts';

type PluginsViewProps = {
  locale: Locale;
  plugins: PluginStatus[];
  actions: LiveAction[];
  actionTypes: ActionTypeDefinition[];
  error?: string;
  onSetInstalled: (id: string, installed: boolean) => void;
  onSetEnabled: (id: string, enabled: boolean) => void;
  settings: Record<string, PluginSettingsState>;
  onGetSettings: (id: string) => void;
  onSaveSettings: (id: string, values: PluginSettingValues) => void;
};

function pluginCopy(locale: Locale) {
  return {
    title: t(locale, 'pluginsTitle'),
    lead: t(locale, 'pluginsLead'),
    builtInLabel: t(locale, 'builtInActions'),
    builtInNote: t(locale, 'builtInActionsNote'),
    installed: t(locale, 'pluginsInstalled'),
    store: t(locale, 'pluginsBrowse'),
    actionsLabel: t(locale, 'pluginActionsLabel'),
    install: t(locale, 'pluginInstall'),
    uninstall: t(locale, 'pluginUninstall'),
    active: t(locale, 'pluginActive'),
    disabled: t(locale, 'pluginDisabled'),
    unavailable: t(locale, 'pluginUnavailable'),
    emptyInstalled: t(locale, 'pluginsEmpty'),
    explore: t(locale, 'pluginsBrowse'),
    usedBy: (count: number) => t(locale, 'pluginUsedBy', { count }),
    confirm: t(locale, 'pluginUninstallConfirm'),
    settings: t(locale, 'pluginSettings'),
    saveSettings: t(locale, 'pluginSettingsSave'),
    settingsHint: t(locale, 'pluginSettingsHint'),
  };
}

export const PluginsView = defineVueComponent<PluginsViewProps>(
  ['locale', 'plugins', 'actions', 'actionTypes', 'error', 'onSetInstalled', 'onSetEnabled', 'settings', 'onGetSettings', 'onSaveSettings'],
  (props) => {
  const tab = ref<'installed' | 'store'>('installed');

  return () => {
  const copy = pluginCopy(props.locale);
  const installed = props.plugins.filter((plugin) => plugin.installed);
  const visible = tab.value === 'installed' ? installed : props.plugins;

  return (
    <div class="plg">
      <div class="plg-topbar">
        <div class="plg-topbar__text">
          <h2 class="plg-topbar__title">{copy.title}</h2>
          <span class="plg-topbar__subtitle">{copy.lead}</span>
        </div>
      </div>

      <div class="plg-tabs" style="padding: 0 16px;">
        <button
          type="button"
          class={`plg-tab${tab.value === 'installed' ? ' is-active' : ''}`}
          onClick={() => { tab.value = 'installed'; }}
        >
          {copy.installed} · {installed.length}
        </button>
        <button
          type="button"
          class={`plg-tab${tab.value === 'store' ? ' is-active' : ''}`}
          onClick={() => { tab.value = 'store'; }}
        >
          {copy.store} · {props.plugins.length}
        </button>
      </div>

      {props.error && <div class="plg-stack"><div class="plg-alert">{props.error}</div></div>}

      <div class="plg-scroll">
        <div class="plg-stack">
          {tab.value === 'installed' && (
            <div class="plg-banner">
              <span class="plg-dot is-ok" />
              <span class="plg-banner__label">{copy.builtInLabel}</span>
              <span class="plg-banner__list">
                {props.actionTypes.filter((type) => type.source.kind === 'builtin').map((type) => i18nText(props.locale, type.title)).join(' · ')}
              </span>
              <span class="plg-banner__note">{copy.builtInNote}</span>
            </div>
          )}

          {visible.map((plugin) => {
            const usedBy = props.actions.filter((action) => {
              const type = props.actionTypes.find((entry) => entry.id === action.typeId);
              return type?.source.kind === 'plugin' && type.source.pluginId === plugin.descriptor.id;
            }).length;

            return (
              <div
                class={`plg-plugin${plugin.installed && !plugin.enabled ? ' is-off' : ''}`}
                key={plugin.descriptor.id}
              >
                <div class="plg-plugin__head">
                  <div class="plg-field">
                    <div class="plg-plugin__title">
                      <span class="plg-plugin__name">{i18nText(props.locale, plugin.descriptor.name)}</span>
                      <span class="plg-pill plg-pill--mono">{plugin.descriptor.version}</span>
                      {plugin.installed && (
                        <span class={`plg-pill${plugin.enabled ? ' plg-pill--accent' : ''}`}>
                          {plugin.enabled ? copy.active : copy.disabled}
                        </span>
                      )}
                      {!plugin.available && <span class="plg-pill">{copy.unavailable}</span>}
                    </div>
                    <span class="plg-plugin__desc">{i18nText(props.locale, plugin.descriptor.description)}</span>
                    <div class="plg-table__chips">
                      <span class="plg-group-note">{copy.actionsLabel}</span>
                      {plugin.descriptor.actionTypeIds.map((id) => (
                        <span class="plg-pill" key={id}>
                          {(() => {
                            const type = props.actionTypes.find((entry) => entry.id === id);
                            return type ? i18nText(props.locale, type.title) : id;
                          })()}
                        </span>
                      ))}
                    </div>
                    <div class="plg-plugin__meta">
                      <span>{i18nText(props.locale, plugin.descriptor.dependency)}</span>
                      <span>·</span>
                      <span>{plugin.descriptor.permissions.join(' · ')}</span>
                    </div>
                  </div>

                  <div class="plg-plugin__controls">
                    {plugin.installed && (
                      <button
                        type="button"
                        class={`plg-switch${plugin.enabled ? ' is-on' : ''}`}
                        aria-label={i18nText(props.locale, plugin.descriptor.name)}
                        onClick={() => props.onSetEnabled(plugin.descriptor.id, !plugin.enabled)}
                      >
                        <span class="plg-switch__track"><span class="plg-switch__thumb" /></span>
                      </button>
                    )}
                    <button
                      type="button"
                      class={`plg-btn plg-btn--sm${plugin.installed ? ' plg-btn--danger' : ' plg-btn--primary'}`}
                      onClick={() => {
                        if (plugin.installed && !confirm(copy.confirm)) return;
                        props.onSetInstalled(plugin.descriptor.id, !plugin.installed);
                      }}
                    >
                      {plugin.installed ? copy.uninstall : copy.install}
                    </button>
                  </div>
                </div>

                {plugin.installed && usedBy > 0 && (
                  <div class="plg-warn">
                    <strong>{copy.uninstall}:</strong>
                    {copy.usedBy(usedBy)}
                  </div>
                )}

                {plugin.installed && plugin.descriptor.hasSettings && (
                  <PluginSettingsForm
                    locale={props.locale}
                    pluginId={plugin.descriptor.id}
                    plugin={plugin}
                    state={props.settings[plugin.descriptor.id]}
                    onGetSettings={props.onGetSettings}
                    onSaveSettings={props.onSaveSettings}
                  />
                )}
              </div>
            );
          })}

          {visible.length === 0 && (
            <div class="plg-empty">
              <span class="plg-empty__desc">{copy.emptyInstalled}</span>
              <button type="button" class="plg-btn plg-btn--primary" onClick={() => { tab.value = 'store'; }}>
                {copy.explore}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
  };
  },
);

/** Host-rendered JSON settings for one plugin. Nothing here executes plugin code. */
type PluginSettingsFormProps = {
  locale: Locale;
  pluginId: string;
  plugin: PluginStatus;
  state?: PluginSettingsState;
  onGetSettings: (id: string) => void;
  onSaveSettings: (id: string, values: PluginSettingValues) => void;
};

const PluginSettingsForm = defineVueComponent<PluginSettingsFormProps>(
  ['locale', 'pluginId', 'plugin', 'state', 'onGetSettings', 'onSaveSettings'],
  (props) => {
  const open = ref(false);
  const draft = ref<JsonObject | null>(null);

  return () => {
  if (!props.plugin.descriptor.hasSettings) return null;
  const state = props.state;
  return (
    <div class="plg-plugin__settings">
      <button
        type="button"
        class="plg-btn plg-btn--sm"
        onClick={() => {
          if (!open.value && !state) props.onGetSettings(props.pluginId);
          if (!open.value) draft.value = null;
          open.value = !open.value;
        }}
      >
        {t(props.locale, 'pluginSettings')}
      </button>
      {open.value && state && (
        <div class="plg-form">
          <span class="plg-group-note">{t(props.locale, 'pluginSettingsHint')}</span>
          <SchemaForm
            locale={props.locale}
            schema={state.schema}
            uiHints={state.uiHints}
            value={draft.value ?? state.values}
            onChange={(value) => { draft.value = value; }}
          />
          <div class="plg-row">
            <button
              type="button"
              class="plg-btn plg-btn--primary plg-btn--sm"
              onClick={() => props.onSaveSettings(props.pluginId, toSettingValues(draft.value ?? state.values))}
            >
              {t(props.locale, 'pluginSettingsSave')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
  };
  },
);

function toSettingValues(value: JsonObject): PluginSettingValues {
  const clean: PluginSettingValues = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') clean[key] = entry;
  }
  return clean;
}

export default PluginsView;
</script>
