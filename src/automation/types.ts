/**
 * JSON-safe values are the only values allowed to cross the automation
 * boundary. Native TikTok objects, VM handles, database connections, and
 * service instances must never be placed in an AutomationEvent.
 */
export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue | undefined;
}
export type JsonArray = JsonValue[];

import type { AutomationCapabilities } from './capabilities.ts';

export type AutomationEventType =
  | 'tiktok.chat'
  | 'tiktok.gift'
  | 'tiktok.like'
  | 'tiktok.follow'
  | 'tiktok.share'
  | 'tiktok.join'
  | 'tiktok.social'
  | 'tiktok.room_stats'
  | 'tiktok.connected'
  | 'tiktok.disconnected'
  | 'points.awarded'
  /** Internal event published by a live plugin's `emit` action. */
  | 'plugin.emit';

export interface AutomationUser extends JsonObject {
  userId?: string;
  uniqueId: string;
  nickname?: string;
  avatarUrl?: string;
}

export interface AutomationCreator extends JsonObject {
  uniqueId: string;
  roomId?: string;
}

export interface AutomationConnectionContext {
  connectionId?: string;
  uniqueId: string;
  roomId?: string;
}

export interface AutomationPoints extends JsonObject {
  delta?: number;
  total?: number;
  level?: number;
}

export interface AutomationEvent<T extends JsonValue = JsonValue> extends JsonObject {
  id: string;
  type: AutomationEventType;
  timestamp: number;
  connectionId?: string;
  creator?: AutomationCreator;
  user?: AutomationUser;
  data: T;
  points?: AutomationPoints;
  sourceEventId?: string;
}

export interface TikTokChatData extends JsonObject {
  comment: string;
  method: string;
  msgId?: string;
  isHistory: boolean;
}

export interface TikTokGiftData extends JsonObject {
  giftId: string;
  giftName: string;
  diamondCount: number;
  repeatCount: number;
  comboCount: number;
  groupId: string;
  repeatEnd: boolean;
  streakable: boolean;
  giftIconUrl?: string;
  toUser?: AutomationUser;
}

export interface TikTokLikeData extends JsonObject {
  count: number;
  total: number;
  method: string;
  msgId?: string;
}

export interface TikTokSocialData extends JsonObject {
  action: number;
  followCount: number;
  shareCount: number;
  method: string;
  msgId?: string;
}

export interface TikTokMemberData extends JsonObject {
  memberCount: number;
  action: number;
  method: string;
  msgId?: string;
}

export interface TikTokRoomStatsData extends JsonObject {
  viewers: number;
  totalUsers: number;
  popularity: number;
  anonymous: number;
  topViewers: JsonArray;
}

export interface ConnectionData extends JsonObject {
  uniqueId: string;
  roomId?: string;
}

export interface PointsAwardedData extends JsonObject {
  uniqueId: string;
  delta: number;
  totalPoints: number;
  level: number;
  currencyName: string;
  reason: string;
}

export type PortKind = 'flow' | 'data';

export type ValueType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'json'
  | 'event'
  | 'bytes'
  | 'audio-ref'
  | 'secret-ref';

export interface PortDefinition {
  name: string;
  title: string;
  kind: PortKind;
  valueType?: ValueType;
  required?: boolean;
  multiple?: boolean;
}

export interface NodeDefinition {
  type: string;
  version: number;
  pluginId: string;
  title: string;
  category: string;
  kind: 'trigger' | 'condition' | 'transform' | 'action' | 'control';
  inputs: PortDefinition[];
  outputs: PortDefinition[];
  configSchema: JsonObject;
  requiredCapabilities?: string[];
  /** Optional fast-path trigger filter for worker-backed trigger nodes. */
  triggerTypes?: AutomationEventType[];
}

export interface WorkflowNode {
  id: string;
  type: string;
  version: number;
  position: { x: number; y: number };
  config: JsonObject;
  disabled?: boolean;
}

export interface WorkflowEdge {
  id: string;
  kind: PortKind;
  source: string;
  sourcePort: string;
  target: string;
  targetPort: string;
}

export interface WorkflowGraph {
  schemaVersion: 1;
  id: string;
  name: string;
  enabled: boolean;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface NodeExecutionContext {
  runId: string;
  workflowId: string;
  node: WorkflowNode;
  event: AutomationEvent;
  inputs: Record<string, JsonValue | undefined>;
  state: WorkflowState;
  signal: AbortSignal;
  capabilities: AutomationCapabilities;
  log(message: string, metadata?: JsonObject): void;
}

export interface WorkflowState {
  get(key: string): JsonValue | undefined;
  set(key: string, value: JsonValue): void;
  delete(key: string): void;
}

export interface NodeExecutionResult {
  outputs?: Record<string, JsonValue>;
  next?: string[];
}

export interface NodeImplementation {
  definition: NodeDefinition;
  matchesTrigger?(node: WorkflowNode, event: AutomationEvent): boolean;
  execute(context: NodeExecutionContext): NodeExecutionResult | Promise<NodeExecutionResult>;
}

export interface ExecutionLogEntry {
  runId: string;
  workflowId: string;
  nodeId?: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: number;
  metadata?: JsonObject;
}

export interface AutomationScriptDiagnostic {
  line: number;
  column: number;
  message: string;
  severity: string;
}

export interface AutomationScriptCompletion {
  label: string;
  kind: string;
  detail?: string;
  documentation?: string;
  path?: string;
  value?: JsonValue;
  valueSource?: 'live-event' | 'sample-event';
}

export interface AutomationScriptHover {
  detail: string;
  documentation?: string;
  path?: string;
  value?: JsonValue;
  valueSource?: 'live-event' | 'sample-event';
}

export interface AutomationScriptAnalysis {
  nodeId: string;
  source: string;
  diagnostics: AutomationScriptDiagnostic[];
  completions: AutomationScriptCompletion[];
  hover?: AutomationScriptHover;
}
