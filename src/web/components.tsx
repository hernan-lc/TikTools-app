import type { JSX } from 'preact';
import { useState } from 'preact/hooks';

import type { UiEvent } from '../shared/messages.ts';
import { t, type Locale } from './i18n.ts';
import type { Theme } from './preferences.ts';

export type AppTab = 'feed' | 'analytics' | 'connect' | 'settings';
export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'retrying' | 'disconnected' | 'error';
export type DisplayEvent = UiEvent & { id: number; receivedAt: number };
export type EventFilter = 'all' | 'chat' | 'gift' | 'like' | 'social';

export type StreamTelemetry = {
  chats: number;
  gifts: number;
  likes: number;
  members: number;
};

// ==========================================
// 🎨 SVG Icon Library
// ==========================================
export function IconTikTok() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.589 6.686a4.793 4.793 0 0 1-3.77-4.245V2h-3.445v13.672a2.896 2.896 0 0 1-2.891 2.891 2.896 2.896 0 0 1-2.892-2.891 2.896 2.896 0 0 1 2.892-2.892c.307 0 .602.05.878.142V9.458a6.32 6.32 0 0 0-.878-.061A6.338 6.338 0 0 0 3 15.736a6.338 6.338 0 0 0 6.338 6.338 6.338 6.338 0 0 0 6.338-6.338V8.674c1.23.882 2.732 1.408 4.355 1.457V6.686h-.442z" />
    </svg>
  );
}

export function IconChat() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function IconGift() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
    </svg>
  );
}

export function IconUsers() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export function IconBarChart() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="20" x2="12" y2="10" />
      <line x1="18" y1="20" x2="18" y2="4" />
      <line x1="6" y1="20" x2="6" y2="16" />
    </svg>
  );
}

export function IconRadio() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="2" />
      <path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14" />
    </svg>
  );
}

export function IconDice() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
      <circle cx="15.5" cy="8.5" r="1.5" fill="currentColor" />
      <circle cx="15.5" cy="15.5" r="1.5" fill="currentColor" />
      <circle cx="8.5" cy="15.5" r="1.5" fill="currentColor" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}

export function IconSparkles() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
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
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

export function IconRefresh() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

export function IconPower() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
      <line x1="12" y1="2" x2="12" y2="12" />
    </svg>
  );
}

export function IconTrash() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

export function IconArrowDown() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <polyline points="19 12 12 19 5 12" />
    </svg>
  );
}

export function IconSun() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

export function IconMoon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

export function IconGlobe() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
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

// ==========================================
// 🚀 Top Navigation Component
// ==========================================
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
    <header className="top-nav">
      <div className="brand-section">
        <div className="brand-logo" data-tooltip="TikTok LIVE" data-tooltip-pos="bottom">
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
          <div className="active-creator-pill" data-tooltip={`Status: ${status}`} data-tooltip-pos="bottom">
            <span className={`status-dot ${isConnected ? 'online' : isBusy ? 'busy' : 'offline'}`} />
            <span>@{activeCreator.replace(/^@/, '')}</span>
          </div>
        ) : null}
      </div>

      <div className="top-actions">
        {isConnected ? (
          <>
            <button
              className="btn-icon"
              type="button"
              data-tooltip={t(locale, 'reconnect')}
              data-tooltip-pos="bottom"
              onClick={onReconnect}
            >
              <IconRefresh />
            </button>
            <button
              className="btn-icon btn-danger"
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
          className="btn-icon"
          type="button"
          data-tooltip={t(locale, 'switchTheme')}
          data-tooltip-pos="bottom"
          onClick={onThemeToggle}
        >
          {theme === 'dark' ? <IconSun /> : <IconMoon />}
        </button>

        <button
          className="btn-icon"
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

// ==========================================
// 🧭 Minimalist Navigation Rail Component
// ==========================================
type NavigationRailProps = {
  locale: Locale;
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
};

export function NavigationRail({ locale, activeTab, onTabChange }: NavigationRailProps) {
  const navTabs: Array<{ id: AppTab; tooltip: string; icon: JSX.Element }> = [
    { id: 'feed', tooltip: t(locale, 'tabFeed'), icon: <IconChat /> },
    { id: 'analytics', tooltip: t(locale, 'tabAnalytics'), icon: <IconBarChart /> },
    { id: 'connect', tooltip: t(locale, 'tabConnect'), icon: <IconRadio /> },
    { id: 'settings', tooltip: t(locale, 'tabSettings'), icon: <IconSettings /> },
  ];

  return (
    <nav className="nav-rail" aria-label="Main Navigation">
      {navTabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`nav-tab-btn ${activeTab === tab.id ? 'active' : ''}`}
          data-tooltip={tab.tooltip}
          data-tooltip-pos="right"
          onClick={() => onTabChange(tab.id)}
        >
          {tab.icon}
        </button>
      ))}
    </nav>
  );
}

// ==========================================
// 💬 Live Feed View Component
// ==========================================
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
  const filterButtons: Array<{ key: EventFilter; tooltip: string; icon: JSX.Element }> = [
    { key: 'all', tooltip: t(locale, 'filterAll'), icon: <IconSparkles /> },
    { key: 'chat', tooltip: t(locale, 'filterChats'), icon: <IconChat /> },
    { key: 'gift', tooltip: t(locale, 'filterGifts'), icon: <IconGift /> },
    { key: 'like', tooltip: t(locale, 'filterLikes'), icon: <IconHeart /> },
    { key: 'social', tooltip: t(locale, 'filterSocial'), icon: <IconUsers /> },
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
      return ev.author.toLowerCase().includes(q) || ev.text.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <main className="feed-pane">
      {/* Filter & Search Bar */}
      <div className="feed-toolbar">
        <div className="filter-icon-group">
          {filterButtons.map((btn) => (
            <button
              key={btn.key}
              type="button"
              className={`filter-icon-btn ${filter === btn.key ? 'active' : ''}`}
              data-tooltip={btn.tooltip}
              data-tooltip-pos="bottom"
              onClick={() => onFilterChange(btn.key)}
            >
              {btn.icon}
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
              data-tooltip="Clear search"
              data-tooltip-pos="left"
              onClick={() => onSearchChange('')}
            >
              ✕
            </button>
          ) : null}
        </div>
      </div>

      {/* Message Stream Area */}
      <div className="feed-stream" ref={streamContainerRef}>
        {filteredEvents.length === 0 ? (
          <div className="feed-empty">
            <div className="empty-icon">
              <IconChat />
            </div>
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

      {/* Floating Jump to Latest Button */}
      {!autoScroll && unreadCount > 0 ? (
        <div className="feed-floating-bar">
          <button
            type="button"
            className="btn-primary"
            style={{ height: '30px', fontSize: '12px', padding: '0 12px', borderRadius: '15px' }}
            onClick={onToggleAutoScroll}
          >
            <IconArrowDown /> {t(locale, 'scrollToBottom', { count: unreadCount })}
          </button>
        </div>
      ) : null}

      {/* Footer Info & Actions */}
      <footer className="feed-footer-info">
        <span>
          {t(locale, filteredEvents.length === 1 ? 'messageCountOne' : 'messageCountMany', { count: filteredEvents.length })}
        </span>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <button
            type="button"
            className="btn-icon"
            style={{ width: '28px', height: '28px' }}
            data-tooltip={autoScroll ? t(locale, 'autoScrollOn') : t(locale, 'autoScrollPaused')}
            data-tooltip-pos="top"
            onClick={onToggleAutoScroll}
          >
            {autoScroll ? '🟢' : '⏸️'}
          </button>
          <button
            type="button"
            className="btn-icon"
            style={{ width: '28px', height: '28px' }}
            data-tooltip={t(locale, 'clearFeed')}
            data-tooltip-pos="top"
            onClick={onClearFeed}
          >
            <IconTrash />
          </button>
        </div>
      </footer>
    </main>
  );
}

// ==========================================
// 📊 Stream Analytics View Component
// ==========================================
type AnalyticsViewProps = {
  locale: Locale;
  telemetry: StreamTelemetry;
  events: DisplayEvent[];
};

export function AnalyticsView({ locale, telemetry, events }: AnalyticsViewProps) {
  // Compute top active chatters
  const authorCounts = new Map<string, number>();
  events.forEach((ev) => {
    authorCounts.set(ev.author, (authorCounts.get(ev.author) ?? 0) + 1);
  });
  const topChatters = Array.from(authorCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const totalEvents = telemetry.chats + telemetry.gifts + telemetry.likes + telemetry.members;

  return (
    <div className="view-container">
      <div className="analytics-pane">
        <header className="analytics-header">
          <h2>
            <IconBarChart /> {t(locale, 'tabAnalytics')}
          </h2>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            {t(locale, 'messageCountMany', { count: totalEvents })}
          </span>
        </header>

        {/* 4 Metric Cards */}
        <div className="stats-grid-large">
          <div className="stats-card-large">
            <div className="stats-icon-large chats">
              <IconChat />
            </div>
            <div>
              <div className="stats-val-large">{telemetry.chats.toLocaleString()}</div>
              <div className="stats-lbl-large">{t(locale, 'statsChats')}</div>
            </div>
          </div>

          <div className="stats-card-large">
            <div className="stats-icon-large gifts">
              <IconGift />
            </div>
            <div>
              <div className="stats-val-large">{telemetry.gifts.toLocaleString()}</div>
              <div className="stats-lbl-large">{t(locale, 'statsGifts')}</div>
            </div>
          </div>

          <div className="stats-card-large">
            <div className="stats-icon-large likes">
              <IconHeart />
            </div>
            <div>
              <div className="stats-val-large">{telemetry.likes.toLocaleString()}</div>
              <div className="stats-lbl-large">{t(locale, 'statsLikes')}</div>
            </div>
          </div>

          <div className="stats-card-large">
            <div className="stats-icon-large members">
              <IconUsers />
            </div>
            <div>
              <div className="stats-val-large">{telemetry.members.toLocaleString()}</div>
              <div className="stats-lbl-large">{t(locale, 'statsMembers')}</div>
            </div>
          </div>
        </div>

        {/* Top Active Chatters Card */}
        <div className="connect-card" style={{ width: '100%' }}>
          <h2>
            <IconUsers /> {t(locale, 'topChatters')}
          </h2>
          {topChatters.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {topChatters.map(([author, count], idx) => (
                <div
                  key={author}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    background: 'var(--input-bg)',
                    border: '1px solid var(--line)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--tt-pink)' }}>#{idx + 1}</span>
                    <span style={{ fontWeight: 600 }}>@{author}</span>
                  </div>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {count} {count === 1 ? 'event' : 'events'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
              {t(locale, 'noData')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 📡 Connect / Streamers View Component
// ==========================================
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

// ==========================================
// ⚙️ Settings / Preferences View Component
// ==========================================
type SettingsViewProps = {
  locale: Locale;
  theme: Theme;
  onLocaleChange: (l: Locale) => void;
  onThemeChange: (t: Theme) => void;
};

export function SettingsView({ locale, theme, onLocaleChange, onThemeChange }: SettingsViewProps) {
  return (
    <div className="view-container">
      <div className="connect-pane">
        <div className="connect-card">
          <h2>
            <IconSettings /> {t(locale, 'preferences')}
          </h2>
          <p style={{ margin: '0 0 16px', fontSize: '12px', color: 'var(--text-muted)' }}>
            {t(locale, 'preferencesLead')}
          </p>

          <div className="form-group">
            <label htmlFor="settings-language">{t(locale, 'language')}</label>
            <select
              id="settings-language"
              value={locale}
              onChange={(e) => onLocaleChange(e.currentTarget.value as Locale)}
            >
              <option value="en">{t(locale, 'english')}</option>
              <option value="es">{t(locale, 'spanish')}</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="settings-theme-select">{t(locale, 'theme')}</label>
            <select
              id="settings-theme-select"
              value={theme}
              onChange={(e) => onThemeChange(e.currentTarget.value as Theme)}
            >
              <option value="dark">{t(locale, 'dark')}</option>
              <option value="light">{t(locale, 'light')}</option>
            </select>
          </div>

          <div style={{ marginTop: '16px', fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
            ℹ️ {t(locale, 'cookiesMemory')}
          </div>
        </div>
      </div>
    </div>
  );
}
