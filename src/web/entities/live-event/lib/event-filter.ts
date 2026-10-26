import type { DisplayEvent, EventFilter } from '@/types.ts';

export const eventFilters: readonly EventFilter[] = ['all', 'chat', 'gift', 'like', 'follow', 'join', 'social'];

const cache = new WeakMap<readonly DisplayEvent[], { key: string; result: DisplayEvent[] }>();

function matchesKind(event: DisplayEvent, filter: EventFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'follow') return event.kind === 'social' && event.i18nKey === 'followedCreator';
  if (filter === 'join') return event.kind === 'member';
  if (filter === 'social') return event.kind === 'social' && event.i18nKey !== 'followedCreator';
  return event.kind === filter;
}

export function filterEvents(events: readonly DisplayEvent[], filter: EventFilter, query: string): DisplayEvent[] {
  const needle = query.trim().toLowerCase();
  const key = `${filter}::${needle}`;
  const cached = cache.get(events);
  if (cached?.key === key) return cached.result;
  const result = events.filter(
    (event) =>
      matchesKind(event, filter) &&
      (!needle || event.author.toLowerCase().includes(needle) || event.text.toLowerCase().includes(needle) || event.giftDetails?.name.toLowerCase().includes(needle) || event.giftDetails?.giftId === needle),
  );
  cache.set(events, { key, result });
  return result;
}

export function windowEvents(
  events: readonly DisplayEvent[],
  options: { autoScroll: boolean; filter: EventFilter; query: string; limit: number },
): { visible: readonly DisplayEvent[]; windowed: boolean } {
  const windowed = options.autoScroll && options.filter === 'all' && !options.query.trim() && events.length > options.limit;
  return { visible: windowed ? events.slice(-options.limit) : events, windowed };
}
