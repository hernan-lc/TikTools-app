use tray_icon::{
    menu::{Menu, MenuEvent, MenuItem},
    Icon, TrayIcon, TrayIconBuilder,
};
#[cfg(not(target_os = "linux"))]
use tray_icon::{MouseButton, MouseButtonState, TrayIconEvent};
use winit::event_loop::EventLoopProxy;

use crate::{
    event::{DesktopCommand, DesktopEvent},
    icon,
};

pub struct TrayController {
    _icon: TrayIcon,
}

impl Drop for TrayController {
    fn drop(&mut self) {
        // tray-icon dispatches these callbacks globally. Clear them whenever
        // the one active tray is destroyed so a later recreation cannot leave
        // a callback holding an old event-loop proxy alive.
        #[cfg(not(target_os = "linux"))]
        TrayIconEvent::set_event_handler(None::<fn(TrayIconEvent)>);
        MenuEvent::set_event_handler(None::<fn(MenuEvent)>);
    }
}

impl TrayController {
    pub fn create(proxy: EventLoopProxy<DesktopEvent>) -> Result<Self, Box<dyn std::error::Error>> {
        let menu = Menu::new();
        let show = MenuItem::with_id("show", "Show TikTools", true, None);
        let quit = MenuItem::with_id("quit", "Quit", true, None);
        menu.append(&show)?;
        // The inspector is only offered when it can actually open (debug
        // builds or the `devtools` cargo feature); release menus stay clean.
        let devtools_id = if cfg!(debug_assertions) || cfg!(feature = "devtools") {
            let devtools = MenuItem::with_id("devtools", "Open Developer Tools", true, None);
            menu.append(&devtools)?;
            Some(devtools.id().clone())
        } else {
            None
        };
        menu.append(&quit)?;
        let show_id = show.id().clone();
        let quit_id = quit.id().clone();

        let icon = TrayIconBuilder::new()
            .with_icon(Icon::from_rgba(icon::rgba(), icon::SIZE, icon::SIZE)?)
            .with_tooltip("TikTools")
            .with_menu(Box::new(menu))
            .build()?;

        // The AppIndicator backend used by tray-icon on Linux does not emit
        // TrayIconEvent click notifications. Keep the native click handler on
        // platforms that support it and use the menu event for Linux.
        #[cfg(not(target_os = "linux"))]
        {
            let tray_id = icon.id().clone();
            let click_proxy = proxy.clone();
            TrayIconEvent::set_event_handler(Some(move |event| {
                if let TrayIconEvent::Click {
                    id,
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    if id == tray_id {
                        send_command(&click_proxy, DesktopCommand::ShowWindow, "tray click");
                    }
                }
            }));
        }

        let menu_proxy = proxy;
        MenuEvent::set_event_handler(Some(move |event: MenuEvent| {
            tracing::debug!(id = ?event.id(), "system tray menu event");
            let command = if event.id() == &show_id {
                Some(DesktopCommand::ShowWindow)
            } else if Some(event.id()) == devtools_id.as_ref() {
                Some(DesktopCommand::OpenDevtools)
            } else if event.id() == &quit_id {
                Some(DesktopCommand::Quit)
            } else {
                None
            };
            if let Some(command) = command {
                send_command(&menu_proxy, command, "tray menu");
            }
        }));

        Ok(Self { _icon: icon })
    }
}

fn send_command(
    proxy: &EventLoopProxy<DesktopEvent>,
    command: DesktopCommand,
    source: &'static str,
) {
    if let Err(error) = proxy.send_event(DesktopEvent::Command(command)) {
        tracing::debug!(%error, source, "could not forward system tray command");
    }
}
