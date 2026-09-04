//! Live transport constants kept separate from discovery and event models.

/// Logical protocol version used by the TikTools native live boundary.
pub const LIVE_PROTOCOL_VERSION: u32 = 1;

/// The native client uses the direct signed WebSocket path from `tiktok-signer`.
pub const TRANSPORT: &str = "direct-websocket";
