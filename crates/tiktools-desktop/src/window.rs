use std::{collections::VecDeque, sync::Arc};

use tiktools_core::{ipc::IpcRouter, AppCore};
use tokio::runtime::Handle;
use winit::{
    application::ApplicationHandler,
    dpi::{LogicalSize, PhysicalSize},
    event::WindowEvent,
    event_loop::{ActiveEventLoop, ControlFlow, EventLoopProxy},
    window::{Window, WindowId},
};
use wry::{
    dpi::{PhysicalPosition as WryPhysicalPosition, PhysicalSize as WryPhysicalSize},
    Rect, WebView, WebViewBuilder,
};

use crate::{
    event::{DesktopCommand, DesktopEvent},
    platform,
    tray::TrayController,
    webview::FrontendSource,
};

pub struct DesktopApp {
    window: Option<Window>,
    webview: Option<WebView>,
    core: Arc<AppCore>,
    router: Arc<IpcRouter>,
    frontend: FrontendSource,
    runtime: Handle,
    proxy: EventLoopProxy<DesktopEvent>,
    tray: Option<TrayController>,
    pending_host_messages: VecDeque<String>,
    shutting_down: bool,
}

impl DesktopApp {
    pub fn new(
        core: Arc<AppCore>,
        router: Arc<IpcRouter>,
        frontend: FrontendSource,
        runtime: Handle,
        proxy: EventLoopProxy<DesktopEvent>,
    ) -> Self {
        Self {
            window: None,
            webview: None,
            core,
            router,
            frontend,
            runtime,
            proxy,
            tray: None,
            pending_host_messages: VecDeque::new(),
            shutting_down: false,
        }
    }

    fn create_window(&mut self, event_loop: &ActiveEventLoop) -> Result<(), String> {
        let attributes = Window::default_attributes()
            .with_title("TikTools")
            .with_inner_size(LogicalSize::new(900_u32, 680_u32))
            .with_resizable(true)
            .with_visible(true);
        let window = event_loop
            .create_window(attributes)
            .map_err(|error| format!("could not create window: {error}"))?;

        let router = self.router.clone();
        let runtime = self.runtime.clone();
        let mut builder = WebViewBuilder::new()
            .with_devtools(cfg!(debug_assertions) || cfg!(feature = "devtools"))
            .with_focused(true)
            .with_autoplay(true)
            .with_ipc_handler(move |request| {
                let raw = request.body().clone();
                let router = router.clone();
                runtime.spawn(async move {
                    if let Err(error) = router.dispatch(&raw).await {
                        tracing::warn!(%error, "invalid WebView IPC message");
                    }
                });
            });

        // Wry's Linux/X11 child-window path converts logical default bounds
        // using the X11 screen millimeter dimensions. Some XWayland/KDE
        // sessions report those dimensions as zero, which produces an invalid
        // scale factor before the WebView is even attached. The window resize
        // event already gives us physical pixels, so keep this boundary
        // physical and avoid that conversion entirely.
        let initial_size = window.inner_size();
        builder = builder.with_bounds(Rect {
            position: WryPhysicalPosition::new(0, 0).into(),
            size: WryPhysicalSize::new(initial_size.width.max(1), initial_size.height.max(1))
                .into(),
        });

        if let Some(assets) = self.frontend.asset_server() {
            builder = builder.with_custom_protocol("tiktools".to_owned(), move |_id, request| {
                assets.respond(request)
            });
        }
        builder = builder.with_url(self.frontend.url().as_str());
        let webview = platform::build_webview(builder, &window)
            .map_err(|error| format!("could not create Wry WebView: {error}"))?;

        self.window = Some(window);
        self.webview = Some(webview);
        if self.tray.is_none() {
            match TrayController::create(self.proxy.clone()) {
                Ok(tray) => self.tray = Some(tray),
                Err(error) => {
                    tracing::warn!(%error, "system tray is unavailable; window remains usable")
                }
            }
        }
        self.flush_host_messages();
        Ok(())
    }

    fn flush_host_messages(&mut self) {
        while let Some(message) = self.pending_host_messages.pop_front() {
            self.emit_to_webview(message);
        }
    }

    fn emit_to_webview(&mut self, message: String) {
        let Some(webview) = self.webview.as_ref() else {
            self.pending_host_messages.push_back(message);
            return;
        };
        let argument = match serde_json::to_string(&message) {
            Ok(argument) => argument,
            Err(error) => {
                tracing::error!(%error, "could not encode host message for JavaScript");
                return;
            }
        };
        tracing::debug!(bytes = message.len(), "delivering host message to WebView");
        let script = format!(
            "if (typeof window.__webview_on_message__ === 'function') {{ window.__webview_on_message__({argument}); }} else {{ const queue = window.__tiktools_host_message_queue__ || (window.__tiktools_host_message_queue__ = []); if (queue.length < 512) queue.push({argument}); }}"
        );
        if let Err(error) = webview.evaluate_script(&script) {
            if !self.shutting_down {
                tracing::debug!(%error, "could not deliver host message to WebView");
            }
        }
    }

    fn resize_webview(&self, size: PhysicalSize<u32>) {
        let Some(webview) = self.webview.as_ref() else {
            return;
        };
        let bounds = Rect {
            position: WryPhysicalPosition::new(0, 0).into(),
            size: WryPhysicalSize::new(size.width.max(1), size.height.max(1)).into(),
        };
        if let Err(error) = webview.set_bounds(bounds) {
            tracing::debug!(%error, "could not resize WebView");
        }
    }

    fn set_window_visible(&self, visible: bool) {
        if let Some(webview) = self.webview.as_ref() {
            if let Err(error) = webview.set_visible(visible) {
                tracing::debug!(%error, visible, "could not change WebView visibility");
            }
        }
        if let Some(window) = self.window.as_ref() {
            window.set_visible(visible);
        }
    }

    fn shutdown(&mut self, _event_loop: &ActiveEventLoop) {
        if self.shutting_down {
            return;
        }
        self.shutting_down = true;
        let core = Arc::clone(&self.core);
        let proxy = self.proxy.clone();
        self.runtime.spawn(async move {
            core.shutdown().await;
            let _ = proxy.send_event(DesktopEvent::Command(DesktopCommand::ShutdownComplete));
        });
    }

    fn finalize_shutdown(&mut self, event_loop: &ActiveEventLoop) {
        self.tray.take();
        self.webview.take();
        self.window.take();
        event_loop.exit();
    }
}

impl ApplicationHandler<DesktopEvent> for DesktopApp {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        event_loop.set_control_flow(ControlFlow::Wait);
        if self.window.is_some() {
            return;
        }
        if let Err(error) = self.create_window(event_loop) {
            tracing::error!(%error, "Rust desktop host could not start");
            event_loop.exit();
        }
    }

    fn window_event(
        &mut self,
        _event_loop: &ActiveEventLoop,
        window_id: WindowId,
        event: WindowEvent,
    ) {
        if self
            .window
            .as_ref()
            .is_some_and(|window| window.id() != window_id)
        {
            return;
        }
        match event {
            WindowEvent::CloseRequested => {
                tracing::debug!("window close requested; hiding TikTools in the tray");
                self.set_window_visible(false);
            }
            WindowEvent::Resized(size) => self.resize_webview(size),
            WindowEvent::Destroyed => {
                tracing::debug!("window was destroyed; tray restore will recreate it");
                self.webview.take();
                self.window.take();
            }
            _ => {}
        }
    }

    fn user_event(&mut self, event_loop: &ActiveEventLoop, event: DesktopEvent) {
        match event {
            DesktopEvent::Command(DesktopCommand::EmitToWebview(message)) => {
                self.emit_to_webview(message)
            }
            DesktopEvent::Command(DesktopCommand::ShowWindow) => {
                if self.window.is_none() {
                    if let Err(error) = self.create_window(event_loop) {
                        tracing::error!(%error, "could not recreate TikTools window from tray");
                        return;
                    }
                }
                self.set_window_visible(true);
                if let Some(window) = self.window.as_ref() {
                    window.focus_window();
                }
            }
            DesktopEvent::Command(DesktopCommand::HideWindow) => {
                self.set_window_visible(false);
            }
            DesktopEvent::Command(DesktopCommand::Quit) => self.shutdown(event_loop),
            DesktopEvent::Command(DesktopCommand::ShutdownComplete) => {
                self.finalize_shutdown(event_loop)
            }
        }
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        platform::pump();
        platform::prepare_for_wait(event_loop);
    }
}
