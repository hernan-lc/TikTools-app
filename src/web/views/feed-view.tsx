import type { JSX } from 'preact';

import { EventCard } from '../components/event-card.tsx';
import {
  IconArrowDown,
  IconChat,
  IconGift,
  IconHeart,
  IconSearch,
  IconSparkles,
  IconTrash,
  IconUsers,
} from '../components/icons.tsx';
import { t, type Locale } from '../i18n.ts';
import type { DisplayEvent, EventFilter, ViewerRecord } from '../types.ts';

type FeedViewProps = {
  locale: Locale;
  events: DisplayEvent[];
  leaderboard?: ViewerRecord[];
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

export function FeedView({
  locale,
  events,
  leaderboard = [],
  filter,
  searchQuery,
  autoScroll,
  unreadCount,
  onFilterChange,
  onSearchChange,
  onToggleAutoScroll,
  onClearFeed,
  streamContainerRef,
}: FeedViewProps) {
  const topViewers = leaderboard.slice(0, 3);
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

      {/* TikTok LIVE Top Viewers Ribbon (as in Image 1 & 2) */}
      {topViewers.length > 0 ? (
        <div className="tt-viewers-ribbon">
          <div className="tt-ribbon-title">
            <span>{t(locale, 'viewersCount')} · {leaderboard.length}</span>
          </div>
          <div className="tt-top-contributors">
            {topViewers.map((viewer, idx) => (
              <div key={viewer.uniqueId} className={`tt-contributor-chip rank-${idx + 1}`}>
                <span className="tt-rank-num">{idx + 1}</span>
                {viewer.avatarUrl ? (
                  <img
                    src={viewer.avatarUrl}
                    alt={viewer.uniqueId}
                    className="tt-chip-avatar"
                    loading="lazy"
                    onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
                  />
                ) : null}
                <span className="tt-rank-name">@{viewer.uniqueId}</span>
                <span className="tt-rank-pts">{viewer.points}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

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
          filteredEvents.map((ev) => <EventCard key={ev.id} event={ev} locale={locale} />)
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
          {t(locale, filteredEvents.length === 1 ? 'messageCountOne' : 'messageCountMany', {
            count: filteredEvents.length,
          })}
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
