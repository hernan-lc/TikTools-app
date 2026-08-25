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
    label: { es: 'Usuario', en: 'Viewer' },
    icon: 'user',
    kind: 'user',
    hint: { es: 'El @ de quien dispara el evento.', en: 'The @ of whoever triggers the event.' },
  },
  {
    path: 'event.user.nickname',
    label: { es: 'Nombre visible', en: 'Display name' },
    icon: 'text',
    kind: 'text',
    hint: { es: 'El nombre que muestra TikTok, que puede cambiar.', en: 'The name TikTok shows, which can change.' },
  },
];

const GIFT_FIELDS: EventFieldDefinition[] = [
  {
    path: 'event.data.giftName',
    label: { es: 'Regalo', en: 'Gift' },
    icon: 'gift',
    kind: 'gift',
    hint: { es: 'El nombre del regalo tal y como lo manda TikTok.', en: 'The gift name exactly as TikTok sends it.' },
  },
  {
    path: 'event.data.diamondCount',
    label: { es: 'Diamantes', en: 'Diamonds' },
    icon: 'gem',
    kind: 'number',
    hint: { es: 'Lo que vale el regalo en diamantes.', en: 'What the gift is worth in diamonds.' },
  },
  {
    path: 'event.data.repeatCount',
    label: { es: 'Veces seguidas', en: 'Repeat count' },
    icon: 'hash',
    kind: 'number',
    hint: {
      es: 'Cuántas veces seguidas ha mandado el mismo regalo.',
      en: 'How many times in a row the same gift was sent.',
    },
  },
  {
    path: 'event.data.repeatEnd',
    label: { es: 'Racha terminada', en: 'Streak finished' },
    icon: 'repeat',
    kind: 'boolean',
    hint: {
      es: 'Cierto sólo en el último golpe de una racha: úsalo para disparar una vez por racha.',
      en: 'True only on the last hit of a streak: use it to fire once per streak.',
    },
  },
];

const CHAT_FIELDS: EventFieldDefinition[] = [
  {
    path: 'event.data.comment',
    label: { es: 'Mensaje', en: 'Message' },
    icon: 'text',
    kind: 'text',
    hint: { es: 'El texto escrito en el chat.', en: 'The text written in chat.' },
  },
];

const LIKE_FIELDS: EventFieldDefinition[] = [
  {
    path: 'event.data.count',
    label: { es: 'Likes de golpe', en: 'Likes at once' },
    icon: 'hash',
    kind: 'number',
    hint: { es: 'Cuántos likes trae este evento.', en: 'How many likes this event carries.' },
  },
  {
    path: 'event.data.total',
    label: { es: 'Likes totales', en: 'Total likes' },
    icon: 'hash',
    kind: 'number',
    hint: { es: 'Likes acumulados del directo.', en: 'Likes accumulated in the live.' },
  },
];

const POINTS_FIELDS: EventFieldDefinition[] = [
  {
    path: 'event.data.delta',
    label: { es: 'Puntos sumados', en: 'Points added' },
    icon: 'star',
    kind: 'number',
    hint: { es: 'Lo que ha subido o bajado en esta operación.', en: 'What went up or down in this operation.' },
  },
  {
    path: 'event.data.totalPoints',
    label: { es: 'Puntos totales', en: 'Total points' },
    icon: 'star',
    kind: 'number',
    hint: { es: 'El saldo del usuario después de sumar.', en: "The viewer's balance after the change." },
  },
  {
    path: 'event.data.level',
    label: { es: 'Nivel', en: 'Level' },
    icon: 'hash',
    kind: 'number',
    hint: { es: 'El nivel alcanzado con esos puntos.', en: 'The level reached with those points.' },
  },
  {
    path: 'event.data.reason',
    label: { es: 'Motivo', en: 'Reason' },
    icon: 'text',
    kind: 'text',
    hint: { es: 'Por qué se han dado los puntos: chat, gift…', en: 'Why the points were given: chat, gift…' },
  },
];

const ROOM_FIELDS: EventFieldDefinition[] = [
  {
    path: 'event.data.viewers',
    label: { es: 'Espectadores', en: 'Viewers' },
    icon: 'user',
    kind: 'number',
    hint: { es: 'Cuánta gente está viendo ahora mismo.', en: 'How many people are watching right now.' },
  },
];

const EMIT_FIELDS: EventFieldDefinition[] = [
  {
    path: 'event.data.emitType',
    label: { es: 'Tipo emitido', en: 'Emitted type' },
    icon: 'text',
    kind: 'text',
    hint: { es: 'El nombre que emitió la acción o el plugin.', en: 'The name the action or plugin emitted.' },
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
