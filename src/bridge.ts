import type { PageMessage, PointsConfig } from './shared/messages.ts';

/**
 * Validate and extract only known PointsConfig fields from an arbitrary object.
 * Returns a `Partial<PointsConfig>` without any `as any` casts.
 */
function parsePartialPointsConfig(raw: Record<string, unknown>): Partial<PointsConfig> {
  const result: Partial<PointsConfig> = {};

  if (typeof raw.currencyName === 'string')         result.currencyName         = raw.currencyName;
  if (typeof raw.pointsPerCoin === 'number')        result.pointsPerCoin        = raw.pointsPerCoin;
  if (typeof raw.pointsPerCoinEnabled === 'boolean') result.pointsPerCoinEnabled = raw.pointsPerCoinEnabled;
  if (typeof raw.pointsPerShare === 'number')       result.pointsPerShare       = raw.pointsPerShare;
  if (typeof raw.pointsPerShareEnabled === 'boolean') result.pointsPerShareEnabled = raw.pointsPerShareEnabled;
  if (typeof raw.pointsPerChat === 'number')        result.pointsPerChat        = raw.pointsPerChat;
  if (typeof raw.pointsPerChatEnabled === 'boolean') result.pointsPerChatEnabled = raw.pointsPerChatEnabled;
  if (typeof raw.pointsPerLike === 'number')        result.pointsPerLike        = raw.pointsPerLike;
  if (typeof raw.pointsPerLikeEnabled === 'boolean') result.pointsPerLikeEnabled = raw.pointsPerLikeEnabled;
  if (typeof raw.pointsPerFollow === 'number')      result.pointsPerFollow      = raw.pointsPerFollow;
  if (typeof raw.pointsPerFollowEnabled === 'boolean') result.pointsPerFollowEnabled = raw.pointsPerFollowEnabled;
  if (typeof raw.pointsPerJoin === 'number')        result.pointsPerJoin        = raw.pointsPerJoin;
  if (typeof raw.pointsPerJoinEnabled === 'boolean') result.pointsPerJoinEnabled = raw.pointsPerJoinEnabled;
  if (typeof raw.subBonusMultiplier === 'number')   result.subBonusMultiplier   = raw.subBonusMultiplier;
  if (typeof raw.pointsPerLevel === 'number')       result.pointsPerLevel       = raw.pointsPerLevel;

  return result;
}

export function parsePageMessage(raw: string): PageMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!value || typeof value !== 'object') return null;
  const message = value as Record<string, unknown>;

  if (message.type === 'disconnect') return { type: 'disconnect' };
  if (
    message.type === 'connect' &&
    typeof message.uniqueId === 'string' &&
    typeof message.sessionCookie === 'string'
  ) {
    return {
      type: 'connect',
      uniqueId: message.uniqueId,
      sessionCookie: message.sessionCookie,
    };
  }
  if (message.type === 'pick-live' && typeof message.sessionCookie === 'string') {
    return { type: 'pick-live', sessionCookie: message.sessionCookie };
  }

  if (message.type === 'get-points-config') return { type: 'get-points-config' };
  if (
    message.type === 'update-points-config' &&
    message.config !== null &&
    typeof message.config === 'object' &&
    !Array.isArray(message.config)
  ) {
    return {
      type: 'update-points-config',
      config: parsePartialPointsConfig(message.config as Record<string, unknown>),
    };
  }
  if (message.type === 'get-leaderboard') {
    return {
      type: 'get-leaderboard',
      limit: typeof message.limit === 'number' ? message.limit : undefined,
    };
  }
  if (message.type === 'reset-points') {
    return {
      type: 'reset-points',
      uniqueId: typeof message.uniqueId === 'string' ? message.uniqueId : undefined,
    };
  }
  if (
    message.type === 'adjust-points' &&
    typeof message.uniqueId === 'string' &&
    typeof message.delta === 'number'
  ) {
    return {
      type: 'adjust-points',
      uniqueId: message.uniqueId,
      delta: message.delta,
    };
  }

  return null;
}
