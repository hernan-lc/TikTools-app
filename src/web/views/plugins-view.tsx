import { useEffect, useState } from 'preact/hooks';

import type { ActionTypeDefinition, LiveAction, PluginStatus } from '../../automation/behavior/types.ts';
import type { JsonObject } from '../../automation/types.ts';
import type { PluginSettingValues } from '../../shared/messages.ts';
import type { PluginSettingsState } from '../app.tsx';
import { SchemaForm } from '../components/ui/SchemaForm.tsx';
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

export function PluginsView({
  locale,
  plugins,
  actions,
  actionTypes,
  error,
  onSetInstalled,
  onSetEnabled,
  settings,
  onGetSettings,
  onSaveSettings,
}: PluginsViewProps) {
  const copy = pluginCopy(locale);
  const [tab, setTab] = useState<'installed' | 'store'>('installed');

  const installed = plugins.filter((plugin) => plugin.installed);
  const visible = tab === 'installed' ? installed : plugins;

  return (
    <div className="plg">
      <div className="plg-topbar">
        <div className="plg-topbar__text">
          <h2 className="plg-topbar__title">{copy.title}</h2>
          <span className="plg-topbar__subtitle">{copy.lead}</span>
        </div>
      </div>

      <div className="plg-tabs" style="padding: 0 16px;">
        <button
          type="button"
          className={`plg-tab${tab === 'installed' ? ' is-active' : ''}`}
          onClick={() => setTab('installed')}
        >
          {copy.installed} · {installed.length}
        </button>
        <button
          type="button"
          className={`plg-tab${tab === 'store' ? ' is-active' : ''}`}
          onClick={() => setTab('store')}
        >
          {copy.store} · {plugins.length}
        </button>
      </div>

      {error && <div className="plg-stack"><div className="plg-alert">{error}</div></div>}

      <div className="plg-scroll">
        <div className="plg-stack">
          {tab === 'installed' && (
            <div className="plg-banner">
              <span className="plg-dot is-ok" />
              <span className="plg-banner__label">{copy.builtInLabel}</span>
              <span className="plg-banner__list">
                {actionTypes.filter((type) => type.source.kind === 'builtin').map((type) => i18nText(locale, type.title)).join(' · ')}
              </span>
              <span className="plg-banner__note">{copy.builtInNote}</span>
            </div>
          )}

          {visible.map((plugin) => {
            const usedBy = actions.filter((action) => {
              const type = actionTypes.find((entry) => entry.id === action.typeId);
              return type?.source.kind === 'plugin' && type.source.pluginId === plugin.descriptor.id;
            }).length;

            return (
              <div
                className={`plg-plugin${plugin.installed && !plugin.enabled ? ' is-off' : ''}`}
                key={plugin.descriptor.id}
              >
                <div className="plg-plugin__head">
                  <div className="plg-field">
                    <div className="plg-plugin__title">
                      <span className="plg-plugin__name">{i18nText(locale, plugin.descriptor.name)}</span>
                      <span className="plg-pill plg-pill--mono">{plugin.descriptor.version}</span>
                      {plugin.installed && (
                        <span className={`plg-pill${plugin.enabled ? ' plg-pill--accent' : ''}`}>
                          {plugin.enabled ? copy.active : copy.disabled}
                        </span>
                      )}
                      {!plugin.available && <span className="plg-pill">{copy.unavailable}</span>}
                    </div>
                    <span className="plg-plugin__desc">{i18nText(locale, plugin.descriptor.description)}</span>
                    <div className="plg-table__chips">
                      <span className="plg-group-note">{copy.actionsLabel}</span>
                      {plugin.descriptor.actionTypeIds.map((id) => (
                        <span className="plg-pill" key={id}>
                          {(() => {
                            const type = actionTypes.find((entry) => entry.id === id);
                            return type ? i18nText(locale, type.title) : id;
                          })()}
                        </span>
                      ))}
                    </div>
                    <div className="plg-plugin__meta">
                      <span>{i18nText(locale, plugin.descriptor.dependency)}</span>
                      <span>·</span>
                      <span>{plugin.descriptor.permissions.join(' · ')}</span>
                    </div>
                  </div>

                  <div className="plg-plugin__controls">
                    {plugin.installed && (
                      <button
                        type="button"
                        className={`plg-switch${plugin.enabled ? ' is-on' : ''}`}
                        aria-label={i18nText(locale, plugin.descriptor.name)}
                        onClick={() => onSetEnabled(plugin.descriptor.id, !plugin.enabled)}
                      >
                        <span className="plg-switch__track"><span className="plg-switch__thumb" /></span>
                      </button>
                    )}
                    <button
                      type="button"
                      className={`plg-btn plg-btn--sm${plugin.installed ? ' plg-btn--danger' : ' plg-btn--primary'}`}
                      onClick={() => {
                        if (plugin.installed && !confirm(copy.confirm)) return;
                        onSetInstalled(plugin.descriptor.id, !plugin.installed);
                      }}
                    >
                      {plugin.installed ? copy.uninstall : copy.install}
                    </button>
                  </div>
                </div>

                {plugin.installed && usedBy > 0 && (
                  <div className="plg-warn">
                    <strong>{copy.uninstall}:</strong>
                    {copy.usedBy(usedBy)}
                  </div>
                )}

                {plugin.installed && plugin.descriptor.hasSettings && (
                  <PluginSettingsForm
                    locale={locale}
                    pluginId={plugin.descriptor.id}
                    plugin={plugin}
                    state={settings[plugin.descriptor.id]}
                    onGetSettings={onGetSettings}
                    onSaveSettings={onSaveSettings}
                  />
                )}
              </div>
            );
          })}

          {visible.length === 0 && (
            <div className="plg-empty">
              <span className="plg-empty__desc">{copy.emptyInstalled}</span>
              <button type="button" className="plg-btn plg-btn--primary" onClick={() => setTab('store')}>
                {copy.explore}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Host-rendered JSON settings for one plugin. Nothing here executes plugin code. */
function PluginSettingsForm({
  locale,
  pluginId,
  plugin,
  state,
  onGetSettings,
  onSaveSettings,
}: {
  locale: Locale;
  pluginId: string;
  plugin: PluginStatus;
  state?: PluginSettingsState;
  onGetSettings: (id: string) => void;
  onSaveSettings: (id: string, values: PluginSettingValues) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<JsonObject | null>(null);
  useEffect(() => {
    if (open && state) setDraft((current) => current ?? { ...state.values });
  }, [open, state]);
  if (!plugin.descriptor.hasSettings) return null;
  return (
    <div className="plg-plugin__settings">
      <button
        type="button"
        className="plg-btn plg-btn--sm"
        onClick={() => {
          if (!open && !state) onGetSettings(pluginId);
          if (!open) setDraft(null);
          setOpen(!open);
        }}
      >
        {t(locale, 'pluginSettings')}
      </button>
      {open && state && (
        <div className="plg-form">
          <span className="plg-group-note">{t(locale, 'pluginSettingsHint')}</span>
          <SchemaForm
            locale={locale}
            schema={state.schema}
            uiHints={state.uiHints}
            value={draft ?? state.values}
            onChange={(value) => setDraft(value)}
          />
          <div className="plg-row">
            <button
              type="button"
              className="plg-btn plg-btn--primary plg-btn--sm"
              onClick={() => onSaveSettings(pluginId, toSettingValues(draft ?? state.values))}
            >
              {t(locale, 'pluginSettingsSave')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function toSettingValues(value: JsonObject): PluginSettingValues {
  const clean: PluginSettingValues = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') clean[key] = entry;
  }
  return clean;
}
