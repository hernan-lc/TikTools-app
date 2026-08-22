import type { JSX } from 'preact';

import type { UiEvent } from '../shared/messages.ts';
import { t, type Locale } from './i18n.ts';
import type { Theme } from './preferences.ts';

export type WizardStep = 'preferences' | 'configuration' | 'dashboard';
export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'retrying' | 'disconnected' | 'error';
export type DisplayEvent = UiEvent & { id: number; receivedAt: number };

type BrandHeaderProps = {
  locale: Locale;
  onOpenPreferences: () => void;
};

export function BrandHeader({ locale, onOpenPreferences }: BrandHeaderProps) {
  return (
    <header className="brand">
      <div className="brand-mark">♪</div>
      <div className="brand-copy">
        <p className="eyebrow">{t(locale, 'desktopExample')}</p>
        <h1>TikTok LIVE Inbox</h1>
        <p className="brand-note">{t(locale, 'brandNote')}</p>
      </div>
      <div className="brand-tools">
        <button className="secondary compact preference-button" type="button" aria-label={t(locale, 'openPreferences')} onClick={onOpenPreferences}>
          ◐ {t(locale, 'preferences')}
        </button>
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
  const steps: Array<{ key: WizardStep; number: number; label: string }> = [
    { key: 'preferences', number: 1, label: t(locale, 'preferences') },
    { key: 'configuration', number: 2, label: t(locale, 'configuration') },
    { key: 'dashboard', number: 3, label: t(locale, 'dashboard') },
  ];
  const currentIndex = steps.findIndex((item) => item.key === current);
  return (
    <nav className="steps" aria-label={t(locale, 'setupProgress')}>
      {steps.map((item, index) => (
        <div className={'step ' + (current === item.key ? 'active' : '') + (index < currentIndex ? ' done' : '')} key={item.key}>
          <span className="step-number">{item.number}</span>
          <span>{item.label}</span>
        </div>
      ))}
    </nav>
  );
}

type PreferenceFieldsProps = {
  locale: Locale;
  theme: Theme;
  idPrefix?: string;
  onLocaleChange: (locale: Locale) => void;
  onThemeChange: (theme: Theme) => void;
};

function PreferenceFields({ locale, theme, idPrefix = 'preferences', onLocaleChange, onThemeChange }: PreferenceFieldsProps) {
  const languageId = idPrefix + '-language';
  const themeId = idPrefix + '-theme';
  return (
    <div className="preference-fields">
      <div className="field">
        <label htmlFor={languageId}>{t(locale, 'language')}</label>
        <select
          id={languageId}
          value={locale}
          onChange={(event) => onLocaleChange(event.currentTarget.value as Locale)}
        >
          <option value="en">{t(locale, 'english')}</option>
          <option value="es">{t(locale, 'spanish')}</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor={themeId}>{t(locale, 'theme')}</label>
        <select
          id={themeId}
          value={theme}
          onChange={(event) => onThemeChange(event.currentTarget.value as Theme)}
        >
          <option value="dark">{t(locale, 'dark')}</option>
          <option value="light">{t(locale, 'light')}</option>
        </select>
      </div>
    </div>
  );
}

type PreferencesViewProps = PreferenceFieldsProps & {
  onContinue: () => void;
};

export function PreferencesView({ locale, theme, onLocaleChange, onThemeChange, onContinue }: PreferencesViewProps) {
  return (
    <section className="view">
      <div>
        <h2>{t(locale, 'preferences')}</h2>
        <p className="lead">{t(locale, 'preferencesLead')}</p>
        <div className="form">
          <PreferenceFields
            locale={locale}
            theme={theme}
            idPrefix="onboarding"
            onLocaleChange={onLocaleChange}
            onThemeChange={onThemeChange}
          />
        </div>
      </div>
      <div className="actions">
        <span className="count">{t(locale, 'preferences')}</span>
        <span className="spacer" />
        <button className="primary" type="button" onClick={onContinue}>{t(locale, 'continue')}</button>
      </div>
    </section>
  );
}

type PreferencesModalProps = PreferenceFieldsProps & {
  onClose: () => void;
};

export function PreferencesModal({ locale, theme, onLocaleChange, onThemeChange, onClose }: PreferencesModalProps) {
  return (
    <div className="modal-backdrop">
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="preferences-title">
        <div className="modal-header">
          <div>
            <p className="eyebrow">{t(locale, 'preferences')}</p>
            <h2 id="preferences-title">{t(locale, 'preferences')}</h2>
          </div>
          <button className="modal-close" type="button" aria-label={t(locale, 'cancel')} onClick={onClose}>×</button>
        </div>
        <p className="lead">{t(locale, 'preferencesLead')}</p>
        <PreferenceFields
          locale={locale}
          theme={theme}
          idPrefix="modal"
          onLocaleChange={onLocaleChange}
          onThemeChange={onThemeChange}
        />
        <div className="actions modal-actions">
          <span className="spacer" />
          <button className="primary" type="button" onClick={onClose}>{t(locale, 'done')}</button>
        </div>
      </section>
    </div>
  );
}

type ConfigurationViewProps = {
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

export function ConfigurationView({
  locale,
  uniqueId,
  cookie,
  error,
  busy,
  onUniqueIdChange,
  onCookieChange,
  onSubmit,
  onPickLive,
}: ConfigurationViewProps) {
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
  onOpenConfig: () => void;
  onReconnect: () => void;
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

export function MessagesView({ locale, title, status, events, onOpenConfig, onReconnect, onDisconnect }: MessagesViewProps) {
  return (
    <section className="view">
      <div className="live-header">
        <div>
          <h2>{t(locale, 'liveMessages')}</h2>
          <p className="live-title">{title}</p>
        </div>
        <div className="live-header-actions">
          <div className={'status ' + (status === 'connected' ? 'online' : status === 'error' || status === 'disconnected' ? 'offline' : 'busy')}>
            {statusLabel(locale, status)}
          </div>
          <button className="secondary compact" type="button" aria-label={t(locale, 'openConfiguration')} onClick={onOpenConfig}>
            ⚙ {t(locale, 'configuration')}
          </button>
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
        <button className="secondary" type="button" onClick={onReconnect}>{t(locale, 'reconnect')}</button>
        <button className="danger" type="button" onClick={onDisconnect}>{t(locale, 'disconnect')}</button>
      </div>
    </section>
  );
}

type ConfigModalProps = {
  locale: Locale;
  username: string;
  cookie: string;
  error: string;
  onUsernameChange: (value: string) => void;
  onCookieChange: (value: string) => void;
  onSubmit: (event: JSX.TargetedEvent<HTMLFormElement, SubmitEvent>) => void;
  onCancel: () => void;
};

export function ConfigModal({
  locale,
  username,
  cookie,
  error,
  onUsernameChange,
  onCookieChange,
  onSubmit,
  onCancel,
}: ConfigModalProps) {
  return (
    <div className="modal-backdrop">
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="config-title">
        <div className="modal-header">
          <div>
            <p className="eyebrow">{t(locale, 'configuration')}</p>
            <h2 id="config-title">{t(locale, 'configuration')}</h2>
          </div>
          <button className="modal-close" type="button" aria-label={t(locale, 'cancel')} onClick={onCancel}>×</button>
        </div>
        <p className="lead">{t(locale, 'configLead')}</p>
        <form className="form modal-form" onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="config-username">{t(locale, 'username')}</label>
            <input
              id="config-username"
              type="text"
              value={username}
              autoComplete="off"
              spellcheck={false}
              placeholder={t(locale, 'usernamePlaceholder')}
              onInput={(event) => onUsernameChange(event.currentTarget.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="config-cookie">
              {t(locale, 'authenticatedCookie')} <span className="optional">{t(locale, 'optional')}</span>
            </label>
            <input
              id="config-cookie"
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
            <button className="secondary" type="button" onClick={onCancel}>{t(locale, 'cancel')}</button>
            <button className="primary" type="submit">{t(locale, 'saveAndConnect')}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
