import type { JSX } from 'preact';

import type { UiEvent } from '../shared/messages.ts';

export type WizardStep = 'setup' | 'messages';
export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'retrying' | 'disconnected' | 'error';
export type DisplayEvent = UiEvent & { id: number; receivedAt: number };

type StepBarProps = {
  current: WizardStep;
};

export function StepBar({ current }: StepBarProps) {
  const setupDone = current === 'messages';
  return (
    <nav className="steps" aria-label="Setup progress">
      <div className={'step ' + (current === 'setup' ? 'active' : '') + (setupDone ? ' done' : '')}>
        <span className="step-number">1</span>
        <span>Setup</span>
      </div>
      <div className={'step ' + (current === 'messages' ? 'active' : '')}>
        <span className="step-number">2</span>
        <span>Messages</span>
      </div>
    </nav>
  );
}

type SetupViewProps = {
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
        <h2>Connect to a LIVE</h2>
        <p className="lead">
          Enter a creator handle, or let TikTok choose a live room. Leave the cookie blank for anonymous guest mode.
        </p>
        <form className="form" onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="unique-id">Creator handle</label>
            <input
              id="unique-id"
              type="text"
              value={uniqueId}
              autoComplete="off"
              spellcheck={false}
              placeholder="@creator"
              onInput={(event) => onUniqueIdChange(event.currentTarget.value)}
            />
            <p className="hint">The leading <code>@</code> is optional.</p>
          </div>
          <div className="field">
            <label htmlFor="session-cookie">
              Authenticated cookie <span className="optional">(optional)</span>
            </label>
            <input
              id="session-cookie"
              type="password"
              value={cookie}
              autoComplete="off"
              spellcheck={false}
              placeholder="sessionid=...; or leave blank"
              onInput={(event) => onCookieChange(event.currentTarget.value)}
            />
            <p className="hint">
              Guest mode bootstraps a short-lived cookie in memory. Paste a browser Cookie header only when needed.
            </p>
          </div>
          {error ? <div className="error">{error}</div> : null}
          <div className="actions">
            <button className="secondary" type="button" disabled={busy} onClick={onPickLive}>
              Pick a live automatically
            </button>
            <button className="primary" type="submit" disabled={busy}>
              Connect to LIVE
            </button>
          </div>
        </form>
      </div>
      <p className="footer">Authenticated cookies stay in memory only. Never log or share them.</p>
    </section>
  );
}

type MessagesViewProps = {
  title: string;
  status: ConnectionStatus;
  events: DisplayEvent[];
  onDisconnect: () => void;
};

function statusLabel(status: ConnectionStatus): string {
  if (status === 'connected') return 'Live';
  if (status === 'retrying') return 'Retrying';
  if (status === 'disconnected') return 'Disconnected';
  if (status === 'error') return 'Needs attention';
  if (status === 'idle') return 'Waiting';
  return 'Connecting';
}

export function MessagesView({ title, status, events, onDisconnect }: MessagesViewProps) {
  return (
    <section className="view">
      <div className="live-header">
        <div>
          <h2>Live messages</h2>
          <p className="live-title">{title}</p>
        </div>
        <div className={'status ' + (status === 'connected' ? 'online' : status === 'error' || status === 'disconnected' ? 'offline' : 'busy')}>
          {statusLabel(status)}
        </div>
      </div>
      <div className="message-list">
        {events.length === 0 ? (
          <div className="empty">Messages will appear here when the room starts sending events.</div>
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
        <span className="count">{events.length} {events.length === 1 ? 'message' : 'messages'}</span>
        <span className="spacer" />
        <button className="danger" type="button" onClick={onDisconnect}>Disconnect</button>
      </div>
    </section>
  );
}
