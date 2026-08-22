import {
  bootstrapGuestSession,
  Discovery,
  TikTokLive,
} from '../vendor/tiktok-signer/packages/tiktok-live/src/index.ts';
import type {
  ClientState,
  LiveEvent,
} from '../vendor/tiktok-signer/packages/tiktok-live/src/index.ts';

import { roomTitle, toUiEvent } from './live-events.ts';
import type { HostMessage, PageMessage } from './shared/messages.ts';

type SendHostMessage = (message: HostMessage) => void;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class LiveController {
  #live: TikTokLive | null = null;
  #generation = 0;

  constructor(private readonly send: SendHostMessage) {}

  stop(): void {
    this.#generation += 1;
    this.#live?.disconnect();
    this.#live = null;
    this.send({ type: 'connection', status: 'disconnected' });
  }

  async connect(request: Extract<PageMessage, { type: 'connect' }>): Promise<void> {
    const uniqueId = request.uniqueId.trim();
    const sessionCookie = request.sessionCookie.trim();
    const generation = ++this.#generation;

    this.#live?.disconnect();
    this.#live = null;

    if (!uniqueId) {
      this.send({ type: 'error', phase: 'connect', message: 'Enter a creator handle.' });
      return;
    }

    const client = new TikTokLive(uniqueId, {
      sessionCookie,
      roomId: request.roomId,
      fetchGifts: false,
      fetchRoomInfo: true,
      reconnect: { attempts: 5, initialMs: 2_000, maxMs: 30_000 },
    });
    this.#live = client;
    this.send({ type: 'connection', status: 'connecting', uniqueId });

    client.on('connected', (state: ClientState) => {
      if (generation !== this.#generation) return;
      this.send({
        type: 'connection',
        status: 'connected',
        uniqueId: state.uniqueId,
        title: roomTitle(state),
      });
    });

    client.on('event', (event: LiveEvent) => {
      if (generation !== this.#generation) return;
      const uiEvent = toUiEvent(event);
      if (uiEvent) this.send({ type: 'live-event', event: uiEvent });
    });

    client.on('reconnecting', ({ attempt, delayMs }) => {
      if (generation === this.#generation) this.send({ type: 'reconnecting', attempt, delayMs });
    });

    client.on('disconnected', () => {
      if (generation === this.#generation) {
        this.send({ type: 'connection', status: 'disconnected' });
      }
    });

    client.on('error', (error) => {
      if (generation === this.#generation && client.connected) {
        this.send({ type: 'error', phase: 'live', message: error.message });
      }
    });

    try {
      await client.connect();
    } catch (error) {
      if (generation === this.#generation) {
        this.send({ type: 'error', phase: 'connect', message: errorMessage(error) });
      }
      client.disconnect();
      if (this.#live === client) this.#live = null;
    }
  }

  async pickAndConnect(request: Extract<PageMessage, { type: 'pick-live' }>): Promise<void> {
    try {
      const sessionCookie = request.sessionCookie.trim() || (await bootstrapGuestSession()).cookie;
      const rooms = await new Discovery({ cookie: sessionCookie }).liveChannels('live');
      if (rooms.length === 0) throw new Error('No live rooms were returned by TikTok.');

      const room = rooms[Math.floor(Math.random() * rooms.length)];
      if (!room) throw new Error('TikTok returned an invalid live-room result.');

      this.send({
        type: 'connection',
        status: 'connecting',
        uniqueId: room.uniqueId,
        title: room.title || '@' + room.uniqueId,
      });
      await this.connect({
        type: 'connect',
        uniqueId: room.uniqueId,
        roomId: room.roomId,
        sessionCookie,
      });
    } catch (error) {
      this.send({ type: 'error', phase: 'connect', message: errorMessage(error) });
    }
  }
}
