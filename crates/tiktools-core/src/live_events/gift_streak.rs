//! Gift streak state machine.
//!
//! TikTok reports a running streak as a sequence of cumulative messages:
//! `repeatCount`/`comboCount` already include every earlier tap. Summing the
//! progress updates would award the same gift over and over, so this module
//! keeps one state per composite identity and only the finalization is
//! authoritative for points/diamonds.
//!
//! Identity is `(room session, sender, gift id, streak group id)`. A missing or
//! `"0"` group id is never used to merge unrelated gifts: those events get an
//! event-message identity instead. Two viewers sending the same gift, and two
//! simultaneous streaks from one viewer, therefore stay isolated.
//!
//! Missing catalog metadata is classified as `Unknown`, not
//! `NonStreakable`. Unknown progress is collected but not awarded; an unknown
//! single gift with `repeatEnd` may finalize once. A timeout finalizes the
//! active state as `timed_out` *without* awarding, and says so explicitly.

use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tiktools_tiktok::events::GiftStreakClassification;

use tiktools_plugin_api::sync::recover_mutex;

use crate::*;

/// Default inactivity window for the timeout finalization fallback. This is
/// deliberately longer than the like combo window: gift streaks arrive
/// sparsely while a viewer holds an animation.
pub const DEFAULT_GIFT_STREAK_TIMEOUT_MS: u64 = 8_000;
/// Bounded simultaneous streak states.
pub const MAX_ACTIVE_GIFT_STREAKS: usize = 1_024;
/// Bounded finalized identities (replay/finalization protection).
pub const MAX_COMPLETED_GIFT_STREAKS: usize = 4_096;
const SWEEP_INTERVAL: Duration = Duration::from_secs(1);

/// Status of one derived gift combo update.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum GiftComboStatus {
    Started,
    Updated,
    Finalized,
    TimedOut,
    Incomplete,
}

impl GiftComboStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Started => "started",
            Self::Updated => "updated",
            Self::Finalized => "finalized",
            Self::TimedOut => "timed_out",
            Self::Incomplete => "incomplete",
        }
    }
}

/// One authoritative gift streak transition.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GiftStreakUpdate {
    pub key: String,
    pub gift_id: String,
    pub gift_name: String,
    pub group_id: String,
    /// Highest valid cumulative count observed for this streak.
    pub count: u64,
    pub previous_count: u64,
    pub diamonds_each: u64,
    pub total_diamonds: u64,
    pub status: GiftComboStatus,
    pub complete: bool,
    pub classification: GiftStreakClassification,
    /// `true` only for a normal `repeatEnd` finalization. Timeout fallbacks
    /// and replayed finals are not authoritative for payments/points.
    pub authoritative: bool,
    /// The one decision points/automations should follow.
    pub should_award: bool,
    /// Explicit flag for timeout/incomplete finalizations.
    pub incomplete: bool,
    pub duplicate: bool,
}

#[derive(Clone)]
struct ActiveGiftStreak {
    key: String,
    gift_id: String,
    gift_name: String,
    group_id: String,
    sender: String,
    count: u64,
    diamonds_each: u64,
    classification: GiftStreakClassification,
    started_at: Instant,
    last_update_at: Instant,
}

#[derive(Clone)]
struct CompletedGiftStreak {
    count: u64,
    awarded: bool,
    timed_out: bool,
}

struct GiftInner {
    scope: String,
    active: HashMap<String, ActiveGiftStreak>,
    completed: HashMap<String, CompletedGiftStreak>,
    completed_order: VecDeque<String>,
    last_sweep_at: Instant,
    anonymous_sequence: u64,
}

impl Default for GiftInner {
    fn default() -> Self {
        Self {
            scope: "unscoped".to_owned(),
            active: HashMap::new(),
            completed: HashMap::new(),
            completed_order: VecDeque::new(),
            last_sweep_at: Instant::now(),
            anonymous_sequence: 0,
        }
    }
}

/// Owns gift streak identity and finalization decisions.
pub struct GiftStreakTracker {
    inner: Mutex<GiftInner>,
    timeout: Duration,
}

impl Default for GiftStreakTracker {
    fn default() -> Self {
        Self::new(DEFAULT_GIFT_STREAK_TIMEOUT_MS)
    }
}

impl GiftStreakTracker {
    pub fn new(timeout_ms: u64) -> Self {
        Self {
            inner: Mutex::new(GiftInner::default()),
            timeout: Duration::from_millis(timeout_ms.max(1)),
        }
    }

    /// Scopes new streaks to one room session. Reconnects to the same room
    /// preserve active state; a different room/creator clears it so a stale
    /// streak can never be credited to a different room.
    pub fn enter_room(&self, creator: &str, room: &str, session: u64) {
        let mut inner = recover_mutex(&self.inner, "gift streak tracker");
        let scope = format!("{creator}:{room}:{session}");
        if inner.scope != scope {
            inner.active.clear();
            inner.completed.clear();
            inner.completed_order.clear();
            inner.scope = scope;
        }
    }

    pub fn active_count(&self) -> usize {
        recover_mutex(&self.inner, "gift streak tracker").active.len()
    }

    /// Observes one native gift event and returns its authoritative transition.
    pub fn observe(&self, event: &NativeLiveEvent) -> Option<GiftStreakUpdate> {
        self.observe_at(event, Instant::now())
    }

    pub fn observe_at(
        &self,
        event: &NativeLiveEvent,
        now: Instant,
    ) -> Option<GiftStreakUpdate> {
        let tiktools_tiktok::events::CanonicalLiveEvent::Gift(gift) = &event.base else {
            return None;
        };
        let classification = event.gift_streak_classification();
        let user = gift.user.unique_id.trim().trim_start_matches('@');
        let sender = if !user.is_empty() {
            user.to_owned()
        } else if gift.user.id != 0 {
            format!("id:{}", gift.user.id)
        } else {
            "anonymous".to_owned()
        };
        let gift_id = if gift.gift_id != 0 {
            gift.gift_id.to_string()
        } else {
            "unknown".to_owned()
        };
        let diamonds_each = event.gift_diamond_count().unwrap_or(gift.diamond_count);
        let gift_name = event.gift_name().unwrap_or("Gift").to_owned();
        let cumulative = gift.repeat_count.max(gift.combo_count).max(1);
        let group_id = gift.group_id.to_string();
        let has_valid_group = gift.group_id != 0;

        let mut inner = recover_mutex(&self.inner, "gift streak tracker");
        self.sweep_locked(&mut inner, now);
        let key = if has_valid_group {
            format!(
                "{}|{}|{}|g:{}",
                inner.scope, sender, gift_id, gift.group_id
            )
        } else if gift.repeat_end {
            // A final without a group id cannot be joined to a streak. Use the
            // message identity, or a monotonic anonymous identity when TikTok
            // omitted it entirely, so unrelated gifts never merge.
            if event.msg_id() != 0 {
                format!("{}|{}|{}|m:{}", inner.scope, sender, gift_id, event.msg_id())
            } else {
                inner.anonymous_sequence = inner.anonymous_sequence.saturating_add(1);
                format!(
                    "{}|{}|{}|anon:{}",
                    inner.scope, sender, gift_id, inner.anonymous_sequence
                )
            }
        } else if event.msg_id() != 0 {
            format!("{}|{}|{}|m:{}", inner.scope, sender, gift_id, event.msg_id())
        } else {
            inner.anonymous_sequence = inner.anonymous_sequence.saturating_add(1);
            format!(
                "{}|{}|{}|anon:{}",
                inner.scope, sender, gift_id, inner.anonymous_sequence
            )
        };

        if !classification.may_streak() {
            // Definitive non-streakable gift: each event is its own gift.
            if let Some(previous) = inner.completed.get(&key) {
                if previous.awarded && previous.count >= cumulative {
                    return Some(self.duplicate_update(
                        key,
                        gift_id,
                        gift_name,
                        group_id,
                        cumulative,
                        diamonds_each,
                        classification,
                    ));
                }
            }
            self.remember_completed(&mut inner, &key, cumulative, true, false);
            return Some(GiftStreakUpdate {
                key,
                gift_id,
                gift_name,
                group_id,
                count: cumulative,
                previous_count: 0,
                diamonds_each,
                total_diamonds: diamonds_each.saturating_mul(cumulative),
                status: GiftComboStatus::Finalized,
                complete: true,
                classification,
                authoritative: true,
                should_award: true,
                incomplete: false,
                duplicate: false,
            });
        }

        let existing = inner.active.get(&key).cloned();
        let previous_count = existing.as_ref().map(|streak| streak.count).unwrap_or(0);

        if !gift.repeat_end {
            // Progress only. The cumulative count is never summed.
            let count = previous_count.max(cumulative);
            let started = existing.is_none();
            let status = if started {
                GiftComboStatus::Started
            } else if count > previous_count {
                GiftComboStatus::Updated
            } else {
                // Exact/older progress update: no displayed decrease, no
                // side effect, but still a real observation.
                GiftComboStatus::Updated
            };
            let entry = ActiveGiftStreak {
                key: key.clone(),
                gift_id: gift_id.clone(),
                gift_name: gift_name.clone(),
                group_id: group_id.clone(),
                sender,
                count,
                diamonds_each: diamonds_each.max(
                    existing.as_ref().map(|streak| streak.diamonds_each).unwrap_or(0),
                ),
                classification,
                started_at: existing
                    .as_ref()
                    .map(|streak| streak.started_at)
                    .unwrap_or(now),
                last_update_at: now,
            };
            inner.active.insert(key.clone(), entry);
            self.bound_active(&mut inner);
            return Some(GiftStreakUpdate {
                key,
                gift_id,
                gift_name,
                group_id,
                count,
                previous_count,
                diamonds_each: diamonds_each.max(
                    existing.as_ref().map(|streak| streak.diamonds_each).unwrap_or(0),
                ),
                total_diamonds: diamonds_each
                    .max(existing.as_ref().map(|streak| streak.diamonds_each).unwrap_or(0))
                    .saturating_mul(count),
                status,
                complete: false,
                classification,
                authoritative: false,
                should_award: false,
                incomplete: false,
                duplicate: false,
            });
        }

        // repeatEnd: normal authoritative finalization.
        let final_count = previous_count.max(cumulative);
        if let Some(previous) = inner.completed.get(&key) {
            if previous.awarded && previous.count >= final_count {
                inner.active.remove(&key);
                return Some(self.duplicate_update(
                    key,
                    gift_id,
                    gift_name,
                    group_id,
                    final_count,
                    diamonds_each,
                    classification,
                ));
            }
        }
        inner.active.remove(&key);
        let already_awarded = inner
            .completed
            .get(&key)
            .is_some_and(|previous| previous.awarded);
        let should_award = !already_awarded;
        self.remember_completed(&mut inner, &key, final_count, should_award, false);
        Some(GiftStreakUpdate {
            key,
            gift_id,
            gift_name,
            group_id,
            count: final_count,
            previous_count,
            diamonds_each,
            total_diamonds: diamonds_each.saturating_mul(final_count),
            status: GiftComboStatus::Finalized,
            complete: true,
            classification,
            authoritative: true,
            should_award,
            incomplete: false,
            duplicate: !should_award,
        })
    }

    /// Fallback finalization. Never awards points or payment-equivalent
    /// actions: callers must surface `incomplete` instead.
    pub fn sweep_idle(&self) -> Vec<GiftStreakUpdate> {
        self.sweep_idle_at(Instant::now())
    }

    pub fn sweep_idle_at(&self, now: Instant) -> Vec<GiftStreakUpdate> {
        let mut inner = recover_mutex(&self.inner, "gift streak tracker");
        let expired = self.expired_locked(&mut inner, now);
        expired
    }

    fn sweep_locked(&self, inner: &mut GiftInner, now: Instant) -> Vec<GiftStreakUpdate> {
        if now.saturating_duration_since(inner.last_sweep_at) < SWEEP_INTERVAL {
            return Vec::new();
        }
        inner.last_sweep_at = now;
        self.expired_locked(inner, now)
    }

    fn expired_locked(&self, inner: &mut GiftInner, now: Instant) -> Vec<GiftStreakUpdate> {
        let expired: Vec<ActiveGiftStreak> = inner
            .active
            .values()
            .filter(|streak| now.saturating_duration_since(streak.last_update_at) > self.timeout)
            .cloned()
            .collect();
        let mut updates = Vec::with_capacity(expired.len());
        for streak in expired {
            inner.active.remove(&streak.key);
            let previous = inner
                .completed
                .get(&streak.key)
                .map(|completed| completed.count)
                .unwrap_or(0);
            self.remember_completed(inner, &streak.key, streak.count, false, true);
            updates.push(GiftStreakUpdate {
                key: streak.key,
                gift_id: streak.gift_id,
                gift_name: streak.gift_name,
                group_id: streak.group_id,
                count: streak.count,
                previous_count: previous,
                diamonds_each: streak.diamonds_each,
                total_diamonds: streak.diamonds_each.saturating_mul(streak.count),
                status: GiftComboStatus::TimedOut,
                complete: true,
                classification: streak.classification,
                authoritative: false,
                should_award: false,
                incomplete: true,
                duplicate: false,
            });
        }
        updates.sort_by(|left, right| left.key.cmp(&right.key));
        updates
    }

    fn remember_completed(
        &self,
        inner: &mut GiftInner,
        key: &str,
        count: u64,
        awarded: bool,
        timed_out: bool,
    ) {
        inner.completed.insert(
            key.to_owned(),
            CompletedGiftStreak {
                count,
                awarded,
                timed_out,
            },
        );
        inner.completed_order.retain(|candidate| candidate != key);
        inner.completed_order.push_back(key.to_owned());
        while inner.completed_order.len() > MAX_COMPLETED_GIFT_STREAKS {
            if let Some(oldest) = inner.completed_order.pop_front() {
                inner.completed.remove(&oldest);
            }
        }
    }

    fn bound_active(&self, inner: &mut GiftInner) {
        if inner.active.len() <= MAX_ACTIVE_GIFT_STREAKS {
            return;
        }
        // Evict the oldest inactive streak. Eviction never awards; the
        // timeout path will report it as incomplete on the next sweep.
        let oldest = inner
            .active
            .values()
            .min_by_key(|streak| streak.last_update_at)
            .map(|streak| streak.key.clone());
        if let Some(oldest) = oldest {
            inner.active.remove(&oldest);
        }
    }

    fn duplicate_update(
        &self,
        key: String,
        gift_id: String,
        gift_name: String,
        group_id: String,
        count: u64,
        diamonds_each: u64,
        classification: GiftStreakClassification,
    ) -> GiftStreakUpdate {
        GiftStreakUpdate {
            key,
            gift_id,
            gift_name,
            group_id,
            count,
            previous_count: count,
            diamonds_each,
            total_diamonds: diamonds_each.saturating_mul(count),
            status: GiftComboStatus::Finalized,
            complete: true,
            classification,
            authoritative: false,
            should_award: false,
            incomplete: false,
            duplicate: true,
        }
    }

    /// Diagnostics for the Control API/feed.
    pub fn stats(&self) -> (usize, usize, String) {
        let inner = recover_mutex(&self.inner, "gift streak tracker");
        (inner.active.len(), inner.completed.len(), inner.scope.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tiktools_tiktok::events::{
        CanonicalLiveEvent, EventMetadata, EventUser, GiftEnrichment, GiftEvent,
    };

    fn user(id: u64, unique: &str) -> EventUser {
        EventUser {
            id,
            unique_id: unique.to_owned(),
            nickname: unique.to_owned(),
            sec_uid: String::new(),
            avatar_url: None,
        }
    }

    fn gift(
        msg_id: u64,
        unique: &str,
        group: i32,
        repeat: u64,
        combo: u64,
        repeat_end: bool,
        enrichment: Option<bool>,
    ) -> NativeLiveEvent {
        NativeLiveEvent {
            base: CanonicalLiveEvent::Gift(GiftEvent {
                user: user(7, unique),
                gift_id: 5655,
                gift_name: "Rose".to_owned(),
                gift_image_url: None,
                diamond_count: 1,
                repeat_count: repeat,
                combo_count: combo,
                group_id: group as u64,
                repeat_end,
            }),
            metadata: EventMetadata {
                method: "WebcastGiftMessage".to_owned(),
                msg_id,
                is_history: false,
            },
            gift: enrichment.map(|streakable| GiftEnrichment {
                name: "Rose".to_owned(),
                diamond_count: 1,
                streakable,
                icon_url: None,
            }),
        }
    }

    #[test]
    fn non_streakable_gift_is_immediate_and_never_awaits_finalization() {
        let tracker = GiftStreakTracker::default();
        tracker.enter_room("creator", "room", 1);
        let update = tracker
            .observe(&gift(1, "alice", 0, 1, 1, false, Some(false)))
            .unwrap();
        assert_eq!(update.status, GiftComboStatus::Finalized);
        assert!(update.should_award);
        assert!(update.complete);
        assert_eq!(update.total_diamonds, 1);
    }

    #[test]
    fn progress_is_cumulative_not_summed_and_only_final_awards() {
        let tracker = GiftStreakTracker::default();
        tracker.enter_room("creator", "room", 1);
        let first = tracker
            .observe(&gift(1, "alice", 9, 1, 1, false, Some(true)))
            .unwrap();
        assert_eq!(first.status, GiftComboStatus::Started);
        assert_eq!(first.count, 1);
        assert!(!first.should_award);
        let second = tracker
            .observe(&gift(2, "alice", 9, 3, 3, false, Some(true)))
            .unwrap();
        assert_eq!(second.status, GiftComboStatus::Updated);
        assert_eq!(second.count, 3);
        assert!(!second.should_award);
        let final_update = tracker
            .observe(&gift(3, "alice", 9, 5, 5, true, Some(true)))
            .unwrap();
        assert_eq!(final_update.status, GiftComboStatus::Finalized);
        assert_eq!(final_update.count, 5);
        assert!(final_update.should_award);
        assert_eq!(final_update.total_diamonds, 5);
        // Exact final replay (distinct msg id) still awards nothing.
        let replay = tracker
            .observe(&gift(99, "alice", 9, 5, 5, true, Some(true)))
            .unwrap();
        assert!(replay.duplicate);
        assert!(!replay.should_award);
    }

    #[test]
    fn missing_catalog_does_not_make_gift_non_streakable() {
        let tracker = GiftStreakTracker::default();
        tracker.enter_room("creator", "room", 1);
        let progress = tracker
            .observe(&gift(1, "alice", 9, 1, 1, false, None))
            .unwrap();
        assert_eq!(
            progress.classification,
            GiftStreakClassification::Streakable,
            "native repeat progress is inferred streakable, never non-streakable"
        );
        assert!(!progress.should_award);
        let final_update = tracker
            .observe(&gift(2, "alice", 9, 2, 2, true, None))
            .unwrap();
        assert!(final_update.should_award);
        assert_eq!(final_update.total_diamonds, 2);
    }

    #[test]
    fn missing_finalization_is_reported_incomplete_and_never_awards() {
        let tracker = GiftStreakTracker::new(1_000);
        tracker.enter_room("creator", "room", 1);
        let base = Instant::now();
        tracker
            .observe_at(&gift(1, "alice", 9, 3, 3, false, Some(true)), base)
            .unwrap();
        let expired = tracker
            .sweep_idle_at(base + Duration::from_secs(5));
        assert_eq!(expired.len(), 1);
        assert_eq!(expired[0].status, GiftComboStatus::TimedOut);
        assert!(expired[0].incomplete);
        assert!(!expired[0].should_award);
        assert!(!expired[0].authoritative);
    }

    #[test]
    fn two_viewers_sending_same_gift_stay_separate() {
        let tracker = GiftStreakTracker::default();
        tracker.enter_room("creator", "room", 1);
        let alice = tracker
            .observe(&gift(1, "alice", 0, 2, 2, false, Some(true)))
            .unwrap();
        let bob = tracker
            .observe(&gift(2, "bob", 0, 5, 5, false, Some(true)))
            .unwrap();
        assert_ne!(alice.key, bob.key);
        assert_eq!(alice.count, 2);
        assert_eq!(bob.count, 5);
        assert_eq!(tracker.active_count(), 2);
    }

    #[test]
    fn group_zero_does_not_merge_unrelated_gifts() {
        let tracker = GiftStreakTracker::default();
        tracker.enter_room("creator", "room", 1);
        let first = tracker
            .observe(&gift(11, "alice", 0, 1, 1, false, None))
            .unwrap();
        let second = tracker
            .observe(&gift(12, "alice", 0, 1, 1, false, None))
            .unwrap();
        assert_ne!(first.key, second.key);
        assert_eq!(tracker.active_count(), 2);
    }

    #[test]
    fn missing_intermediate_packet_is_reconciled_by_final_cumulative_count() {
        let tracker = GiftStreakTracker::default();
        tracker.enter_room("creator", "room", 1);
        tracker
            .observe(&gift(1, "alice", 9, 1, 1, false, Some(true)))
            .unwrap();
        // The final jumps from 1 to 20; no intermediate packet observed.
        let final_update = tracker
            .observe(&gift(2, "alice", 9, 20, 20, true, Some(true)))
            .unwrap();
        assert_eq!(final_update.count, 20);
        assert_eq!(final_update.total_diamonds, 20);
        assert!(final_update.should_award);
    }

    #[test]
    fn room_change_clears_active_streaks() {
        let tracker = GiftStreakTracker::default();
        tracker.enter_room("creator", "room", 1);
        tracker
            .observe(&gift(1, "alice", 9, 1, 1, false, Some(true)))
            .unwrap();
        assert_eq!(tracker.active_count(), 1);
        tracker.enter_room("creator", "room-2", 2);
        assert_eq!(tracker.active_count(), 0);
    }
}
