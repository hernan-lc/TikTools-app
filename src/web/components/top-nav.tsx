import { t, type Locale } from '../i18n.ts';
import type { Theme } from '../preferences.ts';
import type { ConnectionStatus } from '../types.ts';
import { AppIcon } from './app-icon.tsx';
import {
  IconGlobe,
  IconMoon,
  IconPower,
  IconRefresh,
  IconSun,
} from './icons.tsx';

type TopNavProps = {
  locale: Locale;
  theme: Theme;
  status: ConnectionStatus;
  activeCreator: string;
  onThemeToggle: () => void;
  onLocaleToggle: () => void;
  onReconnect: () => void;
  onDisconnect: () => void;
};

export function TopNav({
  locale,
  theme,
  status,
  activeCreator,
  onThemeToggle,
  onLocaleToggle,
  onReconnect,
  onDisconnect,
}: TopNavProps) {
  const isConnected = status === 'connected';
  const isBusy = status === 'connecting' || status === 'retrying';

  return (
    <header class="top-nav">
      <div class="brand-section">
        <div class="brand-logo" data-tooltip="TikTok LIVE" data-tooltip-pos="bottom">
          <AppIcon size={28} />
        </div>
        <div class="brand-info">
          <h1>
            TikTok LIVE
            <span class={`badge-live ${isConnected ? 'live' : isBusy ? 'busy' : 'offline'}`}>
              {status === 'connected' ? t(locale, 'live') : isBusy ? t(locale, 'connecting') : t(locale, 'disconnected')}
            </span>
          </h1>
        </div>
      </div>

      <div class="top-center">
        {activeCreator ? (
          <div class="active-creator-pill" data-tooltip={`Status: ${status}`} data-tooltip-pos="bottom">
            <span class={`status-dot ${isConnected ? 'online' : isBusy ? 'busy' : 'offline'}`} />
            <span>@{activeCreator.replace(/^@/, '')}</span>
          </div>
        ) : null}
      </div>

      <div class="top-actions">
        {isConnected ? (
          <>
            <button
              class="btn-icon"
              type="button"
              data-tooltip={t(locale, 'reconnect')}
              data-tooltip-pos="bottom"
              onClick={onReconnect}
            >
              <IconRefresh />
            </button>
            <button
              class="btn-icon btn-danger"
              type="button"
              data-tooltip={t(locale, 'disconnect')}
              data-tooltip-pos="bottom"
              onClick={onDisconnect}
            >
              <IconPower />
            </button>
          </>
        ) : null}

        <button
          class="btn-icon"
          type="button"
          data-tooltip={t(locale, 'switchTheme')}
          data-tooltip-pos="bottom"
          onClick={onThemeToggle}
        >
          {theme === 'dark' ? <IconSun /> : <IconMoon />}
        </button>

        <button
          class="btn-icon"
          type="button"
          data-tooltip={t(locale, 'switchLanguage') + ` (${locale.toUpperCase()})`}
          data-tooltip-pos="bottom"
          onClick={onLocaleToggle}
        >
          <IconGlobe />
        </button>
      </div>
    </header>
  );
}
