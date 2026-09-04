use std::sync::atomic::{AtomicBool, Ordering};

#[cfg(feature = "native-tiktok")]
use std::sync::Arc;

#[cfg(feature = "native-tiktok")]
use tiktools_tiktok::{
    ConnectRequest, ConnectionInfo, NativeTikTokClient, NativeTikTokConfig, TikTokError,
};

/// Owns the live transport without exposing a desktop or WebView type.
pub struct LiveService {
    connected: AtomicBool,
    #[cfg(feature = "native-tiktok")]
    client: Arc<NativeTikTokClient>,
}

impl Default for LiveService {
    fn default() -> Self {
        Self::new()
    }
}

impl LiveService {
    pub fn new() -> Self {
        Self::with_native_config(NativeConfig::default())
    }

    #[cfg(feature = "native-tiktok")]
    pub fn with_native_config(config: NativeTikTokConfig) -> Self {
        Self {
            connected: AtomicBool::new(false),
            client: Arc::new(NativeTikTokClient::new(config)),
        }
    }

    #[cfg(not(feature = "native-tiktok"))]
    pub fn with_native_config(_config: NativeConfig) -> Self {
        Self {
            connected: AtomicBool::new(false),
        }
    }

    pub fn is_connected(&self) -> bool {
        self.connected.load(Ordering::Acquire)
    }

    #[cfg(feature = "native-tiktok")]
    pub fn subscribe(&self) -> tokio::sync::broadcast::Receiver<tiktools_tiktok::ClientEvent> {
        self.client.subscribe()
    }

    #[cfg(feature = "native-tiktok")]
    pub async fn connect(&self, request: ConnectRequest) -> Result<ConnectionInfo, TikTokError> {
        let result = self.client.connect_native(request).await;
        if result.is_ok() {
            self.connected.store(true, Ordering::Release);
        }
        result
    }

    #[cfg(feature = "native-tiktok")]
    pub async fn live_channels(
        &self,
        session_cookie: &str,
    ) -> Result<Vec<tiktools_tiktok::discovery::LiveRoom>, TikTokError> {
        self.client.live_channels(session_cookie).await
    }

    pub async fn disconnect(&self) {
        #[cfg(feature = "native-tiktok")]
        if let Err(error) = self.client.disconnect_native().await {
            tracing::debug!(%error, "native TikTok client disconnect failed");
        }
        self.connected.store(false, Ordering::Release);
    }
}

#[cfg(feature = "native-tiktok")]
pub type NativeConfig = NativeTikTokConfig;

#[cfg(not(feature = "native-tiktok"))]
#[derive(Default)]
pub struct NativeConfig;
