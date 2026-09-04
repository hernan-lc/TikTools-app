mod app;
mod event;
mod platform;
mod tray;
mod webview;

fn main() {
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
