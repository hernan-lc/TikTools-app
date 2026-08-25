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

import { createAppIconRgba } from './app-icon.ts';

export type TrayController = {
  stop: () => void;
};

function createTrayIcon(): Icon {
  const size = 32;
  return Icon.fromRgba(createAppIconRgba(size), size, size);
}

export function startTray(options: { onShow: () => void; onQuit: () => void }): TrayController {
  initialize();

  const menu = new Menu();
  menu.appendMenuItem(new MenuItemBuilder().withText('Show live chat').withId('show').build(), 'show');
  menu.appendMenuItem(new MenuItemBuilder().withText('Quit').withId('quit').build(), 'quit');

  const tray: TrayIcon = new TrayIconBuilder()
    .withIcon(createTrayIcon())
    .withTooltip('TikTok LIVE Inbox')
    .withMenu(menu)
    .build();
  const timer = setInterval(() => {
    update();
    const trayEvent = pollTrayEvents();
    if (trayEvent && trayEvent.button === 0 && trayEvent.buttonState === 0) options.onShow();

    const menuEvent = pollMenuEvents();
    if (menuEvent?.id === 'show') options.onShow();
    if (menuEvent?.id === 'quit') options.onQuit();
  }, 25);

  return {
    stop: () => {
      clearInterval(timer);
      tray.setVisible(false);
    },
  };
}
