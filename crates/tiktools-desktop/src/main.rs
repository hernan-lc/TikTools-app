mod app;
mod event;
mod platform;
mod tray;
mod webview;

fn main() {
    // rustls 0.23 cannot choose a provider when multiple TLS stacks are unified
    // by the workspace. Install the provider before any async client is created.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }

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
