//! Stable event values for the rest of TikTools.
//!
//! `ttl-live-events` deliberately exposes only the small, schema-stable fields
//! shared by its consumers. This module adds the TikTools wire details (method,
//! message id, and history flag) without leaking generated protobuf types into
//! `tiktools-core`.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::GiftInfo;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EventUser {
    pub user_id: Option<String>,
    pub unique_id: String,
    pub nickname: String,
    pub sec_uid: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum LiveEvent {
    Chat {
        user: EventUser,
        comment: String,
        method: String,
        msg_id: u64,
        is_history: bool,
    },
    Gift {
        user: EventUser,
        gift_id: u64,
        gift_name: String,
        diamond_count: u64,
        repeat_count: u64,
        combo_count: u64,
        group_id: u64,
        repeat_end: bool,
        streakable: bool,
        gift_icon_url: Option<String>,
        method: String,
        msg_id: u64,
        is_history: bool,
    },
    Like {
        user: EventUser,
        count: u64,
        total: u64,
        method: String,
        msg_id: u64,
        is_history: bool,
    },
    Member {
        user: EventUser,
        member_count: u64,
        action: i32,
        method: String,
        msg_id: u64,
        is_history: bool,
    },
    Social {
        user: EventUser,
        action: i64,
        follow_count: u64,
        share_count: u64,
        method: String,
        msg_id: u64,
        is_history: bool,
    },
    RoomUser {
        total: u64,
        popularity: u64,
        total_user: u64,
        anonymous: u64,
        method: String,
        msg_id: u64,
        is_history: bool,
    },
    Unknown {
        method: String,
        payload: Vec<u8>,
        msg_id: u64,
        is_history: bool,
    },
}

pub fn from_decoded(
    decoded: ttl_live_events::DecodedEvent,
    gifts: &HashMap<String, GiftInfo>,
) -> LiveEvent {
    let method = decoded.raw.method;
    let msg_id = decoded.raw.msg_id;
    let is_history = decoded.raw.is_history;
    match decoded.event {
        ttl_live_events::LiveEvent::Chat(event) => LiveEvent::Chat {
            user: user(event.user),
            comment: event.comment,
            method,
            msg_id,
            is_history,
        },
        ttl_live_events::LiveEvent::Gift(event) => {
            let gift = gifts.get(&event.gift_id.to_string());
            LiveEvent::Gift {
                user: user(event.user),
                gift_id: event.gift_id,
                gift_name: if event.gift_name.is_empty() {
                    gift.map(|gift| gift.name.clone())
                        .unwrap_or_else(|| "Gift".to_owned())
                } else {
                    event.gift_name
                },
                diamond_count: if event.diamond_count == 0 {
                    gift.map(|gift| gift.diamond_count).unwrap_or_default()
                } else {
                    event.diamond_count
                },
                repeat_count: event.repeat_count,
                combo_count: event.combo_count,
                group_id: event.group_id,
                repeat_end: event.repeat_end,
                streakable: gift.map(|gift| gift.streakable).unwrap_or(false),
                gift_icon_url: gift.and_then(|gift| gift.icon_url.clone()),
                method,
                msg_id,
                is_history,
            }
        }
        ttl_live_events::LiveEvent::Like(event) => LiveEvent::Like {
            user: user(event.user),
            count: event.count,
            total: event.total,
            method,
            msg_id,
            is_history,
        },
        ttl_live_events::LiveEvent::Member(event) => LiveEvent::Member {
            user: user(event.user),
            member_count: event.member_count,
            action: event.action,
            method,
            msg_id,
            is_history,
        },
        ttl_live_events::LiveEvent::Social(event) => LiveEvent::Social {
            user: user(event.user),
            action: event.action,
            follow_count: event.follow_count,
            share_count: event.share_count,
            method,
            msg_id,
            is_history,
        },
        ttl_live_events::LiveEvent::RoomUser(event) => LiveEvent::RoomUser {
            total: event.total,
            popularity: event.popularity,
            total_user: event.total_user,
            anonymous: event.anonymous,
            method,
            msg_id,
            is_history,
        },
        ttl_live_events::LiveEvent::Unknown { payload, .. } => LiveEvent::Unknown {
            method,
            payload,
            msg_id,
            is_history,
        },
    }
}

fn user(value: ttl_live_events::EventUser) -> EventUser {
    EventUser {
        user_id: (value.id != 0).then(|| value.id.to_string()),
        unique_id: value.unique_id,
        nickname: value.nickname,
        sec_uid: value.sec_uid,
    }
}
