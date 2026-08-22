import type { JSX } from 'preact';

import type { UiEvent } from '../shared/messages.ts';
import { t, type Locale } from './i18n.ts';
import type { Theme } from './preferences.ts';

export type WizardStep = 'setup' | 'messages';
export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'retrying' | 'disconnected' | 'error';
export type DisplayEvent = UiEvent & { id: number; receivedAt: number };

type BrandHeaderProps = {
  locale: Locale;
  theme: Theme;
  onLocaleChange: (locale: Locale) => void;
  onThemeChange: (theme: Theme) => void;
};

export function BrandHeader({ locale, theme, onLocaleChange, onThemeChange }: BrandHeaderProps) {
  return (
    <header className="brand">
      <div className="brand-mark">♪</div>
      <div className="brand-copy">
        <p className="eyebrow">{t(locale, 'desktopExample')}</p>
        <h1>TikTok LIVE Inbox</h1>
        <p className="brand-note">{t(locale, 'brandNote')}</p>
      </div>
      <div className="brand-tools">
        <label className="preference">
          <span>{t(locale, 'language')}</span>
          <select
            aria-label={t(locale, 'language')}
            value={locale}
            onChange={(event) => onLocaleChange(event.currentTarget.value as Locale)}
          >
            <option value="en">{t(locale, 'english')}</option>
            <option value="es">{t(locale, 'spanish')}</option>
          </select>
        </label>
        <label className="preference">
          <span>{t(locale, 'theme')}</span>
          <select
            aria-label={t(locale, 'theme')}
            value={theme}
            onChange={(event) => onThemeChange(event.currentTarget.value as Theme)}
          >
            <option value="dark">{t(locale, 'dark')}</option>
            <option value="light">{t(locale, 'light')}</option>
          </select>
        </label>
        <div className="tray-note"><span className="tray-dot" />{t(locale, 'runsFromTray')}</div>
      </div>
    </header>
  );
}

type StepBarProps = {
  current: WizardStep;
  locale: Locale;
};

export function StepBar({ current, locale }: StepBarProps) {
  const setupDone = current === 'messages';
  return (
    <nav className="steps" aria-label={t(locale, 'setupProgress')}>
      <div className={'step ' + (current === 'setup' ? 'active' : '') + (setupDone ? ' done' : '')}>
        <span className="step-number">1</span>
        <span>{t(locale, 'setup')}</span>
      </div>
      <div className={'step ' + (current === 'messages' ? 'active' : '')}>
        <span className="step-number">2</span>
        <span>{t(locale, 'messages')}</span>
      </div>
    </nav>
  );
}

type SetupViewProps = {
  locale: Locale;
  uniqueId: string;
  cookie: string;
  error: string;
  busy: boolean;
  onUniqueIdChange: (value: string) => void;
  onCookieChange: (value: string) => void;
  onSubmit: (event: JSX.TargetedEvent<HTMLFormElement, SubmitEvent>) => void;
  onPickLive: () => void;
};

export function SetupView({
  locale,
  uniqueId,
  cookie,
  error,
  busy,
  onUniqueIdChange,
  onCookieChange,
  onSubmit,
  onPickLive,
}: SetupViewProps) {
  return (
    <section className="view">
      <div>
        <h2>{t(locale, 'connectToLive')}</h2>
        <p className="lead">{t(locale, 'setupLead')}</p>
        <form className="form" onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="unique-id">{t(locale, 'creatorHandle')}</label>
            <input
              id="unique-id"
              type="text"
              value={uniqueId}
              autoComplete="off"
              spellcheck={false}
              placeholder="@creator"
              onInput={(event) => onUniqueIdChange(event.currentTarget.value)}
            />
            <p className="hint">{t(locale, 'leadingAtOptional')}</p>
          </div>
          <div className="field">
            <label htmlFor="session-cookie">
              {t(locale, 'authenticatedCookie')} <span className="optional">{t(locale, 'optional')}</span>
            </label>
            <input
              id="session-cookie"
              type="password"
              value={cookie}
              autoComplete="off"
              spellcheck={false}
              placeholder={t(locale, 'cookiePlaceholder')}
              onInput={(event) => onCookieChange(event.currentTarget.value)}
            />
            <p className="hint">{t(locale, 'guestCookieHint')}</p>
          </div>
          {error ? <div className="error">{error}</div> : null}
          <div className="actions">
            <button className="secondary" type="button" disabled={busy} onClick={onPickLive}>
              {t(locale, 'pickLive')}
            </button>
            <button className="primary" type="submit" disabled={busy}>
              {t(locale, 'connect')}
            </button>
          </div>
        </form>
      </div>
      <p className="footer">{t(locale, 'cookiesMemory')}</p>
    </section>
  );
}

type MessagesViewProps = {
  locale: Locale;
  title: string;
  status: ConnectionStatus;
  events: DisplayEvent[];
  onDisconnect: () => void;
};

function statusLabel(locale: Locale, status: ConnectionStatus): string {
  if (status === 'connected') return t(locale, 'live');
  if (status === 'retrying') return t(locale, 'retrying');
  if (status === 'disconnected') return t(locale, 'disconnected');
  if (status === 'error') return t(locale, 'needsAttention');
  if (status === 'idle') return t(locale, 'waiting');
  return t(locale, 'connecting');
}

export function MessagesView({ locale, title, status, events, onDisconnect }: MessagesViewProps) {
  return (
    <section className="view">
      <div className="live-header">
        <div>
          <h2>{t(locale, 'liveMessages')}</h2>
          <p className="live-title">{title}</p>
        </div>
        <div className={'status ' + (status === 'connected' ? 'online' : status === 'error' || status === 'disconnected' ? 'offline' : 'busy')}>
          {statusLabel(locale, status)}
        </div>
      </div>
      <div className="message-list">
        {events.length === 0 ? (
          <div className="empty">{t(locale, 'messagesEmpty')}</div>
        ) : (
          events.map((event) => (
            <article className={'message ' + event.kind} key={event.id}>
              <span className="message-bar" />
              <div>
                <div className="message-author">{event.author}</div>
                <div className="message-text">{event.text}</div>
              </div>
              <time className="message-time">
                {new Date(event.receivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </time>
            </article>
          ))
        )}
      </div>
      <div className="actions">
        <span className="count">
          {t(locale, events.length === 1 ? 'messageCountOne' : 'messageCountMany', { count: events.length })}
        </span>
        <span className="spacer" />
        <button className="danger" type="button" onClick={onDisconnect}>{t(locale, 'disconnect')}</button>
      </div>
    </section>
  );
}
