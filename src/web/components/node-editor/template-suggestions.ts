import type { AutomationEvent, AutomationEventType, JsonValue } from '../../../automation/types.ts';
import type { Locale } from '../../i18n.ts';

export type TemplateSuggestion = {
  value: string;
  label: string;
  preview?: string;
};

const COMMON_PATHS = [
  'event.type',
  'event.user.uniqueId',
  'event.user.nickname',
  'event.creator.uniqueId',
  'event.data',
  'event.timestamp',
];

const EVENT_PATHS: Partial<Record<AutomationEventType, string[]>> = {
  'tiktok.chat': ['event.data.comment', 'event.data.method'],
  'tiktok.gift': ['event.data.giftName', 'event.data.diamondCount', 'event.data.repeatCount', 'event.data.comboCount', 'event.data.giftId'],
  'tiktok.like': ['event.data.count', 'event.data.total'],
  'tiktok.follow': ['event.data.followCount'],
  'tiktok.share': ['event.data.shareCount'],
  'tiktok.social': ['event.data.action', 'event.data.followCount', 'event.data.shareCount'],
  'tiktok.join': ['event.data.memberCount', 'event.data.action'],
  'tiktok.room_stats': ['event.data.viewers', 'event.data.totalUsers', 'event.data.popularity'],
  'tiktok.connected': ['event.data.uniqueId', 'event.data.roomId'],
  'tiktok.disconnected': ['event.data.uniqueId', 'event.data.roomId'],
  'points.awarded': ['event.data.delta', 'event.data.totalPoints', 'event.data.level', 'event.data.currencyName', 'event.data.reason'],
};

const PATH_LABELS: Record<string, [string, string]> = {
  'event.type': ['Event type', 'Tipo de evento'],
  'event.user.uniqueId': ['Viewer username', 'Usuario del espectador'],
  'event.user.nickname': ['Viewer nickname', 'Apodo del espectador'],
  'event.creator.uniqueId': ['Creator username', 'Usuario del creador'],
  'event.data': ['Event data', 'Datos del evento'],
  'event.timestamp': ['Event time', 'Hora del evento'],
  'event.data.comment': ['Chat comment', 'Comentario del chat'],
  'event.data.method': ['Event method', 'Método del evento'],
  'event.data.giftName': ['Gift name', 'Nombre del regalo'],
  'event.data.diamondCount': ['Gift diamonds', 'Diamantes del regalo'],
  'event.data.repeatCount': ['Gift repeats', 'Repeticiones del regalo'],
  'event.data.comboCount': ['Gift combo', 'Combo del regalo'],
  'event.data.giftId': ['Gift ID', 'ID del regalo'],
  'event.data.count': ['Like count', 'Cantidad de Likes'],
  'event.data.total': ['Total Likes', 'Likes totales'],
  'event.data.followCount': ['Follow count', 'Seguidores'],
  'event.data.shareCount': ['Share count', 'Compartidos'],
  'event.data.action': ['Action code', 'Código de acción'],
  'event.data.memberCount': ['Viewer count', 'Cantidad de espectadores'],
  'event.data.viewers': ['Current viewers', 'Espectadores actuales'],
  'event.data.totalUsers': ['Total viewers', 'Espectadores totales'],
  'event.data.popularity': ['Popularity', 'Popularidad'],
  'event.data.uniqueId': ['Connection username', 'Usuario de conexión'],
  'event.data.roomId': ['Room ID', 'ID de sala'],
  'event.data.delta': ['Points delta', 'Puntos ganados'],
  'event.data.totalPoints': ['Total points', 'Puntos totales'],
  'event.data.level': ['Points level', 'Nivel de puntos'],
  'event.data.currencyName': ['Currency name', 'Nombre de moneda'],
  'event.data.reason': ['Points reason', 'Motivo de puntos'],
};

export function getTemplateSuggestions(
  eventType: AutomationEventType | undefined,
  locale: Locale,
  lastEvent?: AutomationEvent,
): TemplateSuggestion[] {
  const matchingLastEvent = lastEvent && (!eventType || lastEvent.type === eventType) ? lastEvent : undefined;
  const observedPaths = matchingLastEvent ? flattenJsonPaths(matchingLastEvent, 'event') : [];
  const paths = [...new Set([
    ...COMMON_PATHS,
    ...(eventType ? EVENT_PATHS[eventType] ?? [] : []),
    ...observedPaths,
  ])];
  return paths.map((value) => ({
    value,
    label: PATH_LABELS[value]?.[locale === 'es' ? 1 : 0] ?? humanizePath(value),
    preview: matchingLastEvent ? formatTemplateValue(readTemplatePath(matchingLastEvent, value)) : undefined,
  }));
}

export function flattenJsonPaths(value: JsonValue, prefix: string, depth = 0): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || depth >= 4) return [prefix];
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  if (entries.length === 0) return [prefix];
  return entries.flatMap(([key, entry]) => flattenJsonPaths(entry ?? null, `${prefix}.${key}`, depth + 1));
}

export function readTemplatePath(event: AutomationEvent, path: string): JsonValue | undefined {
  const parts = path.split('.').filter(Boolean);
  if (parts[0] === 'event') parts.shift();
  let current: JsonValue | undefined = event;
  for (const part of parts) {
    if (current === undefined || current === null || typeof current !== 'object') return undefined;
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
    } else {
      current = current[part];
    }
  }
  return current;
}

export function formatTemplateValue(value: JsonValue | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return truncate(`"${value}"`);
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return truncate(JSON.stringify(value) ?? String(value));
  } catch {
    return String(value);
  }
}

function humanizePath(path: string): string {
  const last = path.split('.').pop() ?? path;
  return last.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (character) => character.toUpperCase());
}

function truncate(value: string): string {
  return value.length > 96 ? `${value.slice(0, 93)}...` : value;
}
