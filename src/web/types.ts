import type {
  CreatorRecord,
  PointsConfig,
  TopViewerPayload,
  UiEvent,
  ViewerRecord,
} from '../shared/messages.ts';
import type { JsonObject } from '../automation/types.ts';

export type BuiltinAppTab = 'feed' | 'points' | 'analytics' | 'connect' | 'behavior' | 'plugins' | 'widgets' | 'settings';

/** Builtin tabs plus plugin page tabs (`plugin:<pluginId>:<pageId>`). */
export type AppTab = BuiltinAppTab | `plugin:${string}:${string}`;

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'retrying'
  | 'disconnected'
  | 'error';

export type DisplayEvent = UiEvent & {
  id: number;
  receivedAt: number;
};

export type EventFilter = 'all' | 'chat' | 'gift' | 'like' | 'social';

/**
 * Enriched viewer profile for the user card. Feed events carry
 * only identity fields; the leaderboard (when the viewer is
 * tracked) fills in the engagement stats.
 */
export type UserCardUser = {
  uniqueId: string;
  nickname?: string;
  avatarUrl?: string;
  points?: number;
  level?: number;
  isSubscriber?: boolean;
  totalChats?: number;
  totalCoins?: number;
  totalLikes?: number;
  totalShares?: number;
  firstSeen?: number;
  lastSeen?: number;
};

export type PluginSettingsState = {
  schema: JsonObject;
  uiHints?: JsonObject;
  values: JsonObject;
};

export type { CreatorRecord, PointsConfig, TopViewerPayload, ViewerRecord };
