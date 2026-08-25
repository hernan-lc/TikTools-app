import { isWorkflowGraph } from './automation/graph.ts';
import { normalizeAction, normalizeEvent } from './automation/behavior/schema.ts';
import type { AutomationEventType } from './automation/types.ts';
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

  if (message.type === 'get-automation-workflows') return { type: 'get-automation-workflows' };
  if (message.type === 'get-automation-nodes') return { type: 'get-automation-nodes' };
  if (message.type === 'get-automation-context') return { type: 'get-automation-context' };
  if (message.type === 'save-automation-workflow' && isWorkflowGraph(message.graph)) {
    return { type: 'save-automation-workflow', graph: message.graph };
  }
  if (message.type === 'delete-automation-workflow' && typeof message.id === 'string') {
    return { type: 'delete-automation-workflow', id: message.id };
  }
  if (
    message.type === 'set-automation-workflow-enabled' &&
    typeof message.id === 'string' &&
    typeof message.enabled === 'boolean'
  ) {
    return {
      type: 'set-automation-workflow-enabled',
      id: message.id,
      enabled: message.enabled,
    };
  }

  if (
    message.type === 'analyze-automation-script' &&
    typeof message.nodeId === 'string' &&
    typeof message.source === 'string' &&
    message.source.length <= 128 * 1024 &&
    typeof message.offset === 'number' &&
    Number.isInteger(message.offset) &&
    message.offset >= 0
  ) {
    return {
      type: 'analyze-automation-script',
      nodeId: message.nodeId,
      source: message.source,
      offset: message.offset,
      eventType: isAutomationEventType(message.eventType) ? message.eventType : undefined,
    };
  }

  if (message.type === 'get-gift-catalog') return { type: 'get-gift-catalog' };

  if (message.type === 'get-behavior') return { type: 'get-behavior' };

  if (message.type === 'delete-action' && typeof message.id === 'string') {
    return { type: 'delete-action', id: message.id };
  }
  if (message.type === 'delete-event' && typeof message.id === 'string') {
    return { type: 'delete-event', id: message.id };
  }
  if (
    (message.type === 'set-action-enabled' || message.type === 'set-event-enabled'
      || message.type === 'set-plugin-enabled' || message.type === 'set-plugin-install')
    && typeof message.id === 'string'
  ) {
    if (message.type === 'set-plugin-install' && typeof message.installed === 'boolean') {
      return { type: 'set-plugin-install', id: message.id, installed: message.installed };
    }
    if (message.type !== 'set-plugin-install' && typeof message.enabled === 'boolean') {
      return { type: message.type, id: message.id, enabled: message.enabled };
    }
    return null;
  }

  // The page is untrusted input: only records the schema accepts cross over.
  if (message.type === 'save-action' || message.type === 'test-action') {
    try {
      const action = normalizeAction(message.action);
      return message.type === 'save-action'
        ? { type: 'save-action', action }
        : {
            type: 'test-action',
            action,
            trigger: isAutomationEventType(message.trigger) ? message.trigger : undefined,
          };
    } catch {
      return null;
    }
  }

  if (message.type === 'save-event' || message.type === 'test-event') {
    try {
      const event = normalizeEvent(message.event);
      return message.type === 'save-event'
        ? { type: 'save-event', event }
        : { type: 'test-event', event };
    } catch {
      return null;
    }
  }

  return null;
}

function isAutomationEventType(value: unknown): value is AutomationEventType {
  return value === 'tiktok.chat'
    || value === 'tiktok.gift'
    || value === 'tiktok.like'
    || value === 'tiktok.follow'
    || value === 'tiktok.share'
    || value === 'tiktok.join'
    || value === 'tiktok.social'
    || value === 'tiktok.room_stats'
    || value === 'tiktok.connected'
    || value === 'tiktok.disconnected'
    || value === 'points.awarded'
    || value === 'plugin.emit';
}
