//! Runtime-neutral contracts shared by the host and installable plugins.
//!
//! This crate deliberately does not depend on the desktop, database, Tokio, or
//! TikTok crates. Plugin authors can use it without compiling TikTools itself.

pub mod abi;
pub mod capabilities;
pub mod manifest;
pub mod protocol;

pub use abi::{PluginBuffer, PluginInit, PluginStatus, TikToolsPluginApi};
pub use manifest::{PluginManifest, PluginRuntimeKind, PluginTrust};
pub use protocol::{read_frame, write_frame, PluginRequest, PluginResponse, MAX_FRAME_BYTES};

pub const TIKTOOLS_PLUGIN_ABI_VERSION: u32 = 1;
pub const TIKTOOLS_PLUGIN_PROTOCOL_VERSION: u32 = 1;
pub const TIKTOOLS_HOST_API_VERSION: &str = "1.0.0";
pub const TIKTOOLS_UI_API_VERSION: &str = "1.0.0";
