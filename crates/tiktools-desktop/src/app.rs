use std::{collections::VecDeque, env, sync::Arc};

use tiktools_core::{ipc::IpcRouter, AppCore};
use tokio::runtime::{Builder, Handle};
use winit::{
    application::ApplicationHandler,
    dpi::{LogicalSize, PhysicalSize},
    event::WindowEvent,
    event_loop::{ActiveEventLoop, ControlFlow, EventLoop, EventLoopProxy},
    window::{Window, WindowId},
};
use wry::{
    dpi::{LogicalPosition, LogicalSize as WryLogicalSize},
    Rect, WebView, WebViewBuilder,
};

use crate::{
    event::{DesktopCommand, DesktopEvent},
    platform,
    tray::TrayController,
    webview::FrontendSource,
};

pub fn run() -> Result<(), Box<dyn std::error::Error>> {
    if let Some(archive) = install_plugin_argument()? {
        return install_plugin(archive, replace_plugin_argument());
    }
    platform::initialize()?;
    let runtime = Builder::new_multi_thread().enable_all().build()?;
    let mut event_loop_builder = EventLoop::<DesktopEvent>::with_user_event();
    platform::configure_event_loop(&mut event_loop_builder);
    let event_loop = event_loop_builder.build()?;
    let proxy = event_loop.create_proxy();
    let emitter = crate::event::shared_emitter(proxy.clone());
    let core = Arc::new(AppCore::new(emitter));
    let router = Arc::new(IpcRouter::new(core.clone()));
    let source = FrontendSource::from_environment()
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error))?;
    let mut app = DesktopApp::new(core, router, source, runtime.handle().clone(), proxy);
    event_loop.run_app(&mut app)?;
    Ok(())
}

fn install_plugin_argument() -> Result<Option<std::path::PathBuf>, Box<dyn std::error::Error>> {
    let mut args = env::args().skip(1);
    while let Some(argument) = args.next() {
        if argument == "--install-plugin" {
            let archive = args.next().ok_or_else(|| {
                std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "--install-plugin requires a .plugin path",
                )
            })?;
            return Ok(Some(archive.into()));
        }
    }
    Ok(None)
}

fn replace_plugin_argument() -> bool {
    env::args().any(|argument| argument == "--replace")
}

#[cfg(feature = "plugin-install")]
fn install_plugin(
    archive: std::path::PathBuf,
    replace_existing: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    struct NullEmitter;
    impl tiktools_core::HostEmitter for NullEmitter {
        fn emit(&self, _message: tiktools_core::ipc::messages::HostMessage) {}
    }

    let core = AppCore::new(Arc::new(NullEmitter));
    let installed = core.install_plugin(archive, replace_existing)?;
    println!(
        "Installed {}@{} in {}",
        installed.manifest.id,
        installed.manifest.version,
        installed.directory.display()
    );
    Ok(())
}

#[cfg(not(feature = "plugin-install"))]
fn install_plugin(
    _archive: std::path::PathBuf,
    _replace_existing: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Other,
        "plugin installation was disabled in this build",
    )
    .into())
}

struct DesktopApp {
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
    fn new(
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
        match TrayController::create(self.proxy.clone()) {
            Ok(tray) => self.tray = Some(tray),
            Err(error) => {
                tracing::warn!(%error, "system tray is unavailable; window remains usable")
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
        let script = format!(
            "if (typeof window.__webview_on_message__ === 'function') {{ window.__webview_on_message__({argument}); }}"
        );
        if let Err(error) = webview.evaluate_script(&script) {
            if !self.shutting_down {
                tracing::debug!(%error, "could not deliver host message to WebView");
            }
        }
    }

    fn resize_webview(&self, size: PhysicalSize<u32>) {
        let (Some(window), Some(webview)) = (self.window.as_ref(), self.webview.as_ref()) else {
            return;
        };
        let logical = size.to_logical::<f64>(window.scale_factor());
        let bounds = Rect {
            position: LogicalPosition::new(0.0, 0.0).into(),
            size: WryLogicalSize::new(logical.width, logical.height).into(),
        };
        if let Err(error) = webview.set_bounds(bounds) {
            tracing::debug!(%error, "could not resize WebView");
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
                if let Some(window) = self.window.as_ref() {
                    window.set_visible(false);
                }
            }
            WindowEvent::Resized(size) => self.resize_webview(size),
            _ => {}
        }
    }

    fn user_event(&mut self, event_loop: &ActiveEventLoop, event: DesktopEvent) {
        match event {
            DesktopEvent::Command(DesktopCommand::EmitToWebview(message)) => {
                self.emit_to_webview(message)
            }
            DesktopEvent::Command(DesktopCommand::ShowWindow) => {
                if let Some(window) = self.window.as_ref() {
                    window.set_visible(true);
                    window.focus_window();
                }
            }
            DesktopEvent::Command(DesktopCommand::HideWindow) => {
                if let Some(window) = self.window.as_ref() {
                    window.set_visible(false);
                }
            }
            DesktopEvent::Command(DesktopCommand::Quit) => self.shutdown(event_loop),
            DesktopEvent::Command(DesktopCommand::ShutdownComplete) => {
                self.finalize_shutdown(event_loop)
            }
        }
    }

    fn about_to_wait(&mut self, _event_loop: &ActiveEventLoop) {
        platform::pump();
    }
}
