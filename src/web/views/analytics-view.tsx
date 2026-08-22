import {
  IconBarChart,
  IconChat,
  IconGift,
  IconHeart,
  IconUsers,
} from '../components/icons.tsx';
import { t, type Locale } from '../i18n.ts';
import type { DisplayEvent, StreamTelemetry } from '../types.ts';

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
