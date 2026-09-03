import type {
  BehaviorRun,
  BehaviorSnapshot,
  LiveAction,
  LiveEvent,
} from '../automation/behavior/types.ts';
import type {
  AutomationEventType,
  AutomationEvent,
  AutomationScriptAnalysis,
  JsonObject,
  NodeDefinition,
  WorkflowGraph,
} from '../automation/types.ts';

export type PluginSettingValues = Record<string, string | number | boolean>;

export type ActionOptionItem = { value: string; label: string };

export type UiEvent = {
  kind: 'chat' | 'gift' | 'like' | 'member' | 'social';
  author: string;
  nickname?: string;
  text: string;
  avatarUrl?: string;
  points?: number;
  level?: number;
  pointsDelta?: number;
  isSubscriber?: boolean;
  giftDetails?: {
    name: string;
    count: number;
    diamonds: number;
    imageUrl?: string;
  };
  likeCount?: number;
  // raw i18n keys + params for the renderer to localize
  i18nKey?: string;
  i18nParams?: Record<string, string | number>;
};

export type PointsConfig = {
  currencyName: string;
  pointsPerCoin: number;
  pointsPerCoinEnabled: boolean;
  pointsPerShare: number;
  pointsPerShareEnabled: boolean;
  pointsPerChat: number;
  pointsPerChatEnabled: boolean;
  pointsPerLike: number;
  pointsPerLikeEnabled: boolean;
  pointsPerFollow: number;
  pointsPerFollowEnabled: boolean;
  pointsPerJoin: number;
  pointsPerJoinEnabled: boolean;
  subBonusMultiplier: number;
  pointsPerLevel: number;
};

export type ViewerRecord = {
  uniqueId: string;
  userId?: string;
  nickname?: string;
  avatarUrl?: string;
  points: number;
  level: number;
  isSubscriber: boolean;
  totalChats: number;
  totalCoins: number;
  totalLikes: number;
  totalShares: number;
  firstSeen: number;
  lastSeen: number;
};

export type CreatorRecord = {
  uniqueId: string;
  roomId: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  title: string | null;
  lastConnected: number;
  connectCount: number;
  displayId?: string;
};

export type AutomationWorkflowRecord = {
  id: string;
  name: string;
  enabled: boolean;
  graph: WorkflowGraph;
  createdAt: number;
  updatedAt: number;
};

export type PageMessage =
  | { type: 'connect'; uniqueId: string; sessionCookie: string; roomId?: string }
  | { type: 'pick-live'; sessionCookie: string }
  | { type: 'disconnect' }
  | { type: 'get-points-config' }
  | { type: 'update-points-config'; config: Partial<PointsConfig> }
  | { type: 'get-leaderboard'; limit?: number }
  | { type: 'reset-points'; uniqueId?: string }
  | { type: 'adjust-points'; uniqueId: string; delta: number }
  | { type: 'get-creator'; uniqueId?: string }
  | { type: 'get-recent-creators'; limit?: number }
  | { type: 'get-app-state'; keys?: string[] }
  | { type: 'set-app-state'; key: string; value: string }
  | { type: 'clear-creator-history' }
  | { type: 'debug-gift'; giftId?: string }
  | { type: 'get-automation-workflows' }
  | { type: 'get-automation-nodes' }
  | { type: 'get-automation-context' }
  | { type: 'save-automation-workflow'; graph: WorkflowGraph }
  | { type: 'delete-automation-workflow'; id: string }
  | { type: 'set-automation-workflow-enabled'; id: string; enabled: boolean }
  | {
      type: 'analyze-automation-script';
      nodeId: string;
      source: string;
      offset: number;
      eventType?: AutomationEventType;
    }
  | { type: 'get-gift-catalog' }
  | { type: 'get-behavior' }
  | { type: 'save-action'; action: LiveAction }
  | { type: 'delete-action'; id: string }
  | { type: 'set-action-enabled'; id: string; enabled: boolean }
  | { type: 'test-action'; action: LiveAction; trigger?: AutomationEventType }
  | { type: 'save-event'; event: LiveEvent }
  | { type: 'delete-event'; id: string }
  | { type: 'set-event-enabled'; id: string; enabled: boolean }
  | { type: 'test-event'; event: LiveEvent }
  | { type: 'set-plugin-install'; id: string; installed: boolean }
  | { type: 'set-plugin-enabled'; id: string; enabled: boolean }
  | { type: 'get-plugin-settings'; id: string }
  | { type: 'save-plugin-settings'; id: string; values: PluginSettingValues }
  | { type: 'get-action-options'; source: string };

export type GiftCatalogEntry = {
  id: string;
  name: string;
  diamondCount: number;
  iconUrl?: string;
};

export type TopViewerPayload = {
  rank: number;
  score: number;
  delta: number;
  uniqueId: string;
  nickname: string;
  avatarUrl?: string;
  userId: string;
};

export type HostMessage =
  | {
      type: 'connection';
      status: 'connecting' | 'connected' | 'disconnected';
      uniqueId?: string;
      title?: string;
      roomId?: string;
      avatarUrl?: string;
    }
  | { type: 'live-event'; event: UiEvent }
  | { type: 'room-stats'; viewers: number; totalUsers: number; topViewers: TopViewerPayload[] }
  | { type: 'reconnecting'; attempt: number; delayMs: number }
  | { type: 'error'; phase: 'connect' | 'live'; message: string }
  | { type: 'points-config'; config: PointsConfig }
  | { type: 'leaderboard'; viewers: ViewerRecord[] }
  | {
      type: 'points-awarded';
      uniqueId: string;
      delta: number;
      totalPoints: number;
      level: number;
    }
  | { type: 'creator-state'; creator: CreatorRecord | null }
  | { type: 'recent-creators'; creators: CreatorRecord[] }
  | { type: 'app-state'; state: Record<string, string> }
  | { type: 'gift-catalog'; gifts: GiftCatalogEntry[] }
  | { type: 'gift-debug'; giftId?: string; iconUrl?: string; hasIcon: boolean; totalGifts: number }
  | { type: 'automation-workflows'; workflows: AutomationWorkflowRecord[] }
  | { type: 'automation-node-catalog'; nodes: NodeDefinition[] }
  | { type: 'automation-context'; event: AutomationEvent | null; capturedAt?: number }
  | { type: 'automation-script-analysis'; analysis: AutomationScriptAnalysis }
  | { type: 'automation-error'; message: string }
  | { type: 'behavior'; snapshot: BehaviorSnapshot }
  | { type: 'behavior-runs'; runs: BehaviorRun[] }
  | { type: 'behavior-test-result'; runs: BehaviorRun[] }
  | { type: 'behavior-error'; message: string }
  | { type: 'plugin-settings'; id: string; schema: JsonObject; uiHints?: JsonObject; values: JsonObject }
  | { type: 'action-options'; source: string; options: ActionOptionItem[] };
