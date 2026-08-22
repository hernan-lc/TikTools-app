import {
  bootstrapGuestSession,
  Discovery,
  SOCIAL_ACTION,
  TikTokLive,
} from '../vendor/tiktok-signer/packages/tiktok-live/src/index.ts';
import type {
  ClientState,
  LiveEvent,
} from '../vendor/tiktok-signer/packages/tiktok-live/src/index.ts';

import { PointsDatabase } from './db/points-db.ts';
import {
  hasUser,
  isChatEvent,
  isGiftEvent,
  isLikeEvent,
  isMemberEvent,
  isSocialEvent,
  roomTitle,
  toUiEvent,
} from './live-events.ts';
import type { HostMessage, PageMessage } from './shared/messages.ts';

type SendHostMessage = (message: HostMessage) => void;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class LiveController {
  #live: TikTokLive | null = null;
  #generation = 0;
  readonly pointsDb: PointsDatabase;

  constructor(private readonly send: SendHostMessage) {
    this.pointsDb = new PointsDatabase();
  }

  stop(): void {
    this.#generation += 1;
    this.#live?.disconnect();
    this.#live = null;
    this.send({ type: 'connection', status: 'disconnected' });
  }

  public handlePageMessage(message: PageMessage): void {
    switch (message.type) {
      case 'disconnect':
        this.stop();
        break;
      case 'connect':
        void this.connect(message);
        break;
      case 'pick-live':
        void this.pickAndConnect(message);
        break;
      case 'get-points-config':
        this.send({
          type: 'points-config',
          config: this.pointsDb.getConfig(),
        });
        break;
      case 'update-points-config': {
        const updated = this.pointsDb.updateConfig(message.config);
        this.send({
          type: 'points-config',
          config: updated,
        });
        break;
      }
      case 'get-leaderboard': {
        const viewers = this.pointsDb.getLeaderboard(message.limit || 100);
        this.send({
          type: 'leaderboard',
          viewers,
        });
        break;
      }
      case 'reset-points': {
        this.pointsDb.resetPoints(message.uniqueId);
        const viewers = this.pointsDb.getLeaderboard(100);
        this.send({
          type: 'leaderboard',
          viewers,
        });
        break;
      }
      case 'adjust-points': {
        const res = this.pointsDb.awardPoints(message.uniqueId, 'manual', {
          customAmount: message.delta,
        });
        if (res) {
          this.send({
            type: 'points-awarded',
            uniqueId: res.uniqueId,
            delta: res.delta,
            totalPoints: res.totalPoints,
            level: res.level,
          });
        }
        const viewers = this.pointsDb.getLeaderboard(100);
        this.send({
          type: 'leaderboard',
          viewers,
        });
        break;
      }
    }
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
      // Send initial points config and leaderboard upon connection
      this.send({
        type: 'points-config',
        config: this.pointsDb.getConfig(),
      });
      this.send({
        type: 'leaderboard',
        viewers: this.pointsDb.getLeaderboard(50),
      });
    });

    client.on('event', (event: LiveEvent) => {
      if (generation !== this.#generation) return;
      const uiEvent = toUiEvent(event);
      if (!uiEvent) return;

      // Process points in SQLite — all branches use type-guard narrowing, no `any` casts.
      let pointsResult = null;
      const baseOpts = {
        nickname: uiEvent.nickname,
        avatarUrl: uiEvent.avatarUrl,
        userId: hasUser(event) ? event.user.userId : undefined,
      };
      if (isChatEvent(event)) {
        pointsResult = this.pointsDb.awardPoints(uiEvent.author, 'chat', baseOpts);
      } else if (isGiftEvent(event)) {
        // event.diamondCount / repeatCount / comboCount are all `number` after narrowing
        const diamonds = event.diamondCount || 1;
        const repeat = Math.max(1, event.repeatCount || event.comboCount || 1);
        pointsResult = this.pointsDb.awardPoints(uiEvent.author, 'gift', {
          ...baseOpts,
          diamondCount: diamonds * repeat,
        });
      } else if (isLikeEvent(event)) {
        // event.count is `number` after narrowing
        const count = Math.max(1, event.count || 1);
        pointsResult = this.pointsDb.awardPoints(uiEvent.author, 'like', {
          ...baseOpts,
          count,
        });
      } else if (isSocialEvent(event)) {
        // event.action is `number` after narrowing
        const isFollow = event.action === SOCIAL_ACTION.follow;
        pointsResult = this.pointsDb.awardPoints(uiEvent.author, isFollow ? 'follow' : 'share', baseOpts);
      } else if (isMemberEvent(event)) {
        pointsResult = this.pointsDb.awardPoints(uiEvent.author, 'join', baseOpts);
      }

      if (pointsResult) {
        uiEvent.points = pointsResult.totalPoints;
        uiEvent.level = pointsResult.level;
        uiEvent.pointsDelta = pointsResult.delta;
      } else {
        const viewer = this.pointsDb.getViewer(uiEvent.author);
        if (viewer) {
          uiEvent.points = viewer.points;
          uiEvent.level = viewer.level;
        }
      }

      this.send({ type: 'live-event', event: uiEvent });
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
