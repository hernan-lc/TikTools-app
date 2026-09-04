//! Domain discovery values exposed by the native TikTok client.

use serde::{Deserialize, Serialize};

/// A room returned by TikTok's browser-free live search endpoint.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LiveRoom {
    pub unique_id: String,
    pub room_id: String,
    pub nickname: String,
    pub title: String,
    pub viewers: u64,
}

impl From<ttl_live_discovery::LiveRoom> for LiveRoom {
    fn from(room: ttl_live_discovery::LiveRoom) -> Self {
        Self {
            unique_id: room.unique_id,
            room_id: room.room_id,
            nickname: room.nickname,
            title: room.title,
            viewers: room.viewers,
        }
    }
}
