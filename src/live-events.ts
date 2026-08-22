import {
  SOCIAL_ACTION,
  label,
} from '../vendor/tiktok-signer/packages/tiktok-live/src/index.ts';
import type {
  ChatEvent,
  ClientState,
  EventUser,
  GiftEvent,
  LikeEvent,
  LiveEvent,
  MemberEvent,
  RoomUserEvent,
  SocialEvent,
  UnknownEvent,
} from '../vendor/tiktok-signer/packages/tiktok-live/src/index.ts';

import type { UiEvent } from './shared/messages.ts';

// ---------------------------------------------------------------------------
// Re-export vendor discriminant types for convenience
// ---------------------------------------------------------------------------
export type {
  ChatEvent,
  GiftEvent,
  LikeEvent,
  MemberEvent,
  RoomUserEvent,
  SocialEvent,
  UnknownEvent,
};

// ---------------------------------------------------------------------------
// Type-guard helpers — prefer these over casting with `as`
// ---------------------------------------------------------------------------

export function isChatEvent(e: LiveEvent): e is ChatEvent {
  return e.type === 'chat';
}

export function isGiftEvent(e: LiveEvent): e is GiftEvent {
  return e.type === 'gift';
}

export function isLikeEvent(e: LiveEvent): e is LikeEvent {
  return e.type === 'like';
}

export function isMemberEvent(e: LiveEvent): e is MemberEvent {
  return e.type === 'member';
}

export function isSocialEvent(e: LiveEvent): e is SocialEvent {
  return e.type === 'social';
}

export function isRoomUserEvent(e: LiveEvent): e is RoomUserEvent {
  return e.type === 'roomUser';
}

export function isUnknownEvent(e: LiveEvent): e is UnknownEvent {
  return e.type === 'unknown';
}

/** True for every event that carries an EventUser (i.e. not roomUser / unknown). */
export function hasUser(
  e: LiveEvent,
): e is ChatEvent | GiftEvent | LikeEvent | MemberEvent | SocialEvent {
  return (
    e.type === 'chat' ||
    e.type === 'gift' ||
    e.type === 'like' ||
    e.type === 'member' ||
    e.type === 'social'
  );
}

// ---------------------------------------------------------------------------
// User helpers
// ---------------------------------------------------------------------------

export function cleanUsername(user: EventUser): string {
  const value = user.uniqueId || label(user);
  if (!value || value === 'unknown') return 'viewer';
  return value.replace(/^@+/, '');
}

// ---------------------------------------------------------------------------
// Per-event conversion functions — fully typed, no `any`
// ---------------------------------------------------------------------------

function chatToUiEvent(event: ChatEvent): UiEvent {
  const author = cleanUsername(event.user);
  return {
    kind: 'chat',
    author,
    nickname: event.user.nickname || author,
    text: event.comment,
    avatarUrl: event.user.avatarUrl || undefined,
    i18nKey: 'chatMessage',
    i18nParams: { comment: event.comment },
  };
}

function giftToUiEvent(event: GiftEvent): UiEvent | null {
  // For streakable gifts, only count the final message to avoid double-counting.
  if (event.streakable && !event.repeatEnd) return null;

  const author = cleanUsername(event.user);
  const count = Math.max(1, event.repeatCount || event.comboCount || 1);
  const giftName = event.giftName || 'Gift';
  const diamonds = event.diamondCount || 1;
  const totalDiamonds = diamonds * count;

  return {
    kind: 'gift',
    author,
    nickname: event.user.nickname || author,
    text: `sent ${count}× ${giftName} (${totalDiamonds} 🪙)`,
    avatarUrl: event.user.avatarUrl || undefined,
    giftDetails: {
      name: giftName,
      count,
      diamonds: totalDiamonds,
      imageUrl: event.giftIconUrl || undefined,
    },
    i18nKey: 'giftSent',
    i18nParams: { count, giftName, diamonds: totalDiamonds },
  };
}

function likeToUiEvent(event: LikeEvent): UiEvent {
  const author = cleanUsername(event.user);
  const likeCount = Math.max(1, event.count || 1);
  return {
    kind: 'like',
    author,
    nickname: event.user.nickname || author,
    text: `sent ${likeCount} ${likeCount === 1 ? 'like' : 'likes'} ❤️`,
    avatarUrl: event.user.avatarUrl || undefined,
    likeCount,
    i18nKey: 'likeSent',
    i18nParams: { count: likeCount },
  };
}

function memberToUiEvent(event: MemberEvent): UiEvent {
  const author = cleanUsername(event.user);
  return {
    kind: 'member',
    author,
    nickname: event.user.nickname || author,
    text: 'joined the LIVE',
    avatarUrl: event.user.avatarUrl || undefined,
    i18nKey: 'joinedLive',
    i18nParams: {},
  };
}

function socialToUiEvent(event: SocialEvent): UiEvent {
  const author = cleanUsername(event.user);
  const isFollow = event.action === SOCIAL_ACTION.follow;
  return {
    kind: 'social',
    author,
    nickname: event.user.nickname || author,
    text: isFollow ? 'followed the creator' : 'shared the LIVE',
    avatarUrl: event.user.avatarUrl || undefined,
    i18nKey: isFollow ? 'followedCreator' : 'sharedLive',
    i18nParams: {},
  };
}

// ---------------------------------------------------------------------------
// Main dispatcher — exhaustive switch, no `any`
// ---------------------------------------------------------------------------

export function toUiEvent(event: LiveEvent): UiEvent | null {
  switch (event.type) {
    case 'chat':    return chatToUiEvent(event);
    case 'gift':    return giftToUiEvent(event);
    case 'like':    return likeToUiEvent(event);
    case 'member':  return memberToUiEvent(event);
    case 'social':  return socialToUiEvent(event);
    case 'roomUser':
    case 'unknown': return null;
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

export function roomTitle(state: ClientState): string {
  return state.roomInfo?.title || '@' + state.uniqueId;
}
