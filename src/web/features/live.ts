import { ref } from 'vue';

import type { GiftCatalogEntry, UiEvent } from '../../shared/messages.ts';
import type { ControlClient } from '../platform/control-client.ts';
import { errorMessage } from '../platform/control-client.ts';
import type { DisplayEvent, EventFilter, TopViewerPayload } from '../types.ts';

export interface LiveCallbacks {
  /** Optional chat observer (auto-speech left the main frontend). */
  onChat?: (
    author: string,
    text: string,
    points: number | undefined,
    isSubscriber: boolean | undefined,
  ) => void;
  systemAuthor: () => string;
}

export interface GiftCatalogResult {
  gifts: GiftCatalogEntry[];
}

/** Live feed: events, room stats, gift catalog, and scroll state. */

/**
 * Replay guard. TikTok re-sends recent messages as history when the
 * connection drops and rejoins, so the same event can arrive twice.
 * Live events carry the backend's `msgId` (stable per TikTok message);
 * synthetic events without one fall back to a content checksum with a
 * short time window. Both caches are bounded, and intentionally survive
 * `resetEvents` — a reconnect replay must not re-trigger events the
 * feed already showed before the disconnect.
 */
const DEDUP_WINDOW_MS = 5000;
const DEDUP_CACHE_LIMIT = 256;
const seenMsgIds = new Map<string, number>();
const seenChecksums = new Map<string, number>();

function eventChecksum(event: UiEvent): string {
  const gift = event.giftDetails;
  return [
    event.kind,
    event.author,
    event.text,
    event.likeCount ?? '',
    gift ? `${gift.name}:${gift.count}:${gift.diamonds}` : '',
  ].join('|');
}

/** Records the event identity and reports whether it was already seen. */
function isDuplicateEvent(event: UiEvent, now: number): boolean {
  const msgId = event.msgId;
  if (msgId !== undefined) {
    if (seenMsgIds.has(msgId)) return true;
    seenMsgIds.set(msgId, now);
    if (seenMsgIds.size > DEDUP_CACHE_LIMIT) {
      const oldest = seenMsgIds.keys().next().value;
      if (oldest !== undefined) seenMsgIds.delete(oldest);
    }
    return false;
  }
  const checksum = eventChecksum(event);
  const firstSeen = seenChecksums.get(checksum);
  if (firstSeen !== undefined && now - firstSeen < DEDUP_WINDOW_MS) return true;
  seenChecksums.set(checksum, now);
  if (seenChecksums.size > DEDUP_CACHE_LIMIT) {
    const oldest = seenChecksums.keys().next().value;
    if (oldest !== undefined) seenChecksums.delete(oldest);
  }
  return false;
}

export function useLive(control: ControlClient, callbacks: LiveCallbacks) {
  const events = ref<DisplayEvent[]>([]);
  const filter = ref<EventFilter>('all');
  const searchQuery = ref('');
  const topViewers = ref<TopViewerPayload[]>([]);
  const liveViewers = ref(0);
  const giftCatalog = ref<GiftCatalogEntry[]>([]);
  const autoScroll = ref(true);
  const unreadCount = ref(0);
  const nextEventId = ref(0);
  const streamContainerRef = ref<HTMLDivElement | null>(null);

  const resetEvents = (): void => {
    nextEventId.value = 0;
    events.value = [];
    unreadCount.value = 0;
    topViewers.value = [];
    liveViewers.value = 0;
  };

  const scrollToBottom = (): void => {
    const container = streamContainerRef.value;
    if (container) container.scrollTop = container.scrollHeight;
  };

  // Live feed state arrives only via authoritative domain topics; the
  // legacy `live-event` / `room-stats` / `gift-catalog` pushes are no
  // longer subscribed (backend keeps them solely for compatibility).
  control.onTopic<{ event: UiEvent }>('live.ui-event', (data) => {
    const event = data.event;
    // Drop replays before they reach the feed: a reconnect
    // replay must not re-render, count as unread, or re-fire
    // the chat observer.
    if (isDuplicateEvent(event, Date.now())) return;
    events.value = [
      ...events.value,
      { ...event, id: nextEventId.value++, receivedAt: Date.now() },
    ].slice(-300);
    if (!autoScroll.value) unreadCount.value += 1;
    if (event.kind === 'chat' && event.text) {
      callbacks.onChat?.(event.author, event.text, event.points, event.isSubscriber);
    }
  });
  control.onTopic<{ viewers: number; totalUsers: number; topViewers: TopViewerPayload[] }>(
    'room.stats',
    (data) => {
      topViewers.value = data.topViewers;
      liveViewers.value = data.viewers;
    },
  );
  control.onTopic<{ gifts: GiftCatalogEntry[] }>('gifts.catalog', (data) => {
    giftCatalog.value = data.gifts;
  });
  control.onTopic<{ phase: string; message: string }>('live.error', (data) => {
    events.value = [
      ...events.value,
      {
        kind: 'member' as const,
        author: callbacks.systemAuthor(),
        text: data.message,
        id: nextEventId.value++,
        receivedAt: Date.now(),
      },
    ].slice(-300);
  });

  const refresh = async (): Promise<void> => {
    try {
      const result = await control.call<GiftCatalogResult>('gifts.list', {});
      giftCatalog.value = result.gifts;
    } catch (failure) {
      console.warn(`gifts.list failed: ${errorMessage(failure)}`);
    }
  };

  const handleToggleAutoScroll = (): void => {
    const nextState = !autoScroll.value;
    autoScroll.value = nextState;
    if (nextState) {
      unreadCount.value = 0;
      scrollToBottom();
    }
  };

  const setFilter = (value: EventFilter): void => {
    filter.value = value;
  };
  const setSearchQuery = (value: string): void => {
    searchQuery.value = value;
  };
  const setStreamContainerRef = (element: Element | null): void => {
    streamContainerRef.value = element instanceof HTMLDivElement ? element : null;
  };

  return {
    events,
    filter,
    searchQuery,
    topViewers,
    liveViewers,
    giftCatalog,
    autoScroll,
    unreadCount,
    streamContainerRef,
    resetEvents,
    scrollToBottom,
    handleToggleAutoScroll,
    setFilter,
    setSearchQuery,
    setStreamContainerRef,
    refresh,
  };
}
