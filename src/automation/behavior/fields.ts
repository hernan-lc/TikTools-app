import type { AutomationEventType } from '../types.ts';
import type { FilterOperator, Localized } from './types.ts';

/**
 * The condition editor never asks anyone to type `event.data.diamondCount`.
 * It offers the fields a trigger actually carries, each with the kind of value
 * it holds — which in turn decides the operators on offer and the editor used
 * for the value (a gift picker, a viewer picker, a number, a switch).
 */
export type FieldIcon = 'gift' | 'gem' | 'user' | 'star' | 'repeat' | 'text' | 'hash' | 'clock';

export type FieldValueKind = 'gift' | 'user' | 'number' | 'text' | 'boolean';

export interface EventFieldDefinition {
  /** Dotted path, exactly what the filter stores. */
  path: string;
  label: Localized;
  icon: FieldIcon;
  kind: FieldValueKind;
  /** Shown behind the info icon: what the field means, in plain words. */
  hint: Localized;
}

const NUMBER_OPS: FilterOperator[] = ['gte', 'gt', 'lte', 'lt', 'eq', 'neq'];
const TEXT_OPS: FilterOperator[] = ['eq', 'neq', 'in', 'contains', 'starts-with'];
const PICK_OPS: FilterOperator[] = ['eq', 'neq', 'in'];
const BOOL_OPS: FilterOperator[] = ['is-true', 'is-false'];

export function operatorsFor(kind: FieldValueKind): FilterOperator[] {
  switch (kind) {
    case 'number':
      return NUMBER_OPS;
    case 'boolean':
      return BOOL_OPS;
    case 'gift':
    case 'user':
      return PICK_OPS;
    default:
      return TEXT_OPS;
  }
}

/** Fields every event carries, whatever the trigger. */
const COMMON_FIELDS: EventFieldDefinition[] = [
  {
    path: 'event.user.uniqueId',
    label: { default: "Viewer", i18key: "automation.event.field.event.user.uniqueId.label" },
    icon: 'user',
    kind: 'user',
    hint: { default: "The @ of whoever triggers the event.", i18key: "automation.event.field.event.user.uniqueId.hint" },
  },
  {
    path: 'event.user.nickname',
    label: { default: "Display name", i18key: "automation.event.field.event.user.nickname.label" },
    icon: 'text',
    kind: 'text',
    hint: { default: "The name TikTok shows, which can change.", i18key: "automation.event.field.event.user.nickname.hint" },
  },
];

const GIFT_FIELDS: EventFieldDefinition[] = [
  {
    path: 'event.data.giftName',
    label: { default: "Gift", i18key: "automation.event.field.event.data.giftName.label" },
    icon: 'gift',
    kind: 'gift',
    hint: { default: "The gift name exactly as TikTok sends it.", i18key: "automation.event.field.event.data.giftName.hint" },
  },
  {
    path: 'event.data.diamondCount',
    label: { default: "Diamonds", i18key: "automation.event.field.event.data.diamondCount.label" },
    icon: 'gem',
    kind: 'number',
    hint: { default: "What the gift is worth in diamonds.", i18key: "automation.event.field.event.data.diamondCount.hint" },
  },
  {
    path: 'event.data.repeatCount',
    label: { default: "Repeat count", i18key: "automation.event.field.event.data.repeatCount.label" },
    icon: 'hash',
    kind: 'number',
    hint: { default: "How many times in a row the same gift was sent.", i18key: "automation.event.field.event.data.repeatCount.hint" },
  },
  {
    path: 'event.data.repeatEnd',
    label: { default: "Streak finished", i18key: "automation.event.field.event.data.repeatEnd.label" },
    icon: 'repeat',
    kind: 'boolean',
    hint: { default: "True only on the last hit of a streak: use it to fire once per streak.", i18key: "automation.event.field.event.data.repeatEnd.hint" },
  },
];

const CHAT_FIELDS: EventFieldDefinition[] = [
  {
    path: 'event.data.comment',
    label: { default: "Message", i18key: "automation.event.field.event.data.comment.label" },
    icon: 'text',
    kind: 'text',
    hint: { default: "The text written in chat.", i18key: "automation.event.field.event.data.comment.hint" },
  },
];

const LIKE_FIELDS: EventFieldDefinition[] = [
  {
    path: 'event.data.count',
    label: { default: "Likes at once", i18key: "automation.event.field.event.data.count.label" },
    icon: 'hash',
    kind: 'number',
    hint: { default: "How many likes this event carries.", i18key: "automation.event.field.event.data.count.hint" },
  },
  {
    path: 'event.data.total',
    label: { default: "Total likes", i18key: "automation.event.field.event.data.total.label" },
    icon: 'hash',
    kind: 'number',
    hint: { default: "Likes accumulated in the live.", i18key: "automation.event.field.event.data.total.hint" },
  },
];

const POINTS_FIELDS: EventFieldDefinition[] = [
  {
    path: 'event.data.delta',
    label: { default: "Points added", i18key: "automation.event.field.event.data.delta.label" },
    icon: 'star',
    kind: 'number',
    hint: { default: "What went up or down in this operation.", i18key: "automation.event.field.event.data.delta.hint" },
  },
  {
    path: 'event.data.totalPoints',
    label: { default: "Total points", i18key: "automation.event.field.event.data.totalPoints.label" },
    icon: 'star',
    kind: 'number',
    hint: { default: "The viewer's balance after the change.", i18key: "automation.event.field.event.data.totalPoints.hint" },
  },
  {
    path: 'event.data.level',
    label: { default: "Level", i18key: "automation.event.field.event.data.level.label" },
    icon: 'hash',
    kind: 'number',
    hint: { default: "The level reached with those points.", i18key: "automation.event.field.event.data.level.hint" },
  },
  {
    path: 'event.data.reason',
    label: { default: "Reason", i18key: "automation.event.field.event.data.reason.label" },
    icon: 'text',
    kind: 'text',
    hint: { default: "Why the points were given: chat, gift…", i18key: "automation.event.field.event.data.reason.hint" },
  },
];

const ROOM_FIELDS: EventFieldDefinition[] = [
  {
    path: 'event.data.viewers',
    label: { default: "Viewers", i18key: "automation.event.field.event.data.viewers.label" },
    icon: 'user',
    kind: 'number',
    hint: { default: "How many people are watching right now.", i18key: "automation.event.field.event.data.viewers.hint" },
  },
];

const EMIT_FIELDS: EventFieldDefinition[] = [
  {
    path: 'event.data.emitType',
    label: { default: "Emitted type", i18key: "automation.event.field.event.data.emitType.label" },
    icon: 'text',
    kind: 'text',
    hint: { default: "The name the action or plugin emitted.", i18key: "automation.event.field.event.data.emitType.hint" },
  },
];

const BY_TRIGGER: Partial<Record<AutomationEventType, EventFieldDefinition[]>> = {
  'tiktok.gift': GIFT_FIELDS,
  'tiktok.chat': CHAT_FIELDS,
  'tiktok.like': LIKE_FIELDS,
  'tiktok.room_stats': ROOM_FIELDS,
  'points.awarded': POINTS_FIELDS,
  'plugin.emit': EMIT_FIELDS,
};

/** Trigger-specific fields first, then the ones every event carries. */
export function fieldsForTrigger(trigger: AutomationEventType): EventFieldDefinition[] {
  const own = BY_TRIGGER[trigger] ?? [];
  if (trigger === 'points.awarded' || trigger === 'tiktok.room_stats' || trigger === 'plugin.emit') {
    return [...own, COMMON_FIELDS[0]!];
  }
  return [...own, ...COMMON_FIELDS];
}

export function findField(trigger: AutomationEventType, path: string): EventFieldDefinition | undefined {
  return fieldsForTrigger(trigger).find((field) => field.path === path);
}

/** A path the user wrote by hand still has to render: treat it as free text. */
export function fieldKindFor(trigger: AutomationEventType, path: string): FieldValueKind {
  return findField(trigger, path)?.kind ?? 'text';
}
