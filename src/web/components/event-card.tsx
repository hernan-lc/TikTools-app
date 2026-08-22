import type { DisplayEvent } from '../types.ts';

function getAvatarColor(username: string): string {
  const gradients = [
    'linear-gradient(135deg, #ff0050, #00f2fe)',
    'linear-gradient(135deg, #fe2c55, #ff7e40)',
    'linear-gradient(135deg, #69c9d0, #0070f3)',
    'linear-gradient(135deg, #9b51e0, #fe2c55)',
    'linear-gradient(135deg, #ff007a, #7928ca)',
    'linear-gradient(135deg, #00c9ff, #92fe9d)',
    'linear-gradient(135deg, #f857a6, #ff5858)',
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
  const cleanHandle = event.author.replace(/^@+/, '');
  const level = event.level ?? 1;
  const isSpecial = event.kind === 'gift' || event.kind === 'like';

  return (
    <div className={`tiktok-chat-row ${event.kind}`}>
      {/* Avatar */}
      <div
        className="tt-avatar"
        style={{ background: getAvatarColor(cleanHandle) }}
      >
        {cleanHandle.slice(0, 2).toUpperCase()}
      </div>

      {/* Message Content Container */}
      <div className="tt-content-wrap">
        {/* Author + Level Badge + Message Content */}
        <div className="tt-message-line">
          {/* Level Badge (TikFinity / TikTok rank style) */}
          <span className="tt-badge-level" title={`Level ${level}`}>
            <span className="tt-badge-icon">⚡</span>
            <span className="tt-badge-text">N.º {level}</span>
          </span>

          {/* Author handle/nickname */}
          <span className="tt-author" title={`@${cleanHandle}`}>
            {event.nickname && event.nickname !== cleanHandle
              ? event.nickname
              : `@${cleanHandle}`}
          </span>

          {/* Content text depending on event kind */}
          {event.kind === 'chat' ? (
            <span className="tt-chat-text">{event.text}</span>
          ) : event.kind === 'gift' ? (
            <span className="tt-gift-text">
              <span className="tt-gift-icon">🎁</span> {event.text}
            </span>
          ) : event.kind === 'like' ? (
            <span className="tt-like-text">
              {event.text}
            </span>
          ) : (
            <span className="tt-social-text">{event.text}</span>
          )}
        </div>
      </div>

      {/* Point Earned Pill or Time */}
      <div className="tt-row-tail">
        {typeof event.pointsDelta === 'number' && event.pointsDelta > 0 ? (
          <span className="tt-points-badge">
            +{event.pointsDelta} pts
          </span>
        ) : (
          <time className="tt-timestamp">
            {new Date(event.receivedAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </time>
        )}
      </div>
    </div>
  );
}
