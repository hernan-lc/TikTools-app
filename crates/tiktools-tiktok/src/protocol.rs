//! Compatibility constants for the Rust-side TikTok boundary.

/// Version of the stable event values owned by this crate.
pub const EVENT_PROTOCOL_VERSION: u32 = 1;

/// This client does not launch a JavaScript or Bun sidecar.
pub const RUNTIME: &str = "native-rust";
