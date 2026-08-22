import type { JSX } from 'preact';
import { useState } from 'preact/hooks';

import type { UiEvent } from '../shared/messages.ts';
import { t, type Locale } from './i18n.ts';
import type { Theme } from './preferences.ts';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'retrying' | 'disconnected' | 'error';
export type DisplayEvent = UiEvent & { id: number; receivedAt: number };
export type EventFilter = 'all' | 'chat' | 'gift' | 'like' | 'social';

export type StreamTelemetry = {
  chats: number;
  gifts: number;
  likes: number;
  members: number;
};

// SVG Icon Helpers
export function IconTikTok() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.589 6.686a4.793 4.793 0 0 1-3.77-4.245V2h-3.445v13.672a2.896 2.896 0 0 1-2.891 2.891 2.896 2.896 0 0 1-2.892-2.891 2.896 2.896 0 0 1 2.892-2.892c.307 0 .602.05.878.142V9.458a6.32 6.32 0 0 0-.878-.061A6.338 6.338 0 0 0 3 15.736a6.338 6.338 0 0 0 6.338 6.338 6.338 6.338 0 0 0 6.338-6.338V8.674c1.23.882 2.732 1.408 4.355 1.457V6.686h-.442z" />
    </svg>
  );
}

export function IconChat() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function IconGift() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 12 20 22 4 22 4 12" />
      <rect x="2" y="7" width="20" height="5" />
      <line x1="12" y1="22" x2="12" y2="7" />
      <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
      <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
    </svg>
  );
}

export function IconHeart() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
    </svg>
  );
}

export function IconUsers() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export function IconSettings() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function IconSearch() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

export function IconRefresh() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

export function IconPower() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
      <line x1="12" y1="2" x2="12" y2="12" />
    </svg>
  );
}

function getAvatarColor(username: string): string {
  const gradients = [
    'linear-gradient(135deg, #ff416c, #ff4b2b)',
    'linear-gradient(135deg, #7928ca, #ff0080)',
    'linear-gradient(135deg, #2193b0, #6dd5ed)',
    'linear-gradient(135deg, #f12711, #f5af19)',
    'linear-gradient(135deg, #11998e, #38ef7d)',
    'linear-gradient(135deg, #8a2387, #e94057)',
    'linear-gradient(135deg, #4776e6, #8e54e9)',
  ] as const;
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  const idx = Math.abs(hash) % gradients.length;
  return gradients[idx] ?? gradients[0];
}

// Top Bar Navigation Component
type TopNavProps = {
  locale: Locale;
  theme: Theme;
  status: ConnectionStatus;
  activeCreator: string;
  onThemeToggle: () => void;
  onLocaleToggle: () => void;
  onOpenSettings: () => void;
};

export function TopNav({
  locale,
  theme,
  status,
  activeCreator,
  onThemeToggle,
  onLocaleToggle,
  onOpenSettings,
}: TopNavProps) {
  const isConnected = status === 'connected';
  const isBusy = status === 'connecting' || status === 'retrying';

  return (
    <header className="top-nav">
      <div className="brand-section">
        <div className="brand-logo">
          <IconTikTok />
        </div>
        <div className="brand-info">
          <h1>
            TikTok LIVE
            <span className={`badge-live ${isConnected ? 'live' : isBusy ? 'busy' : 'offline'}`}>
              {status === 'connected' ? t(locale, 'live') : isBusy ? t(locale, 'connecting') : t(locale, 'disconnected')}
            </span>
          </h1>
        </div>
      </div>

      <div className="top-center">
        {activeCreator ? (
          <div className="active-creator-pill">
            <span className={`status-dot ${isConnected ? 'online' : isBusy ? 'busy' : 'offline'}`} />
            <span>@{activeCreator.replace(/^@/, '')}</span>
          </div>
        ) : null}
      </div>

      <div className="top-actions">
        <button
          className="btn-icon"
          type="button"
          title={theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
          onClick={onThemeToggle}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
        <button
          className="btn-icon"
          type="button"
          title="Switch Language"
          onClick={onLocaleToggle}
        >
          <span style={{ fontSize: '11px', fontWeight: 800 }}>{locale.toUpperCase()}</span>
        </button>
        <button
          className="btn-icon"
          type="button"
          title={t(locale, 'openPreferences')}
          onClick={onOpenSettings}
        >
          <IconSettings />
        </button>
      </div>
    </header>
  );
}

// Sidebar Control & Telemetry Panel
type SidebarControlProps = {
  locale: Locale;
  uniqueId: string;
  cookie: string;
  status: ConnectionStatus;
  telemetry: StreamTelemetry;
  recents: string[];
  error: string;
  onUniqueIdChange: (val: string) => void;
  onCookieChange: (val: string) => void;
  onConnect: () => void;
  onPickLive: () => void;
  onReconnect: () => void;
  onDisconnect: () => void;
  onSelectRecent: (username: string) => void;
};

export function SidebarControl({
  locale,
  uniqueId,
  cookie,
  status,
  telemetry,
  recents,
  error,
  onUniqueIdChange,
  onCookieChange,
  onConnect,
  onPickLive,
  onReconnect,
  onDisconnect,
  onSelectRecent,
}: SidebarControlProps) {
  const isConnected = status === 'connected';
  const isBusy = status === 'connecting' || status === 'retrying';
  const [showCookieInput, setShowCookieInput] = useState(Boolean(cookie));

  const handleFormSubmit = (e: JSX.TargetedEvent<HTMLFormElement, SubmitEvent>) => {
    e.preventDefault();
    onConnect();
  };

  return (
    <aside className="sidebar">
      {/* Connect Card */}
      <section className="sidebar-card">
        <h3>{t(locale, 'configuration')}</h3>
        <form onSubmit={handleFormSubmit}>
          <div className="form-group">
            <label htmlFor="creator-handle">{t(locale, 'creatorHandle')}</label>
            <div className="input-wrapper has-prefix">
              <span className="input-prefix">@</span>
              <input
                id="creator-handle"
                type="text"
                value={uniqueId}
                placeholder="creator_handle"
                spellcheck={false}
                autoComplete="off"
                onInput={(e) => onUniqueIdChange(e.currentTarget.value)}
              />
            </div>
          </div>

          {showCookieInput ? (
            <div className="form-group">
              <label htmlFor="session-cookie">
                {t(locale, 'authenticatedCookie')} <span style={{ opacity: 0.6 }}>({t(locale, 'optional')})</span>
              </label>
              <input
                id="session-cookie"
                type="password"
                value={cookie}
                placeholder="sessionid=..."
                spellcheck={false}
                onInput={(e) => onCookieChange(e.currentTarget.value)}
              />
            </div>
          ) : (
            <div style={{ marginBottom: '8px' }}>
              <button
                type="button"
                className="btn-secondary"
                style={{ fontSize: '11px', padding: '3px 8px', width: 'auto' }}
                onClick={() => setShowCookieInput(true)}
              >
                + {t(locale, 'authenticatedCookie')}
              </button>
            </div>
          )}

          {error ? <div className="error">{error}</div> : null}

          <div className="form-actions">
            {!isConnected ? (
              <>
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
                  title={t(locale, 'pickLive')}
                  disabled={isBusy}
                  onClick={onPickLive}
                >
                  🎲
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={onReconnect}
                >
                  <IconRefresh /> {t(locale, 'reconnect')}
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={onDisconnect}
                >
                  <IconPower /> {t(locale, 'disconnect')}
                </button>
              </>
            )}
          </div>
        </form>
      </section>

      {/* Live Stream Telemetry Counter */}
      <section className="sidebar-card">
        <h3>Stream Metrics</h3>
        <div className="telemetry-grid">
          <div className="telemetry-item">
            <div className="telemetry-icon chats">
              <IconChat />
            </div>
            <div className="telemetry-data">
              <span className="telemetry-value">{telemetry.chats.toLocaleString()}</span>
              <span className="telemetry-label">{t(locale, 'statsChats')}</span>
            </div>
          </div>

          <div className="telemetry-item">
            <div className="telemetry-icon gifts">
              <IconGift />
            </div>
            <div className="telemetry-data">
              <span className="telemetry-value">{telemetry.gifts.toLocaleString()}</span>
              <span className="telemetry-label">{t(locale, 'statsGifts')}</span>
            </div>
          </div>

          <div className="telemetry-item">
            <div className="telemetry-icon likes">
              <IconHeart />
            </div>
            <div className="telemetry-data">
              <span className="telemetry-value">{telemetry.likes.toLocaleString()}</span>
              <span className="telemetry-label">{t(locale, 'statsLikes')}</span>
            </div>
          </div>

          <div className="telemetry-item">
            <div className="telemetry-icon members">
              <IconUsers />
            </div>
            <div className="telemetry-data">
              <span className="telemetry-value">{telemetry.members.toLocaleString()}</span>
              <span className="telemetry-label">{t(locale, 'statsMembers')}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Recent Streamers */}
      <section className="sidebar-card">
        <h3>{t(locale, 'recentStreamers')}</h3>
        {recents.length > 0 ? (
          <div className="recent-list">
            {recents.map((creator) => (
              <button
                key={creator}
                type="button"
                className="recent-chip"
                onClick={() => onSelectRecent(creator)}
              >
                @{creator}
              </button>
            ))}
          </div>
        ) : (
          <span className="empty-recents">{t(locale, 'noRecents')}</span>
        )}
      </section>
    </aside>
  );
}

// Event Stream & Feed Component
type LiveFeedProps = {
  locale: Locale;
  events: DisplayEvent[];
  filter: EventFilter;
  searchQuery: string;
  autoScroll: boolean;
  unreadCount: number;
  onFilterChange: (f: EventFilter) => void;
  onSearchChange: (q: string) => void;
  onToggleAutoScroll: () => void;
  onClearFeed: () => void;
  streamContainerRef: (el: HTMLDivElement | null) => void;
};

export function LiveFeed({
  locale,
  events,
  filter,
  searchQuery,
  autoScroll,
  unreadCount,
  onFilterChange,
  onSearchChange,
  onToggleAutoScroll,
  onClearFeed,
  streamContainerRef,
}: LiveFeedProps) {
  const filterOptions: Array<{ key: EventFilter; label: string; icon?: string }> = [
    { key: 'all', label: t(locale, 'filterAll') },
    { key: 'chat', label: t(locale, 'filterChats') },
    { key: 'gift', label: t(locale, 'filterGifts') },
    { key: 'like', label: t(locale, 'filterLikes') },
    { key: 'social', label: t(locale, 'filterSocial') },
  ];

  const filteredEvents = events.filter((ev) => {
    if (filter !== 'all') {
      if (filter === 'chat' && ev.kind !== 'chat') return false;
      if (filter === 'gift' && ev.kind !== 'gift') return false;
      if (filter === 'like' && ev.kind !== 'like') return false;
      if (filter === 'social' && ev.kind !== 'social' && ev.kind !== 'member') return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchAuthor = ev.author.toLowerCase().includes(q);
      const matchText = ev.text.toLowerCase().includes(q);
      return matchAuthor || matchText;
    }
    return true;
  });

  return (
    <main className="feed-pane">
      {/* Filter and Search Bar */}
      <div className="feed-toolbar">
        <div className="filter-pills">
          {filterOptions.map((opt) => (
            <button
              key={opt.key}
              type="button"
              className={`filter-pill ${filter === opt.key ? 'active' : ''}`}
              onClick={() => onFilterChange(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="feed-search-wrap">
          <span className="search-icon">
            <IconSearch />
          </span>
          <input
            type="text"
            placeholder={t(locale, 'searchEvents')}
            value={searchQuery}
            onInput={(e) => onSearchChange(e.currentTarget.value)}
          />
          {searchQuery ? (
            <button
              type="button"
              className="search-clear"
              onClick={() => onSearchChange('')}
            >
              ✕
            </button>
          ) : null}
        </div>
      </div>

      {/* Message Stream */}
      <div className="feed-stream" ref={streamContainerRef}>
        {filteredEvents.length === 0 ? (
          <div className="feed-empty">
            <div className="empty-icon">💬</div>
            <p>{t(locale, 'messagesEmpty')}</p>
          </div>
        ) : (
          filteredEvents.map((ev) => (
            <article key={ev.id} className={`event-card ${ev.kind}`}>
              <div
                className="event-avatar"
                style={{ background: getAvatarColor(ev.author) }}
              >
                {ev.author.slice(0, 2).toUpperCase()}
              </div>
              <div className="event-body">
                <div className="event-meta">
                  <span className="event-author">@{ev.author}</span>
                  {ev.kind === 'gift' ? <span style={{ fontSize: '11px' }}>🎁</span> : null}
                  {ev.kind === 'like' ? <span style={{ fontSize: '11px' }}>❤️</span> : null}
                  <time className="event-time">
                    {new Date(ev.receivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </time>
                </div>
                <div className="event-text">{ev.text}</div>
              </div>
            </article>
          ))
        )}
      </div>

      {/* Jump to latest unread button */}
      {!autoScroll && unreadCount > 0 ? (
        <div className="feed-floating-bar">
          <button
            type="button"
            className="btn-primary"
            style={{ height: '30px', fontSize: '12px', padding: '0 12px', borderRadius: '15px' }}
            onClick={onToggleAutoScroll}
          >
            ⬇ {t(locale, 'scrollToBottom', { count: unreadCount })}
          </button>
        </div>
      ) : null}

      {/* Feed Bottom Status & Actions */}
      <footer className="feed-footer-info">
        <span>
          {t(locale, filteredEvents.length === 1 ? 'messageCountOne' : 'messageCountMany', { count: filteredEvents.length })}
        </span>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            type="button"
            className="btn-secondary"
            style={{ fontSize: '11px', padding: '3px 8px', height: '24px' }}
            onClick={onToggleAutoScroll}
          >
            {autoScroll ? '🟢 ' + t(locale, 'autoScrollOn') : '⏸️ ' + t(locale, 'autoScrollPaused')}
          </button>
          <button
            type="button"
            className="btn-secondary"
            style={{ fontSize: '11px', padding: '3px 8px', height: '24px' }}
            onClick={onClearFeed}
          >
            🗑️ {t(locale, 'clearFeed')}
          </button>
        </div>
      </footer>
    </main>
  );
}

// Settings Modal Component
type SettingsModalProps = {
  locale: Locale;
  theme: Theme;
  onLocaleChange: (l: Locale) => void;
  onThemeChange: (t: Theme) => void;
  onClose: () => void;
};

export function SettingsModal({
  locale,
  theme,
  onLocaleChange,
  onThemeChange,
  onClose,
}: SettingsModalProps) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-window" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className="modal-header">
          <h2>⚙️ {t(locale, 'preferences')}</h2>
          <button
            type="button"
            className="btn-icon"
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        <div className="modal-body">
          <div className="form-group">
            <label htmlFor="settings-lang">{t(locale, 'language')}</label>
            <select
              id="settings-lang"
              value={locale}
              onChange={(e) => onLocaleChange(e.currentTarget.value as Locale)}
            >
              <option value="en">{t(locale, 'english')}</option>
              <option value="es">{t(locale, 'spanish')}</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="settings-theme">{t(locale, 'theme')}</label>
            <select
              id="settings-theme"
              value={theme}
              onChange={(e) => onThemeChange(e.currentTarget.value as Theme)}
            >
              <option value="dark">{t(locale, 'dark')}</option>
              <option value="light">{t(locale, 'light')}</option>
            </select>
          </div>

          <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
            ℹ️ {t(locale, 'cookiesMemory')}
          </div>
        </div>

        <footer className="modal-footer">
          <button type="button" className="btn-primary" onClick={onClose}>
            {t(locale, 'done')}
          </button>
        </footer>
      </div>
    </div>
  );
}
