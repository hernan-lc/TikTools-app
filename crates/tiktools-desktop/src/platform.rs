//! Small platform seam for UI-thread initialization and WebView event-loop
//! maintenance. Platform conditionals stay here instead of spreading through
//! the core or IPC layers.

use winit::{event_loop::EventLoopBuilder, window::Window};
use wry::{WebView, WebViewBuilder};

pub fn initialize() -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(target_os = "linux")]
    {
        // WebKitGTK/GLX can emit GLXBadWindow while Winit is processing a
        // focus transition. Winit otherwise reports that queued Xlib error at
        // the next IME operation and panics. This is the supported Winit hook
        // for Xlib users such as WebKitGTK and matches Wry's Linux example.
        winit::platform::x11::register_xlib_error_hook(Box::new(|_display, error| {
            let error = error as *mut x11_dl::xlib::XErrorEvent;
            unsafe { (*error).error_code == 170 }
        }));

        // Wry's child-window backend is X11-only. When a desktop exposes both
        // Wayland and X11/XWayland, select the same backend for GTK and Winit
        // so the raw handles remain compatible. Native Wayland needs the
        // GTK-container path kept behind this platform seam.
        if std::env::var_os("DISPLAY").is_some()
            && std::env::var_os("WAYLAND_DISPLAY").is_some()
            && std::env::var_os("GDK_BACKEND").is_none()
        {
            std::env::set_var("GDK_BACKEND", "x11");
        }
        gtk::init()?;
        if std::env::var_os("WAYLAND_DISPLAY").is_some() && std::env::var_os("DISPLAY").is_none() {
            tracing::warn!(
                "Winit/Wry child WebViews require an X11 display; use DISPLAY/XWayland or the future Tao/GTK seam for native Wayland"
            );
        }
    }
    Ok(())
}

pub fn configure_event_loop<T>(builder: &mut EventLoopBuilder<T>) {
    #[cfg(target_os = "linux")]
    if std::env::var_os("DISPLAY").is_some()
        && std::env::var_os("WAYLAND_DISPLAY").is_some()
        && std::env::var_os("GDK_BACKEND").as_deref() == Some(std::ffi::OsStr::new("x11"))
    {
        use winit::platform::x11::EventLoopBuilderExtX11;

        builder.with_x11();
        tracing::debug!("using X11/XWayland for the Winit/Wry child WebView");
    }
}

pub fn pump() {
    #[cfg(target_os = "linux")]
    while gtk::events_pending() {
        gtk::main_iteration_do(false);
    }
}

pub fn build_webview(builder: WebViewBuilder<'_>, window: &Window) -> wry::Result<WebView> {
    // `build_as_child` is supported by Wry on Windows, macOS, and Linux/X11.
    // Keeping this call in one platform seam leaves a later Linux Tao/GTK
    // implementation isolated from the core and IPC crates.
    builder.build_as_child(window)
}
