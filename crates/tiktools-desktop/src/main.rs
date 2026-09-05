#![cfg_attr(
    all(target_os = "windows", not(debug_assertions)),
    windows_subsystem = "windows"
)]

mod app;
mod event;
mod icon;
mod media;
mod platform;
mod tray;
mod webview;
mod window;

fn main() {
    // rustls 0.23 cannot choose a provider when multiple TLS stacks are unified
    // by the workspace. Install the provider before any async client is created.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }

    // TODO: route tracing to a bounded/rotated file under
    // `%LOCALAPPDATA%\TikTools\logs\tiktools.log` in release builds. The
    // Windows GUI subsystem hides the console, so startup failures must not
    // depend on stdout. Plugin installation failures are already surfaced in
    // the GUI via `plugin-install-result`; file logging remains future work.
    // Never log session cookies.
    tracing_subscriber::fmt()
        .with_target(false)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("tiktools=info")),
        )
        .init();

    if let Err(error) = app::run() {
        tracing::error!(%error, "TikTools Rust host terminated during startup");
        std::process::exit(1);
    }
}
