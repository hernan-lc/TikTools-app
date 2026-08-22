import {
  SOCIAL_ACTION,
  label,
} from '../vendor/tiktok-signer/packages/tiktok-live/src/index.ts';
import type {
  ClientState,
  EventUser,
  LiveEvent,
} from '../vendor/tiktok-signer/packages/tiktok-live/src/index.ts';

import type { UiEvent } from './shared/messages.ts';

function userLabel(user: EventUser): string {
  const value = label(user);
  return value === 'unknown' ? 'viewer' : value.startsWith('@') ? value : '@' + value;
}

export function toUiEvent(event: LiveEvent): UiEvent | null {
  switch (event.type) {
    case 'chat':
      return {
        kind: 'chat',
        author: userLabel(event.user),
        text: event.comment || 'sent a message',
      };
    case 'gift':
      if (event.streakable && !event.repeatEnd) return null;
      return {
        kind: 'gift',
        author: userLabel(event.user),
        text: 'sent ' + Math.max(1, event.repeatCount) + '× ' + (event.giftName || 'a gift'),
      };
    case 'like':
      return {
        kind: 'like',
        author: userLabel(event.user),
        text: 'sent ' + Math.max(1, event.count) + ' like' + (event.count === 1 ? '' : 's'),
      };
    case 'member':
      return { kind: 'member', author: userLabel(event.user), text: 'joined the LIVE' };
    case 'social':
      return {
        kind: 'social',
        author: userLabel(event.user),
        text: event.action === SOCIAL_ACTION.follow ? 'followed the creator' : 'shared the LIVE',
      };
    case 'roomUser':
    case 'unknown':
      return null;
  }
}

export function roomTitle(state: ClientState): string {
  return state.roomInfo?.title || '@' + state.uniqueId;
}
