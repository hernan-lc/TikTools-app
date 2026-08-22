import type { JSX } from 'preact';

import { EventCard } from '../components/event-card.tsx';
import { IconArrowDown, IconChat, IconDot, IconGift, IconHeart, IconPause, IconSparkles, IconTrash, IconUsers } from '../components/icons.tsx';
import { Button } from '../components/ui/Button.tsx';
import { SearchInput } from '../components/ui/TextInput.tsx';
import { t, type Locale } from '../i18n.ts';
import type { DisplayEvent, EventFilter, TopViewerPayload, ViewerRecord } from '../types.ts';
import { TopViewersRibbon } from '../components/top-viewers.tsx';

type FeedViewProps = {
  locale: Locale;
  events: DisplayEvent[];
  leaderboard?: ViewerRecord[];
  topViewers?: TopViewerPayload[];
  liveViewers?: number;
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
  topViewers = [],
  liveViewers = 0,
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

        <SearchInput value={searchQuery} onValueChange={onSearchChange} placeholder={t(locale, 'searchEvents')} />
      </div>

      <TopViewersRibbon locale={locale} topViewers={topViewers} leaderboard={leaderboard} liveViewers={liveViewers} />

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

      {!autoScroll && unreadCount > 0 ? (
        <div className="feed-floating-bar">
          <Button variant="primary" size="sm" icon={<IconArrowDown />} onClick={onToggleAutoScroll}>
            {t(locale, 'scrollToBottom', { count: unreadCount })}
          </Button>
        </div>
      ) : null}

      <footer className="feed-footer-info">
        <span>
          {t(locale, filteredEvents.length === 1 ? 'messageCountOne' : 'messageCountMany', {
            count: filteredEvents.length,
          })}
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Button
            size="sm"
            variant="soft"
            tooltip={autoScroll ? t(locale, 'autoScrollOn') : t(locale, 'autoScrollPaused')}
            icon={autoScroll ? <span style={{ color: 'var(--tt-green)', display: 'inline-flex' }}><IconDot /></span> : <IconPause />}
            iconOnly
            onClick={onToggleAutoScroll}
          />
          <Button size="sm" variant="soft" tooltip={t(locale, 'clearFeed')} icon={<IconTrash />} iconOnly onClick={onClearFeed} />
        </div>
      </footer>
    </main>
  );
}
