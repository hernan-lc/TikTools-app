import { WebviewRuntime } from 'webview-napi/runtime';

import { parsePageMessage } from './bridge.ts';
import { LiveController } from './live-controller.ts';
import { startWebServer } from './server.ts';
import type { HostMessage } from './shared/messages.ts';
import { startTray, type TrayController } from './tray.ts';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type AppServer = ReturnType<typeof startWebServer>;

export async function runApp(): Promise<void> {
  const webServer = startWebServer();
  try {
    await startNativeApp(webServer);
  } catch (error) {
    await Promise.resolve(webServer.stop());
    throw error;
  }
}

async function startNativeApp(webServer: AppServer): Promise<void> {
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
    url: webServer.url.href,
    enableDevtools: process.env.TIKTOK_LIVE_DEVTOOLS === '1',
  });

  await window.setCloseGuard(true);
  window.on('close-requested', () => {
    void window.setVisible(false);
  });

  let tray: TrayController | undefined;
  let shuttingDown = false;

  const send = (message: HostMessage): void => {
    void webview.send(JSON.stringify(message)).catch((error: unknown) => {
      if (!shuttingDown) console.error('WebView message failed:', errorMessage(error));
    });
  };
  const live = new LiveController(send);

  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    tray?.stop();
    tray = undefined;
    live.stop();
    try {
      await window.close();
    } catch {
      // The native window may already be gone.
    }
    await Promise.resolve(webServer.stop());
    try {
      await runtime.exit(0);
    } catch {
      // The runtime may already be exiting.
    }
    process.exit(0);
  };

  webview.on('ipc', (raw) => {
    const message = parsePageMessage(raw);
    if (!message) return;
    live.handlePageMessage(message);
  });

  try {
    const showWindow = (): void => {
      void window.setVisible(true);
      void window.focus();
    };
    tray = startTray({ onShow: showWindow, onQuit: () => void shutdown() });
  } catch (error) {
    console.warn('Tray icon unavailable; the WebView will still run:', errorMessage(error));
  }

  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}
