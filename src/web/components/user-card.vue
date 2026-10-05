<script lang="tsx">
import { onUnmounted, ref } from 'vue';
import { t, type Locale } from '../i18n.ts';
import type { UserCardUser } from '../types.ts';
import { defineVueComponent } from '../vue/component.ts';
import { IconBolt, IconClose } from './icons.vue';
import { UserAvatar } from './user-avatar.vue';

type UserCardProps = {
  user: UserCardUser;
  locale: Locale;
  onClose: () => void;
};

function formatStamp(locale: Locale, value: number): string {
  return new Date(value).toLocaleString(locale === 'es' ? 'es-ES' : 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Closable profile card for a feed user. Closes via the X button,
 * Escape, or a press outside the card. Stats come from the leaderboard
 * when the viewer is tracked; untracked viewers show identity only.
 */
export const UserCard = defineVueComponent<UserCardProps>(
  ['user', 'locale', 'onClose'],
  (props) => {
    const cardRef = ref<HTMLElement | null>(null);

    const onPointerDown = (event: PointerEvent): void => {
      const card = cardRef.value;
      if (card && !card.contains(event.target as Node)) props.onClose();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') props.onClose();
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    onUnmounted(() => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
    });

    return () => {
      const { user, locale } = props;
      const cleanHandle = user.uniqueId.replace(/^@+/, '');
      const displayName =
        user.nickname && user.nickname !== cleanHandle ? user.nickname : `@${cleanHandle}`;
      const level = user.level ?? 1;
      const tracked =
        typeof user.points === 'number' ||
        typeof user.totalChats === 'number' ||
        typeof user.totalCoins === 'number' ||
        typeof user.totalLikes === 'number' ||
        typeof user.totalShares === 'number';
      const stats: Array<{ key: string; value: number }> = [];
      if (typeof user.points === 'number') stats.push({ key: t(locale, 'points'), value: user.points });
      if (typeof user.totalChats === 'number') stats.push({ key: t(locale, 'totalChats'), value: user.totalChats });
      if (typeof user.totalCoins === 'number') stats.push({ key: t(locale, 'totalCoins'), value: user.totalCoins });
      if (typeof user.totalLikes === 'number') stats.push({ key: t(locale, 'statsLikes'), value: user.totalLikes });
      if (typeof user.totalShares === 'number') stats.push({ key: t(locale, 'userCardShares'), value: user.totalShares });

      return (
        <div ref={cardRef} class="tt-user-card" role="dialog" aria-label={displayName}>
          <div class="tt-user-card__head">
            <UserAvatar
              uniqueId={cleanHandle}
              nickname={user.nickname}
              avatarUrl={user.avatarUrl}
              imgClass="tt-user-card__avatar"
              fallbackClass="tt-user-card__avatar fallback"
            />
            <div class="tt-user-card__identity">
              <span class="tt-user-card__name">{displayName}</span>
              <span class="tt-user-card__handle">@{cleanHandle}</span>
            </div>
            <span class="tt-badge-level" title={`Level ${level}`}>
              <span class="tt-badge-icon">
                <IconBolt />
              </span>
              <span class="tt-badge-text">{t(locale, 'levelBadge', { level })}</span>
            </span>
            <button
              type="button"
              class="tt-user-card__close"
              aria-label={t(locale, 'dialogClose')}
              onClick={props.onClose}
            >
              <IconClose size={14} />
            </button>
          </div>

          {user.isSubscriber ? (
            <span class="tt-user-card__sub">{t(locale, 'userCardSubscriber')}</span>
          ) : null}

          {tracked ? (
            <div class="tt-user-card__stats">
              {stats.map((stat) => (
                <div key={stat.key} class="tt-user-card__stat">
                  <span class="tt-user-card__stat-value">{stat.value.toLocaleString()}</span>
                  <span class="tt-user-card__stat-label">{stat.key}</span>
                </div>
              ))}
            </div>
          ) : (
            <p class="tt-user-card__empty">{t(locale, 'userCardNoStats')}</p>
          )}

          <footer class="tt-user-card__foot">
            {typeof user.firstSeen === 'number' ? (
              <span>{t(locale, 'userCardFirstSeen', { time: formatStamp(locale, user.firstSeen) })}</span>
            ) : null}
            {typeof user.lastSeen === 'number' ? (
              <span>{t(locale, 'userCardLastSeen', { time: formatStamp(locale, user.lastSeen) })}</span>
            ) : null}
          </footer>
        </div>
      );
    };
  },
);

export default UserCard;
</script>
