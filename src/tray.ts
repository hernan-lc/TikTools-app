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

export type TrayController = {
  stop: () => void;
};

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
