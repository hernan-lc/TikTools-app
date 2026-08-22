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
  };
  likeCount?: number;
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

export type PageMessage =
  | { type: 'connect'; uniqueId: string; sessionCookie: string; roomId?: string }
  | { type: 'pick-live'; sessionCookie: string }
  | { type: 'disconnect' }
  | { type: 'get-points-config' }
  | { type: 'update-points-config'; config: Partial<PointsConfig> }
  | { type: 'get-leaderboard'; limit?: number }
  | { type: 'reset-points'; uniqueId?: string }
  | { type: 'adjust-points'; uniqueId: string; delta: number };

export type HostMessage =
  | {
      type: 'connection';
      status: 'connecting' | 'connected' | 'disconnected';
      uniqueId?: string;
      title?: string;
    }
  | { type: 'live-event'; event: UiEvent }
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
    };
