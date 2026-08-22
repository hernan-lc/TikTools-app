import { useEffect, useRef, useState } from 'preact/hooks';
import { render, type JSX } from 'preact';

import type { HostMessage, PageMessage } from '../shared/messages.ts';
import { MessagesView, SetupView, StepBar, type ConnectionStatus, type DisplayEvent, type WizardStep } from './components.tsx';
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

function App() {
  const [step, setStep] = useState<WizardStep>('setup');
  const [setup, setSetup] = useState<SetupState>({ uniqueId: '', cookie: '' });
  const [title, setTitle] = useState('Waiting for connection…');
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [error, setError] = useState('');
  const [events, setEvents] = useState<DisplayEvent[]>([]);
  const nextEventId = useRef(0);

  const resetEvents = (): void => {
    nextEventId.current = 0;
    setEvents([]);
  };

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
              author: 'System',
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
  }, []);

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
      setError('Enter a creator handle, or use Pick a live automatically.');
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
      'Searching TikTok live rooms…',
    );
  };

  const handleDisconnect = (): void => {
    send({ type: 'disconnect' });
    setStep('setup');
    setStatus('idle');
    setTitle('Waiting for connection…');
    setError('');
  };

  return (
    <main className="shell">
      <header className="brand">
        <div className="brand-mark">♪</div>
        <div className="brand-copy">
          <p className="eyebrow">Desktop example</p>
          <h1>TikTok LIVE Inbox</h1>
          <p className="brand-note">A small native WebView for real-time live chat.</p>
        </div>
        <div className="tray-note"><span className="tray-dot" />Runs from the tray</div>
      </header>
      <StepBar current={step} />
      <section className="card">
        {step === 'setup' ? (
          <SetupView
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
          <MessagesView title={title} status={status} events={events} onDisconnect={handleDisconnect} />
        )}
      </section>
    </main>
  );
}

const root = document.getElementById('app');
if (!root) throw new Error('Web UI root element was not found.');
render(<App />, root);
