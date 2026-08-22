import type { DisplayEvent } from '../types.ts';

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

type EventCardProps = {
  event: DisplayEvent;
};

export function EventCard({ event }: EventCardProps) {
  return (
    <article className={`event-card ${event.kind}`}>
      <div
        className="event-avatar"
        style={{ background: getAvatarColor(event.author) }}
      >
        {event.author.slice(0, 2).toUpperCase()}
      </div>
      <div className="event-body">
        <div className="event-meta">
          <span className="event-author">@{event.author}</span>
          {event.kind === 'gift' ? <span style={{ fontSize: '11px' }}>🎁</span> : null}
          {event.kind === 'like' ? <span style={{ fontSize: '11px' }}>❤️</span> : null}
          <time className="event-time">
            {new Date(event.receivedAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </time>
        </div>
        <div className="event-text">{event.text}</div>
      </div>
    </article>
  );
}
