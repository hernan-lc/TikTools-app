import { useState } from 'preact/hooks';

import { BUILTIN_ACTION_TYPES, findActionType } from '../../automation/behavior/catalog.ts';
import type { LiveAction, PluginStatus } from '../../automation/behavior/types.ts';
import type { Locale } from '../i18n.ts';

type PluginsViewProps = {
  locale: Locale;
  plugins: PluginStatus[];
  actions: LiveAction[];
  error?: string;
  onSetInstalled: (id: string, installed: boolean) => void;
  onSetEnabled: (id: string, enabled: boolean) => void;
};

const COPY = {
  es: {
    title: 'Plugins',
    lead: 'Un plugin trae una dependencia y expone una o varias acciones. Las acciones integradas no viven aquí: existen siempre.',
    builtInLabel: 'Acciones integradas',
    builtInNote: 'sin dependencias · no se desinstalan',
    installed: 'Instalados',
    store: 'Explorar',
    actionsLabel: 'Acciones que aporta:',
    install: 'Instalar',
    uninstall: 'Desinstalar',
    installedTag: 'instalado',
    active: 'activo',
    disabled: 'desactivado',
    unavailable: 'dependencia no disponible',
    emptyInstalled: 'Sin plugins instalados. Las acciones integradas siguen funcionando; instala uno sólo cuando necesites algo de fuera.',
    explore: 'Explorar',
    usedBy: (count: number) => `${count} acción(es) lo usan y dejarán de funcionar.`,
    confirm: '¿Desinstalar este plugin?',
  },
  en: {
    title: 'Plugins',
    lead: 'A plugin brings a dependency and exposes one or more actions. Built-in actions do not live here: they always exist.',
    builtInLabel: 'Built-in actions',
    builtInNote: 'no dependencies · cannot be uninstalled',
    installed: 'Installed',
    store: 'Browse',
    actionsLabel: 'Actions it adds:',
    install: 'Install',
    uninstall: 'Uninstall',
    installedTag: 'installed',
    active: 'active',
    disabled: 'disabled',
    unavailable: 'dependency unavailable',
    emptyInstalled: 'No plugins installed. Built-in actions keep working; install one only when you need something from outside.',
    explore: 'Browse',
    usedBy: (count: number) => `${count} action(s) use it and will stop working.`,
    confirm: 'Uninstall this plugin?',
  },
} as const;

export function PluginsView({
  locale,
  plugins,
  actions,
  error,
  onSetInstalled,
  onSetEnabled,
}: PluginsViewProps) {
  const copy = COPY[locale];
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
                {BUILTIN_ACTION_TYPES.map((type) => type.title[locale]).join(' · ')}
              </span>
              <span className="plg-banner__note">{copy.builtInNote}</span>
            </div>
          )}

          {visible.map((plugin) => {
            const usedBy = actions.filter((action) => {
              const type = findActionType(action.typeId);
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
                      <span className="plg-plugin__name">{plugin.descriptor.name}</span>
                      <span className="plg-pill plg-pill--mono">{plugin.descriptor.version}</span>
                      {plugin.installed && (
                        <span className={`plg-pill${plugin.enabled ? ' plg-pill--accent' : ''}`}>
                          {plugin.enabled ? copy.active : copy.disabled}
                        </span>
                      )}
                      {!plugin.available && <span className="plg-pill">{copy.unavailable}</span>}
                    </div>
                    <span className="plg-plugin__desc">{plugin.descriptor.description[locale]}</span>
                    <div className="plg-table__chips">
                      <span className="plg-group-note">{copy.actionsLabel}</span>
                      {plugin.descriptor.actionTypeIds.map((id) => (
                        <span className="plg-pill" key={id}>
                          {findActionType(id)?.title[locale] ?? id}
                        </span>
                      ))}
                    </div>
                    <div className="plg-plugin__meta">
                      <span>{plugin.descriptor.dependency[locale]}</span>
                      <span>·</span>
                      <span>{plugin.descriptor.permissions.join(' · ')}</span>
                    </div>
                  </div>

                  <div className="plg-plugin__controls">
                    {plugin.installed && (
                      <button
                        type="button"
                        className={`plg-switch${plugin.enabled ? ' is-on' : ''}`}
                        aria-label={plugin.descriptor.name}
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
