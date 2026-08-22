import type {
  PointsConfig,
  TopViewerPayload,
  UiEvent,
  ViewerRecord,
} from '../shared/messages.ts';

export type AppTab = 'feed' | 'points' | 'analytics' | 'connect' | 'settings';

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

export type StreamTelemetry = {
  chats: number;
  gifts: number;
  likes: number;
  members: number;
};

export type { PointsConfig, TopViewerPayload, ViewerRecord };
