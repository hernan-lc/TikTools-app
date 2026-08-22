import { useEffect, useRef, useState } from 'preact/hooks';
import { render, type JSX } from 'preact';

import type { HostMessage, PageMessage } from '../shared/messages.ts';
import {
  BrandHeader,
  ConfigModal,
  ConfigurationView,
  MessagesView,
  PreferencesModal,
  PreferencesView,
  StepBar,
  type ConnectionStatus,
  type DisplayEvent,
  type WizardStep,
} from './components.tsx';
import { t, type Locale } from './i18n.ts';
import {
  applyTheme,
  getInitialLocale,
  getInitialTheme,
  getSavedUsername,
  saveLocale,
  saveTheme,
  saveUsername,
  type Theme,
} from './preferences.ts';
import './styles.css';

declare global {
  interface Window {
    ipc?: { postMessage: (message: string) => void };
    __webview_on_message__?: (message: string) => void;
  }
}

type ConfigurationState = {
  uniqueId: string;
  cookie: string;
};

function send(message: PageMessage): void {
  window.ipc?.postMessage(JSON.stringify(message));
}

function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, '');
}

const initialLocale = getInitialLocale();
const initialTheme = getInitialTheme();
const initialUsername = getSavedUsername();
applyTheme(initialTheme);
document.documentElement.lang = initialLocale;

function App() {
  const [step, setStep] = useState<WizardStep>(initialUsername ? 'dashboard' : 'preferences');
  const [setup, setSetup] = useState<ConfigurationState>({ uniqueId: initialUsername, cookie: '' });
  const [savedUsername, setSavedUsername] = useState(initialUsername);
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [title, setTitle] = useState(t(initialLocale, 'waitingForConnection'));
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [error, setError] = useState('');
  const [events, setEvents] = useState<DisplayEvent[]>([]);
  const [configOpen, setConfigOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [configDraft, setConfigDraft] = useState<ConfigurationState>({ uniqueId: initialUsername, cookie: '' });
  const [configError, setConfigError] = useState('');
  const nextEventId = useRef(0);
  const usernameRef = useRef(initialUsername);

  const resetEvents = (): void => {
    nextEventId.current = 0;
    setEvents([]);
  };

  const establishUsername = (username: string): string => {
    const normalized = normalizeUsername(username);
    usernameRef.current = normalized;
    setSavedUsername(normalized);
    setSetup((current) => ({ ...current, uniqueId: normalized }));
    saveUsername(normalized);
    return normalized;
  };

  useEffect(() => {
    document.documentElement.lang = locale;
    saveLocale(locale);
  }, [locale]);

  useEffect(() => {
    applyTheme(theme);
    saveTheme(theme);
  }, [theme]);

  useEffect(() => {
    const receive = (raw: string): void => {
      let message: HostMessage;
      try {
        message = JSON.parse(raw) as HostMessage;
      } catch {
        return;
      }

      if (message.type === 'connection') {
        if (message.status === 'connecting') setStatus('connecting');
        if (message.title) setTitle(message.title);
        if (message.status === 'connected') setStatus('connected');
        if (message.status === 'disconnected') setStatus('disconnected');
      }
      if (message.type === 'reconnecting') setStatus('retrying');
      if (message.type === 'live-event') {
        setEvents((current) => [
          ...current,
          { ...message.event, id: nextEventId.current++, receivedAt: Date.now() },
        ].slice(-150));
      }
      if (message.type === 'error') {
        setStatus('error');
        if (message.phase === 'connect') {
          if (usernameRef.current) {
            setEvents((current) => [
              ...current,
              {
                kind: 'member' as const,
                author: t(locale, 'system'),
                text: message.message,
                id: nextEventId.current++,
                receivedAt: Date.now(),
              },
            ].slice(-150));
          } else {
            setStep('configuration');
            setError(message.message);
          }
        } else {
          setEvents((current) => [
            ...current,
            {
              kind: 'member' as const,
              author: t(locale, 'system'),
              text: message.message,
              id: nextEventId.current++,
              receivedAt: Date.now(),
            },
          ].slice(-150));
        }
      }
    };

    window.__webview_on_message__ = receive;
    return () => {
      if (window.__webview_on_message__ === receive) window.__webview_on_message__ = undefined;
    };
  }, [locale]);

  const startConnection = (message: PageMessage, nextTitle: string): void => {
    setError('');
    resetEvents();
    setTitle(nextTitle);
    setStatus('connecting');
    setStep('dashboard');
    send(message);
  };

  const startSavedConnection = (username: string, cookie: string): void => {
    const normalized = establishUsername(username);
    startConnection(
      { type: 'connect', uniqueId: normalized, sessionCookie: cookie.trim() },
      '@' + normalized,
    );
  };

  const handleSubmit = (event: JSX.TargetedEvent<HTMLFormElement, SubmitEvent>): void => {
    event.preventDefault();
    const uniqueId = normalizeUsername(setup.uniqueId);
    if (!uniqueId) {
      setError(t(locale, 'handleRequired'));
      return;
    }
    startSavedConnection(uniqueId, setup.cookie);
  };

  const handlePickLive = (): void => {
    startConnection(
      { type: 'pick-live', sessionCookie: setup.cookie.trim() },
      t(locale, 'searchingRooms'),
    );
  };

  const handleDisconnect = (): void => {
    send({ type: 'disconnect' });
    resetEvents();
    setStep(usernameRef.current ? 'dashboard' : 'configuration');
    setStatus('idle');
    setTitle(t(locale, 'waitingForConnection'));
    setError('');
  };

  const handleOpenConfig = (): void => {
    setConfigDraft({
      uniqueId: savedUsername || usernameRef.current || setup.uniqueId,
      cookie: setup.cookie,
    });
    setConfigError('');
    setConfigOpen(true);
  };

  const handleConfigCancel = (): void => {
    setConfigOpen(false);
    setConfigError('');
  };

  const handleOpenPreferences = (): void => {
    setPreferencesOpen(true);
  };

  const handleClosePreferences = (): void => {
    setPreferencesOpen(false);
  };

  const handleConfigSubmit = (event: JSX.TargetedEvent<HTMLFormElement, SubmitEvent>): void => {
    event.preventDefault();
    const username = normalizeUsername(configDraft.uniqueId);
    if (!username) {
      setConfigError(t(locale, 'handleRequired'));
      return;
    }
    setConfigOpen(false);
    setConfigError('');
    setSetup({ uniqueId: username, cookie: configDraft.cookie });
    startSavedConnection(username, configDraft.cookie);
  };

  const handleReconnect = (): void => {
    const username = usernameRef.current;
    if (!username) {
      handleOpenConfig();
      return;
    }
    startConnection(
      { type: 'connect', uniqueId: username, sessionCookie: setup.cookie.trim() },
      '@' + username,
    );
  };

  useEffect(() => {
    if (!initialUsername) return;
    startConnection(
      { type: 'connect', uniqueId: initialUsername, sessionCookie: '' },
      '@' + initialUsername,
    );
  }, []);

  return (
    <main className="shell">
      <BrandHeader
        locale={locale}
        onOpenPreferences={handleOpenPreferences}
      />
      <StepBar current={step} locale={locale} />
      <section className="card">
        {step === 'preferences' ? (
          <PreferencesView
            locale={locale}
            theme={theme}
            onLocaleChange={setLocale}
            onThemeChange={setTheme}
            onContinue={() => setStep('configuration')}
          />
        ) : step === 'configuration' ? (
          <ConfigurationView
            locale={locale}
            uniqueId={setup.uniqueId}
            cookie={setup.cookie}
            error={error}
            busy={status === 'connecting' || status === 'retrying'}
            onUniqueIdChange={(uniqueId) => setSetup((current) => ({ ...current, uniqueId }))}
            onCookieChange={(cookie) => setSetup((current) => ({ ...current, cookie }))}
            onSubmit={handleSubmit}
            onPickLive={handlePickLive}
          />
        ) : (
          <MessagesView
            locale={locale}
            title={title}
            status={status}
            events={events}
            onOpenConfig={handleOpenConfig}
            onReconnect={handleReconnect}
            onDisconnect={handleDisconnect}
          />
        )}
      </section>
      {configOpen ? (
        <ConfigModal
          locale={locale}
          username={configDraft.uniqueId}
          cookie={configDraft.cookie}
          error={configError}
          onUsernameChange={(uniqueId) => setConfigDraft((current) => ({ ...current, uniqueId }))}
          onCookieChange={(cookie) => setConfigDraft((current) => ({ ...current, cookie }))}
          onSubmit={handleConfigSubmit}
          onCancel={handleConfigCancel}
        />
      ) : null}
      {preferencesOpen ? (
        <PreferencesModal
          locale={locale}
          theme={theme}
          onLocaleChange={setLocale}
          onThemeChange={setTheme}
          onClose={handleClosePreferences}
        />
      ) : null}
    </main>
  );
}

const root = document.getElementById('app');
if (!root) throw new Error('Web UI root element was not found.');
render(<App />, root);
