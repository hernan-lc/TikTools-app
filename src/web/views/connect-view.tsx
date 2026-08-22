import type { JSX } from 'preact';
import { useState } from 'preact/hooks';

import {
  IconDice,
  IconRadio,
  IconUsers,
} from '../components/icons.tsx';
import { t, type Locale } from '../i18n.ts';
import type { ConnectionStatus } from '../types.ts';

type ConnectViewProps = {
  locale: Locale;
  uniqueId: string;
  cookie: string;
  status: ConnectionStatus;
  recents: string[];
  error: string;
  onUniqueIdChange: (val: string) => void;
  onCookieChange: (val: string) => void;
  onConnect: () => void;
  onPickLive: () => void;
  onSelectRecent: (username: string) => void;
};

export function ConnectView({
  locale,
  uniqueId,
  cookie,
  status,
  recents,
  error,
  onUniqueIdChange,
  onCookieChange,
  onConnect,
  onPickLive,
  onSelectRecent,
}: ConnectViewProps) {
  const isBusy = status === 'connecting' || status === 'retrying';
  const [showCookie, setShowCookie] = useState(Boolean(cookie));

  const handleSubmit = (e: JSX.TargetedEvent<HTMLFormElement, SubmitEvent>) => {
    e.preventDefault();
    onConnect();
  };

  return (
    <div className="view-container">
      <div className="connect-pane">
        <div className="connect-card">
          <h2>
            <IconRadio /> {t(locale, 'connectToLive')}
          </h2>
          <p style={{ margin: '0 0 14px', fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
            {t(locale, 'setupLead')}
          </p>

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="connect-creator">{t(locale, 'creatorHandle')}</label>
              <div className="input-wrapper has-prefix">
                <span className="input-prefix">@</span>
                <input
                  id="connect-creator"
                  type="text"
                  placeholder="creator_handle"
                  value={uniqueId}
                  spellcheck={false}
                  autoComplete="off"
                  onInput={(e) => onUniqueIdChange(e.currentTarget.value)}
                />
              </div>
            </div>

            {showCookie ? (
              <div className="form-group">
                <label htmlFor="connect-cookie">
                  {t(locale, 'authenticatedCookie')} <span style={{ opacity: 0.6 }}>({t(locale, 'optional')})</span>
                </label>
                <input
                  id="connect-cookie"
                  type="password"
                  placeholder="sessionid=..."
                  value={cookie}
                  spellcheck={false}
                  onInput={(e) => onCookieChange(e.currentTarget.value)}
                />
              </div>
            ) : (
              <div style={{ marginBottom: '10px' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ fontSize: '11px', padding: '4px 10px' }}
                  onClick={() => setShowCookie(true)}
                >
                  + {t(locale, 'authenticatedCookie')}
                </button>
              </div>
            )}

            {error ? <div className="error-banner">{error}</div> : null}

            <div className="form-actions">
              <button
                type="submit"
                className="btn-primary"
                disabled={isBusy || !uniqueId.trim()}
              >
                {isBusy ? t(locale, 'connecting') : t(locale, 'connect')}
              </button>
              <button
                type="button"
                className="btn-cyan"
                data-tooltip={t(locale, 'pickLive')}
                data-tooltip-pos="top"
                disabled={isBusy}
                onClick={onPickLive}
              >
                <IconDice />
              </button>
            </div>
          </form>
        </div>

        {/* Recent Streamers Card */}
        <div className="connect-card">
          <h2>
            <IconUsers /> {t(locale, 'recentStreamers')}
          </h2>
          {recents.length > 0 ? (
            <div className="recent-list">
              {recents.map((creator) => (
                <button
                  key={creator}
                  type="button"
                  className="recent-chip"
                  data-tooltip={`Connect to @${creator}`}
                  data-tooltip-pos="top"
                  onClick={() => onSelectRecent(creator)}
                >
                  @{creator}
                </button>
              ))}
            </div>
          ) : (
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{t(locale, 'noRecents')}</span>
          )}
        </div>
      </div>
    </div>
  );
}
