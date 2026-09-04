use tray_icon::{
    menu::{Menu, MenuEvent, MenuItem},
    Icon, MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent,
};
use winit::event_loop::EventLoopProxy;

use crate::event::{DesktopCommand, DesktopEvent};

pub struct TrayController {
    _icon: TrayIcon,
}

impl TrayController {
    pub fn create(proxy: EventLoopProxy<DesktopEvent>) -> Result<Self, Box<dyn std::error::Error>> {
        let menu = Menu::new();
        let show = MenuItem::with_id("show", "Show TikTools", true, None);
        let quit = MenuItem::with_id("quit", "Quit", true, None);
        menu.append(&show)?;
        menu.append(&quit)?;
        let show_id = show.id().clone();
        let quit_id = quit.id().clone();

        let icon = TrayIconBuilder::new()
            .with_icon(Icon::from_rgba(icon_rgba(), 32, 32)?)
            .with_tooltip("TikTools")
            .with_menu(Box::new(menu))
            .build()?;
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
                    let _ =
                        click_proxy.send_event(DesktopEvent::Command(DesktopCommand::ShowWindow));
                }
            }
        }));

        let menu_proxy = proxy;
        MenuEvent::set_event_handler(Some(move |event: MenuEvent| {
            let command = if event.id() == &show_id {
                Some(DesktopCommand::ShowWindow)
            } else if event.id() == &quit_id {
                Some(DesktopCommand::Quit)
            } else {
                None
            };
            if let Some(command) = command {
                let _ = menu_proxy.send_event(DesktopEvent::Command(command));
            }
        }));

        Ok(Self { _icon: icon })
    }
}

fn icon_rgba() -> Vec<u8> {
    let mut pixels = vec![0_u8; 32 * 32 * 4];
    for y in 0..32 {
        for x in 0..32 {
            let offset = (y * 32 + x) * 4;
            let dx = x as f32 - 15.5;
            let dy = y as f32 - 15.5;
            if dx * dx + dy * dy > 14.5 * 14.5 {
                continue;
            }
            let amount = (x + y) as f32 / 62.0;
            pixels[offset] = (254.0 - 80.0 * amount) as u8;
            pixels[offset + 1] = (44.0 + 200.0 * amount) as u8;
            pixels[offset + 2] = (85.0 + 150.0 * amount) as u8;
            pixels[offset + 3] = 255;
            if (9..=22).contains(&x) && (9..=20).contains(&y) {
                pixels[offset] = 255;
                pixels[offset + 1] = 255;
                pixels[offset + 2] = 255;
            }
        }
    }
    pixels
}
