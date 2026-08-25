import type { LivePlugin, LivePluginRecord, LivePluginRun } from '../automation/live-plugins/types.ts';
import type {
  AutomationEventType,
  AutomationEvent,
  AutomationScriptAnalysis,
  NodeDefinition,
  WorkflowGraph,
} from '../automation/types.ts';

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
  | { type: 'get-live-plugins' }
  | { type: 'save-live-plugin'; plugin: LivePlugin }
  | { type: 'delete-live-plugin'; id: string }
  | { type: 'set-live-plugin-enabled'; id: string; enabled: boolean }
  | { type: 'test-live-plugin'; plugin: LivePlugin };

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
  | { type: 'gift-debug'; giftId?: string; iconUrl?: string; hasIcon: boolean; totalGifts: number }
  | { type: 'automation-workflows'; workflows: AutomationWorkflowRecord[] }
  | { type: 'automation-node-catalog'; nodes: NodeDefinition[] }
  | { type: 'automation-context'; event: AutomationEvent | null; capturedAt?: number }
  | { type: 'automation-script-analysis'; analysis: AutomationScriptAnalysis }
  | { type: 'automation-error'; message: string }
  | { type: 'live-plugins'; plugins: LivePluginRecord[] }
  | { type: 'live-plugin-runs'; runs: LivePluginRun[] }
  | { type: 'live-plugin-test-result'; run: LivePluginRun }
  | { type: 'live-plugin-error'; message: string };
