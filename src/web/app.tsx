import { useEffect, useRef, useState } from 'preact/hooks';
import { render, type JSX } from 'preact';

import type { HostMessage, PageMessage } from '../shared/messages.ts';
import {
  BrandHeader,
  MessagesView,
  SetupView,
  StepBar,
  type ConnectionStatus,
  type DisplayEvent,
  type WizardStep,
} from './components.tsx';
import { t, type Locale } from './i18n.ts';
import { applyTheme, getInitialLocale, getInitialTheme, saveLocale, saveTheme, type Theme } from './preferences.ts';
import './styles.css';

declare global {
  interface Window {
    ipc?: { postMessage: (message: string) => void };
    __webview_on_message__?: (message: string) => void;
  }
}

type SetupState = {
  uniqueId: string;
  cookie: string;
};

function send(message: PageMessage): void {
  window.ipc?.postMessage(JSON.stringify(message));
}

const initialLocale = getInitialLocale();
const initialTheme = getInitialTheme();
applyTheme(initialTheme);
document.documentElement.lang = initialLocale;

function App() {
  const [step, setStep] = useState<WizardStep>('setup');
  const [setup, setSetup] = useState<SetupState>({ uniqueId: '', cookie: '' });
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [title, setTitle] = useState(t(initialLocale, 'waitingForConnection'));
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [error, setError] = useState('');
  const [events, setEvents] = useState<DisplayEvent[]>([]);
  const nextEventId = useRef(0);

  const resetEvents = (): void => {
    nextEventId.current = 0;
    setEvents([]);
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
          setStep('setup');
          setError(message.message);
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
    setStep('messages');
    send(message);
  };

  const handleSubmit = (event: JSX.TargetedEvent<HTMLFormElement, SubmitEvent>): void => {
    event.preventDefault();
    const uniqueId = setup.uniqueId.trim();
    if (!uniqueId) {
      setError(t(locale, 'handleRequired'));
      return;
    }
    startConnection(
      { type: 'connect', uniqueId, sessionCookie: setup.cookie.trim() },
      '@' + uniqueId.replace(/^@/, ''),
    );
  };

  const handlePickLive = (): void => {
    startConnection(
      { type: 'pick-live', sessionCookie: setup.cookie.trim() },
      t(locale, 'searchingRooms'),
    );
  };

  const handleDisconnect = (): void => {
    send({ type: 'disconnect' });
    setStep('setup');
    setStatus('idle');
    setTitle(t(locale, 'waitingForConnection'));
    setError('');
  };

  return (
    <main className="shell">
      <BrandHeader
        locale={locale}
        theme={theme}
        onLocaleChange={setLocale}
        onThemeChange={setTheme}
      />
      <StepBar current={step} locale={locale} />
      <section className="card">
        {step === 'setup' ? (
          <SetupView
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
          <MessagesView locale={locale} title={title} status={status} events={events} onDisconnect={handleDisconnect} />
        )}
      </section>
    </main>
  );
}

const root = document.getElementById('app');
if (!root) throw new Error('Web UI root element was not found.');
render(<App />, root);
