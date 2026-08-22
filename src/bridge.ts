import type { PageMessage } from './shared/messages.ts';

export function parsePageMessage(raw: string): PageMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!value || typeof value !== 'object') return null;
  const message = value as Record<string, unknown>;

  if (message.type === 'disconnect') return { type: 'disconnect' };
  if (
    message.type === 'connect' &&
    typeof message.uniqueId === 'string' &&
    typeof message.sessionCookie === 'string'
  ) {
    return {
      type: 'connect',
      uniqueId: message.uniqueId,
      sessionCookie: message.sessionCookie,
    };
  }
  if (message.type === 'pick-live' && typeof message.sessionCookie === 'string') {
    return { type: 'pick-live', sessionCookie: message.sessionCookie };
  }

  return null;
}
