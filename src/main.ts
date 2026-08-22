import { WebviewRuntime } from 'webview-napi/runtime';
import {
  Icon,
  Menu,
  MenuItemBuilder,
  TrayIconBuilder,
  type TrayIcon,
  initialize,
  pollMenuEvents,
  pollTrayEvents,
  update,
} from 'tray-icon-node';
import {
  bootstrapGuestSession,
  Discovery,
  SOCIAL_ACTION,
  TikTokLive,
  label,
} from '../vendor/tiktok-signer/packages/tiktok-live/src/index.ts';
import type {
  ClientState,
  EventUser,
  LiveEvent,
} from '../vendor/tiktok-signer/packages/tiktok-live/src/index.ts';

import { WIZARD_HTML } from './ui.ts';

type PageMessage =
  | { type: 'connect'; uniqueId: string; sessionCookie: string; roomId?: string }
  | { type: 'pick-live'; sessionCookie: string }
  | { type: 'disconnect' };

type HostMessage =
  | {
      type: 'connection';
      status: 'connecting' | 'connected' | 'disconnected';
      uniqueId?: string;
      title?: string;
    }
  | { type: 'live-event'; event: UiEvent }
  | { type: 'reconnecting'; attempt: number; delayMs: number }
  | { type: 'error'; phase: 'connect' | 'live'; message: string };

type UiEvent = {
  kind: 'chat' | 'gift' | 'like' | 'member' | 'social';
  author: string;
  text: string;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parsePageMessage(raw: string): PageMessage | null {
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

function userLabel(user: EventUser): string {
  const value = label(user);
  return value === 'unknown' ? 'viewer' : value.startsWith('@') ? value : '@' + value;
}

function toUiEvent(event: LiveEvent): UiEvent | null {
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

function roomTitle(state: ClientState): string {
  return state.roomInfo?.title || '@' + state.uniqueId;
}

function createTrayIcon(): Icon {
  const size = 16;
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x - 7.5, y - 7.5);
      const inside = distance < 6.8;
      const highlight = distance < 4.1;
      const offset = (y * size + x) * 4;
      pixels[offset] = highlight ? 255 : 33;
      pixels[offset + 1] = highlight ? 79 : 212;
      pixels[offset + 2] = highlight ? 145 : 232;
      pixels[offset + 3] = inside ? 255 : 0;
    }
  }
  return Icon.fromRgba(pixels, size, size);
}

export async function runApp(): Promise<void> {
  const runtime = await WebviewRuntime.start({
    mode: 'embedded',
    keepAlive: true,
    exitOnLastWindowClosed: false,
  });
  const window = await runtime.createWindow({
    title: 'TikTok LIVE Inbox',
    width: 900,
    height: 680,
    resizable: true,
    visible: true,
    decorations: true,
    focused: true,
  });
  const webview = await window.createWebview({
    html: WIZARD_HTML,
    enableDevtools: process.env.TIKTOK_LIVE_DEVTOOLS === '1',
  });

  await window.setCloseGuard(true);
  window.on('close-requested', () => {
    void window.setVisible(false);
  });

  let live: TikTokLive | null = null;
  let connectionGeneration = 0;
  let shuttingDown = false;
  let trayTimer: ReturnType<typeof setInterval> | undefined;
  let activeTray: TrayIcon | undefined;

  const send = (message: HostMessage): void => {
    void webview.send(JSON.stringify(message)).catch((error: unknown) => {
      if (!shuttingDown) console.error('WebView message failed:', errorMessage(error));
    });
  };

  const stopLive = (): void => {
    connectionGeneration += 1;
    live?.disconnect();
    live = null;
    send({ type: 'connection', status: 'disconnected' });
  };

  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (trayTimer) clearInterval(trayTimer);
    activeTray?.setVisible(false);
    stopLive();
    try {
      await window.close();
    } catch {
      // The native window may already be gone.
    }
    try {
      await runtime.exit(0);
    } catch {
      // The runtime may already be exiting.
    }
    process.exit(0);
  };

  const connectToLive = async (request: Extract<PageMessage, { type: 'connect' }>): Promise<void> => {
    const uniqueId = request.uniqueId.trim();
    const sessionCookie = request.sessionCookie.trim();
    const generation = ++connectionGeneration;

    live?.disconnect();
    live = null;

    if (!uniqueId) {
      send({ type: 'error', phase: 'connect', message: 'Enter a creator handle.' });
      return;
    }
    const client = new TikTokLive(uniqueId, {
      sessionCookie,
      roomId: request.roomId,
      fetchGifts: false,
      fetchRoomInfo: true,
      reconnect: { attempts: 5, initialMs: 2_000, maxMs: 30_000 },
    });
    live = client;
    send({ type: 'connection', status: 'connecting', uniqueId });

    client.on('connected', (state) => {
      if (generation !== connectionGeneration) return;
      send({
        type: 'connection',
        status: 'connected',
        uniqueId: state.uniqueId,
        title: roomTitle(state),
      });
    });

    client.on('event', (event) => {
      if (generation !== connectionGeneration) return;
      const uiEvent = toUiEvent(event);
      if (uiEvent) send({ type: 'live-event', event: uiEvent });
    });

    client.on('reconnecting', ({ attempt, delayMs }) => {
      if (generation === connectionGeneration) send({ type: 'reconnecting', attempt, delayMs });
    });

    client.on('disconnected', () => {
      if (generation === connectionGeneration) send({ type: 'connection', status: 'disconnected' });
    });

    client.on('error', (error) => {
      if (generation === connectionGeneration && client.connected) {
        send({ type: 'error', phase: 'live', message: error.message });
      }
    });

    try {
      await client.connect();
    } catch (error) {
      if (generation === connectionGeneration) {
        send({ type: 'error', phase: 'connect', message: errorMessage(error) });
      }
      client.disconnect();
      if (live === client) live = null;
    }
  };

  const pickAndConnectToLive = async (
    request: Extract<PageMessage, { type: 'pick-live' }>,
  ): Promise<void> => {
    try {
      const sessionCookie = request.sessionCookie.trim() || (await bootstrapGuestSession()).cookie;
      const rooms = await new Discovery({ cookie: sessionCookie }).liveChannels('live');
      if (rooms.length === 0) throw new Error('No live rooms were returned by TikTok.');
      const room = rooms[Math.floor(Math.random() * rooms.length)];
      if (!room) throw new Error('TikTok returned an invalid live-room result.');
      send({
        type: 'connection',
        status: 'connecting',
        uniqueId: room.uniqueId,
        title: room.title || '@' + room.uniqueId,
      });
      await connectToLive({
        type: 'connect',
        uniqueId: room.uniqueId,
        roomId: room.roomId,
        sessionCookie,
      });
    } catch (error) {
      send({ type: 'error', phase: 'connect', message: errorMessage(error) });
    }
  };

  webview.on('ipc', (raw) => {
    const message = parsePageMessage(raw);
    if (!message) return;
    if (message.type === 'disconnect') {
      stopLive();
    } else if (message.type === 'pick-live') {
      void pickAndConnectToLive(message);
    } else {
      void connectToLive(message);
    }
  });

  try {
    initialize();
    const menu = new Menu();
    menu.appendMenuItem(new MenuItemBuilder().withText('Show live chat').withId('show').build(), 'show');
    menu.appendMenuItem(new MenuItemBuilder().withText('Quit').withId('quit').build(), 'quit');
    activeTray = new TrayIconBuilder()
      .withIcon(createTrayIcon())
      .withTooltip('TikTok LIVE Inbox')
      .withMenu(menu)
      .build();

    const showWindow = (): void => {
      void window.setVisible(true);
      void window.focus();
    };

    trayTimer = setInterval(() => {
      update();
      const trayEvent = pollTrayEvents();
      if (trayEvent && trayEvent.button === 0 && trayEvent.buttonState === 0) showWindow();
      const menuEvent = pollMenuEvents();
      if (menuEvent?.id === 'show') showWindow();
      if (menuEvent?.id === 'quit') void shutdown();
    }, 25);
  } catch (error) {
    console.warn('Tray icon unavailable; the WebView will still run:', errorMessage(error));
  }

  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}
