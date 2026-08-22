import { SOCIAL_ACTION } from '../../vendor/tiktok-signer/packages/tiktok-live/src/index.ts';
import type {
  ChatEvent,
  ClientState,
  GiftEvent,
  LikeEvent,
  LiveEvent,
  MemberEvent,
  RoomUserEvent,
  SocialEvent,
} from '../../vendor/tiktok-signer/packages/tiktok-live/src/index.ts';

import { hasUser } from '../live-events.ts';
import type {
  AutomationConnectionContext,
  AutomationEvent,
  AutomationUser,
  ConnectionData,
  JsonArray,
  JsonValue,
  PointsAwardedData,
  TikTokChatData,
  TikTokGiftData,
  TikTokLikeData,
  TikTokMemberData,
  TikTokRoomStatsData,
  TikTokSocialData,
} from './types.ts';

let eventSequence = 0;

export function createAutomationEventId(prefix = 'event'): string {
  eventSequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${eventSequence.toString(36)}`;
}

function userFromEvent(user: {
  userId?: string;
  uniqueId?: string;
  nickname?: string;
  avatarUrl?: string;
}): AutomationUser {
  return {
    userId: user.userId,
    uniqueId: (user.uniqueId || 'viewer').replace(/^@+/, ''),
    nickname: user.nickname || undefined,
    avatarUrl: user.avatarUrl || undefined,
  };
}

function creatorFromContext(context?: AutomationConnectionContext) {
  if (!context?.uniqueId) return undefined;
  return {
    uniqueId: context.uniqueId.replace(/^@+/, ''),
    roomId: context.roomId,
  };
}

function baseEvent<T extends JsonValue>(
  type: AutomationEvent['type'],
  data: T,
  context?: AutomationConnectionContext,
): AutomationEvent<T> {
  return {
    id: createAutomationEventId(type.replaceAll('.', '-')),
    type,
    timestamp: Date.now(),
    connectionId: context?.connectionId,
    creator: creatorFromContext(context),
    data,
  };
}

function normalizeChat(event: ChatEvent, context?: AutomationConnectionContext): AutomationEvent<TikTokChatData> {
  return {
    ...baseEvent('tiktok.chat', {
      comment: event.comment,
      method: event.method,
      msgId: event.msgId,
      isHistory: Boolean(event.isHistory),
    }, context),
    user: userFromEvent(event.user),
  };
}

function normalizeGift(event: GiftEvent, context?: AutomationConnectionContext): AutomationEvent<TikTokGiftData> {
  return {
    ...baseEvent('tiktok.gift', {
      giftId: event.giftId,
      giftName: event.giftName,
      diamondCount: Number(event.diamondCount || 0),
      repeatCount: Number(event.repeatCount || 0),
      comboCount: Number(event.comboCount || 0),
      groupId: event.groupId,
      repeatEnd: Boolean(event.repeatEnd),
      streakable: Boolean(event.streakable),
      giftIconUrl: event.giftIconUrl || undefined,
      toUser: userFromEvent(event.toUser),
    }, context),
    user: userFromEvent(event.user),
  };
}

function normalizeLike(event: LikeEvent, context?: AutomationConnectionContext): AutomationEvent<TikTokLikeData> {
  return {
    ...baseEvent('tiktok.like', {
      count: Number(event.count || 0),
      total: Number(event.total || 0),
      method: event.method,
      msgId: event.msgId,
    }, context),
    user: userFromEvent(event.user),
  };
}

function normalizeMember(event: MemberEvent, context?: AutomationConnectionContext): AutomationEvent<TikTokMemberData> {
  return {
    ...baseEvent('tiktok.join', {
      memberCount: Number(event.memberCount || 0),
      action: Number(event.action || 0),
      method: event.method,
      msgId: event.msgId,
    }, context),
    user: userFromEvent(event.user),
  };
}

function normalizeSocial(event: SocialEvent, context?: AutomationConnectionContext): AutomationEvent<TikTokSocialData> {
  const type = event.action === SOCIAL_ACTION.follow
    ? 'tiktok.follow'
    : event.action === SOCIAL_ACTION.share
      ? 'tiktok.share'
      : 'tiktok.social';

  return {
    ...baseEvent(type, {
      action: Number(event.action || 0),
      followCount: Number(event.followCount || 0),
      shareCount: Number(event.shareCount || 0),
      method: event.method,
      msgId: event.msgId,
    }, context),
    user: userFromEvent(event.user),
  };
}

function normalizeRoomStats(event: RoomUserEvent, context?: AutomationConnectionContext): AutomationEvent<TikTokRoomStatsData> {
  const topViewers: JsonArray = event.topViewers.slice(0, 20).map((viewer) => ({
    rank: viewer.rank,
    score: viewer.score,
    delta: viewer.delta,
    user: userFromEvent(viewer.user),
  }));

  return baseEvent('tiktok.room_stats', {
    viewers: Number(event.viewers || 0),
    totalUsers: Number(event.totalUser || 0),
    popularity: Number(event.popularity || 0),
    anonymous: Number(event.anonymous || 0),
    topViewers,
  }, context);
}

export function normalizeTikTokEvent(
  event: LiveEvent,
  context?: AutomationConnectionContext,
): AutomationEvent | null {
  switch (event.type) {
    case 'chat': return normalizeChat(event, context);
    case 'gift': return normalizeGift(event, context);
    case 'like': return normalizeLike(event, context);
    case 'member': return normalizeMember(event, context);
    case 'social': return normalizeSocial(event, context);
    case 'roomUser': return normalizeRoomStats(event, context);
    case 'unknown': return null;
  }
}

export function createConnectedEvent(state: ClientState, connectionId?: string): AutomationEvent<ConnectionData> {
  const context: AutomationConnectionContext = {
    connectionId,
    uniqueId: state.uniqueId,
    roomId: state.roomId,
  };
  return baseEvent('tiktok.connected', {
    uniqueId: state.uniqueId,
    roomId: state.roomId,
  }, context);
}

export function createDisconnectedEvent(context?: AutomationConnectionContext): AutomationEvent<ConnectionData> {
  return baseEvent('tiktok.disconnected', {
    uniqueId: context?.uniqueId || '',
    roomId: context?.roomId,
  }, context);
}

export function createPointsAwardedEvent(
  result: {
    uniqueId: string;
    delta: number;
    totalPoints: number;
    level: number;
    currencyName: string;
  },
  reason: string,
  sourceEventId: string,
  context?: AutomationConnectionContext,
): AutomationEvent<PointsAwardedData> {
  return {
    ...baseEvent('points.awarded', {
      uniqueId: result.uniqueId,
      delta: result.delta,
      totalPoints: result.totalPoints,
      level: result.level,
      currencyName: result.currencyName,
      reason,
    }, context),
    user: {
      uniqueId: result.uniqueId,
    },
    sourceEventId,
    points: {
      delta: result.delta,
      total: result.totalPoints,
      level: result.level,
    },
  };
}

export function eventHasUser(event: LiveEvent): boolean {
  return hasUser(event);
}
