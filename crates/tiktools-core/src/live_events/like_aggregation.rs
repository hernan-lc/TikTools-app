//! Authoritative LIKE aggregation for LIVE rooms.
//!
//! TikTok delivers likes as *batches*. A viewer tapping 60 times may produce
//! `WebcastLikeMessage` packets of 15 + 15 + 15 + 15. The raw `tiktok.like`
//! automation trigger keeps its historical per-packet meaning (`count` is the
//! batch, `total` is the upstream room counter). Aggregated values live here,
//! in one owner shared by points, automations, the Control API, CLI, headless
//! hosts, and the web clients.
//!
//! # Semantics
//!
//! * `batch_count` — likes in the accepted packet, never inferred.
//! * `viewer_observed_total` — sum of accepted batches attributed to a viewer.
//! * `viewer_combo_count` — likes in the viewer's current combo. A combo ends
//!   after `combo_idle_timeout_ms` without an accepted batch from that viewer.
//! * `room_observed_total` — sum of accepted batches in the current room.
//! * `room_reported_total` — the upstream `total` field, treated as a room
//!   cumulative value only when it is monotonic. It is *never* added to
//!   `count` and never attributed to a viewer.
//!
//! Nothing here fabricates likes. A missing packet is a missing packet: the
//! diagnostics expose gaps/uncertainty instead of inventing an estimate.
//!
//! # Performance
//!
//! Every accepted event is O(1) for the viewer update and O(goals) for goal
//! evaluation (`goals` is capped). Expired combos are swept at most once per
//! second, never per event. Memory is bounded by [`MAX_VIEWERS`] and a bounded
//! milestone-completion set.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use tiktools_plugin_api::sync::recover_mutex;

/// Default inactivity window that closes a viewer combo.
pub const DEFAULT_COMBO_IDLE_TIMEOUT_MS: u64 = 5_000;
/// Safe lower bound: a shorter window would split ordinary tap bursts.
pub const MIN_COMBO_IDLE_TIMEOUT_MS: u64 = 500;
/// Safe upper bound: a longer window would merge unrelated viewing sessions.
pub const MAX_COMBO_IDLE_TIMEOUT_MS: u64 = 5 * 60 * 1_000;
/// Default configured milestones (crossing semantics, not equality).
pub const DEFAULT_MILESTONES: &[u64] = &[15, 50, 100, 500, 1_000];
/// Bounded viewer map. Eviction is FIFO of least-recently-updated entries.
pub const MAX_VIEWERS: usize = 4_096;
/// Bounded configured goals.
pub const MAX_GOALS: usize = 256;
/// Bounded milestone completion identities.
pub const MAX_COMPLETED_MILESTONES: usize = 16_384;
/// Minimum wall-clock interval between idle-combo sweeps.
const SWEEP_INTERVAL: Duration = Duration::from_secs(1);

/// Scope used by a configured like goal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum LikeGoalScope {
    /// A viewer's accepted total for the current room session.
    ViewerObserved,
    /// A viewer's active combo (resets after the idle timeout).
    ViewerCombo,
    /// Accepted likes in the room session.
    RoomObserved,
    /// Upstream room cumulative total, only when it is monotonic/supported.
    RoomReported,
}

impl Default for LikeGoalScope {
    fn default() -> Self {
        Self::ViewerCombo
    }
}

impl LikeGoalScope {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ViewerObserved => "viewer_observed",
            Self::ViewerCombo => "viewer_combo",
            Self::RoomObserved => "room_observed",
            Self::RoomReported => "room_reported",
        }
    }

    pub fn is_viewer(self) -> bool {
        matches!(self, Self::ViewerObserved | Self::ViewerCombo)
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::ViewerObserved => "Per-viewer observed total",
            Self::ViewerCombo => "Per-viewer active combo",
            Self::RoomObserved => "Global observed room total",
            Self::RoomReported => "Global reported room total (best effort)",
        }
    }
}

/// What happens to aggregation state when the room/session changes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum LikeResetPolicy {
    /// A creator or room change starts a fresh scoped session (default).
    RoomChange,
    /// Only an explicit `likes.reset` clears state; a creator change still
    /// isolates state so one creator's totals cannot leak into another's.
    Manual,
}

impl Default for LikeResetPolicy {
    fn default() -> Self {
        Self::RoomChange
    }
}

/// Optional repeated-milestone strategy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LikeGoal {
    /// Stable identity used to suppress repeats across reconnects/replays.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// Positive threshold, evaluated with crossing semantics.
    #[serde(default = "default_goal_target")]
    pub target: u64,
    /// Scope of the measured value. Falls back to `defaultScope`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<LikeGoalScope>,
    /// Emit every `repeat_every` additional likes after the first crossing.
    /// `None` means exactly once for the configured scope/identity.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repeat_every: Option<u64>,
}

fn default_goal_target() -> u64 {
    15
}

/// Validated LIKE aggregation configuration.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LikeAggregationConfig {
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default = "default_combo_idle")]
    pub combo_idle_timeout_ms: u64,
    #[serde(default)]
    pub default_scope: LikeGoalScope,
    /// Numeric milestones evaluated in `defaultScope` (plus `goalScopes`).
    #[serde(default = "default_milestones")]
    pub milestones: Vec<u64>,
    /// Extra scopes to evaluate the numeric `milestones` in. Empty means
    /// `[defaultScope]` only.
    #[serde(default)]
    pub goal_scopes: Vec<LikeGoalScope>,
    /// Explicit goals with per-goal scope/repeat policy. These are evaluated
    /// in addition to `milestones`.
    #[serde(default)]
    pub goals: Vec<LikeGoal>,
    #[serde(default)]
    pub reset_policy: LikeResetPolicy,
    /// Emit `tiktok.like.combo` on every accepted combo change.
    #[serde(default = "default_enabled")]
    pub emit_intermediate_updates: bool,
    /// Accepted out-of-order tolerance in milliseconds. Ordering metadata is
    /// limited upstream; the value is exposed for diagnostics and future use.
    #[serde(default)]
    pub late_event_tolerance_ms: u64,
}

fn default_enabled() -> bool {
    true
}

fn default_combo_idle() -> u64 {
    DEFAULT_COMBO_IDLE_TIMEOUT_MS
}

fn default_milestones() -> Vec<u64> {
    DEFAULT_MILESTONES.to_vec()
}

impl Default for LikeAggregationConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            combo_idle_timeout_ms: DEFAULT_COMBO_IDLE_TIMEOUT_MS,
            default_scope: LikeGoalScope::ViewerCombo,
            milestones: DEFAULT_MILESTONES.to_vec(),
            goal_scopes: Vec::new(),
            goals: Vec::new(),
            reset_policy: LikeResetPolicy::RoomChange,
            emit_intermediate_updates: true,
            late_event_tolerance_ms: 0,
        }
    }
}

/// Partial update accepted by `likes.config.set`. Unknown/missing fields keep
/// their current value, so agents can change one setting safely.
#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LikeAggregationConfigUpdate {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub combo_idle_timeout_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_scope: Option<LikeGoalScope>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub milestones: Option<Vec<u64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub goal_scopes: Option<Vec<LikeGoalScope>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub goals: Option<Vec<LikeGoal>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reset_policy: Option<LikeResetPolicy>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub emit_intermediate_updates: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub late_event_tolerance_ms: Option<u64>,
}

/// Validation failure for a configuration update.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LikeConfigError(pub String);

impl std::fmt::Display for LikeConfigError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for LikeConfigError {}

impl LikeAggregationConfig {
    /// Validates and normalizes bounds. Returns the cleaned config.
    pub fn validate(mut self) -> Result<Self, LikeConfigError> {
        self.combo_idle_timeout_ms = self.combo_idle_timeout_ms.clamp(
            MIN_COMBO_IDLE_TIMEOUT_MS,
            MAX_COMBO_IDLE_TIMEOUT_MS,
        );
        self.late_event_tolerance_ms = self
            .late_event_tolerance_ms
            .min(MAX_COMBO_IDLE_TIMEOUT_MS);
        self.milestones.retain(|target| *target > 0);
        self.milestones.sort_unstable();
        self.milestones.dedup();
        if self.milestones.len() > MAX_GOALS {
            self.milestones.truncate(MAX_GOALS);
        }
        // Keep scope order deterministic and duplicate-free.
        let mut scopes = if self.goal_scopes.is_empty() {
            vec![self.default_scope]
        } else {
            self.goal_scopes.clone()
        };
        let mut seen = HashSet::new();
        scopes.retain(|scope| seen.insert(*scope));
        self.goal_scopes = scopes;
        if self.goals.len() > MAX_GOALS {
            return Err(LikeConfigError(format!(
                "goals is limited to {MAX_GOALS} entries"
            )));
        }
        for goal in &mut self.goals {
            if goal.target == 0 {
                return Err(LikeConfigError(
                    "goal targets must be greater than zero".to_owned(),
                ));
            }
            if goal.repeat_every == Some(0) {
                return Err(LikeConfigError(
                    "repeatEvery must be greater than zero".to_owned(),
                ));
            }
        }
        Ok(self)
    }

    /// Applies a partial update and validates the result.
    pub fn apply(&self, update: LikeAggregationConfigUpdate) -> Result<Self, LikeConfigError> {
        let mut next = self.clone();
        if let Some(value) = update.enabled {
            next.enabled = value;
        }
        if let Some(value) = update.combo_idle_timeout_ms {
            next.combo_idle_timeout_ms = value;
        }
        if let Some(value) = update.default_scope {
            next.default_scope = value;
        }
        if let Some(value) = update.milestones {
            next.milestones = value;
        }
        if let Some(value) = update.goal_scopes {
            next.goal_scopes = value;
        }
        if let Some(value) = update.goals {
            next.goals = value;
        }
        if let Some(value) = update.reset_policy {
            next.reset_policy = value;
        }
        if let Some(value) = update.emit_intermediate_updates {
            next.emit_intermediate_updates = value;
        }
        if let Some(value) = update.late_event_tolerance_ms {
            next.late_event_tolerance_ms = value;
        }
        next.validate()
    }
}

/// The room/session identity aggregation state belongs to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LikeScopeKey {
    pub creator: String,
    pub room: String,
    pub session: u64,
}

impl LikeScopeKey {
    pub fn id(&self) -> String {
        format!("{}:{}:{}", self.creator, self.room, self.session)
    }
}

#[derive(Debug, Clone)]
struct ViewerLikeState {
    observed_total: u64,
    combo_count: u64,
    combo_generation: u64,
    combo_started_at: Instant,
    combo_started_ms: u64,
    last_update_at: Instant,
    last_update_ms: u64,
}

#[derive(Debug, Clone)]
struct RoomLikeState {
    observed_total: u64,
    reported_total: Option<u64>,
    reported_monotonic: bool,
    last_update_ms: u64,
}

impl Default for RoomLikeState {
    fn default() -> Self {
        Self {
            observed_total: 0,
            reported_total: None,
            reported_monotonic: true,
            last_update_ms: 0,
        }
    }
}

/// Status attached to one derived combo update.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum LikeComboStatus {
    Started,
    Updated,
    TimedOut,
    Reset,
}

impl LikeComboStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Started => "started",
            Self::Updated => "updated",
            Self::TimedOut => "timed_out",
            Self::Reset => "reset",
        }
    }

    pub fn complete(self) -> bool {
        matches!(self, Self::TimedOut | Self::Reset)
    }
}

/// A combo change ready to become a `tiktok.like.combo` trigger.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LikeComboUpdate {
    pub user_id: String,
    pub count: u64,
    pub previous_count: u64,
    pub status: LikeComboStatus,
    pub duration_ms: u64,
    pub scope: LikeGoalScope,
    pub complete: bool,
}

/// A configured threshold crossing ready to become `tiktok.like.goal`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LikeGoalCrossed {
    pub scope: LikeGoalScope,
    /// Identifier of the viewer for viewer scopes; absent for room scopes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub viewer_id: Option<String>,
    pub goal: u64,
    pub previous: u64,
    pub current: u64,
    pub crossed: bool,
    pub milestone_id: String,
    pub repeat_every: Option<u64>,
}

/// One accepted room/reported update after aggregation.
#[derive(Debug, Clone)]
pub struct LikeObservation {
    /// `false` when aggregation is disabled; counters were not changed.
    pub accepted: bool,
    pub viewer_id: String,
    pub batch_count: u64,
    pub viewer_observed_total: u64,
    pub viewer_combo_count: u64,
    pub combo_status: LikeComboStatus,
    pub combo_duration_ms: u64,
    pub previous_combo_count: u64,
    pub room_observed_total: u64,
    pub room_reported_total: Option<u64>,
    pub goals: Vec<LikeGoalCrossed>,
    pub timed_out: Vec<LikeComboUpdate>,
}

impl LikeObservation {
    fn disabled(viewer_id: String) -> Self {
        Self {
            accepted: false,
            viewer_id,
            batch_count: 0,
            viewer_observed_total: 0,
            viewer_combo_count: 0,
            combo_status: LikeComboStatus::Updated,
            combo_duration_ms: 0,
            previous_combo_count: 0,
            room_observed_total: 0,
            room_reported_total: None,
            goals: Vec::new(),
            timed_out: Vec::new(),
        }
    }
}

/// Per-viewer aggregate exposed by `likes.stats.get`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LikeViewerAggregate {
    pub user_id: String,
    pub observed_total: u64,
    pub combo_count: u64,
    pub combo_generation: u64,
    pub combo_active: bool,
    pub combo_started_at: u64,
    pub last_update_at: u64,
}

/// Explicit data-quality indicators. Observed totals are exact for *accepted*
/// events, not for the upstream wire: packet loss cannot be reconstructed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LikeDataQuality {
    pub source: String,
    pub exact: bool,
    pub packet_loss_possible: bool,
    pub reported_total_supported: bool,
    pub reported_total_monotonic: bool,
    pub note: String,
}

/// Bounded persistence checkpoint. Only counters and identities needed to
/// recover milestone continuity are stored; individual likes never are.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LikeCheckpoint {
    pub creator: String,
    pub room: String,
    pub observed_total: u64,
    pub reported_total: Option<u64>,
    pub accepted_batches: u64,
    pub goal_crossings: u64,
    pub updated_at: u64,
}

/// Full authoritative aggregation snapshot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LikeStats {
    pub enabled: bool,
    pub creator: Option<String>,
    pub room: Option<String>,
    pub session: u64,
    pub room_observed_total: u64,
    pub room_reported_total: Option<u64>,
    pub active_combos: u64,
    pub total_viewers: u64,
    pub viewers: Vec<LikeViewerAggregate>,
    pub accepted_batches: u64,
    pub processed_likes: u64,
    pub goal_crossings: u64,
    pub completed_milestones: u64,
    pub gaps: u64,
    pub uncertainty: u64,
    pub last_update_at: u64,
    pub combo_idle_timeout_ms: u64,
    pub default_scope: LikeGoalScope,
    pub config: LikeAggregationConfig,
    pub data_quality: LikeDataQuality,
}

/// Explicit reset scopes for `likes.reset`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum LikeResetScope {
    All,
    Room,
    Viewer,
    Combo,
    Goals,
}

/// Result of an explicit reset.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LikeResetResult {
    pub scope: LikeResetScope,
    pub viewers_reset: u64,
    pub combos_reset: u64,
    pub room_reset: bool,
    pub goals_reset: u64,
}

struct LikeInner {
    config: LikeAggregationConfig,
    scope: Option<LikeScopeKey>,
    session_sequence: u64,
    viewers: HashMap<String, ViewerLikeState>,
    viewer_order: VecDeque<String>,
    room: RoomLikeState,
    completed: HashSet<String>,
    completed_order: VecDeque<String>,
    accepted_batches: u64,
    processed_likes: u64,
    goal_crossings: u64,
    gaps: u64,
    uncertainty: u64,
    last_sweep_at: Instant,
}

impl Default for LikeInner {
    fn default() -> Self {
        Self {
            config: LikeAggregationConfig::default(),
            scope: None,
            session_sequence: 0,
            viewers: HashMap::new(),
            viewer_order: VecDeque::new(),
            room: RoomLikeState::default(),
            completed: HashSet::new(),
            completed_order: VecDeque::new(),
            accepted_batches: 0,
            processed_likes: 0,
            goal_crossings: 0,
            gaps: 0,
            uncertainty: 0,
            last_sweep_at: Instant::now(),
        }
    }
}

/// One authoritative LIKE aggregation owner.
pub struct LikeAggregation {
    inner: Mutex<LikeInner>,
}

impl Default for LikeAggregation {
    fn default() -> Self {
        Self::new()
    }
}

impl LikeAggregation {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(LikeInner::default()),
        }
    }

    pub fn new_with_config(config: LikeAggregationConfig) -> Result<Self, LikeConfigError> {
        let config = config.validate()?;
        let service = Self::new();
        recover_mutex(&service.inner, "like aggregation").config = config;
        Ok(service)
    }

    pub fn config(&self) -> LikeAggregationConfig {
        recover_mutex(&self.inner, "like aggregation")
            .config
            .clone()
    }

    pub fn update_config(
        &self,
        update: LikeAggregationConfigUpdate,
    ) -> Result<LikeAggregationConfig, LikeConfigError> {
        let mut inner = recover_mutex(&self.inner, "like aggregation");
        let previous_timeout = inner.config.combo_idle_timeout_ms;
        let next = inner.config.apply(update)?;
        inner.config = next.clone();
        // A newly configured goal set must be evaluable immediately; existing
        // counters are preserved so a cooldown/config change never resets
        // accumulated progress.
        if next.combo_idle_timeout_ms != previous_timeout {
            inner.last_sweep_at = Instant::now();
        }
        Ok(next)
    }

    /// Enters a room/session. Same creator+room reconnects preserve counters;
    /// creator/room changes start a new scoped session.
    pub fn enter_room(&self, creator: &str, room: &str) -> bool {
        let mut inner = recover_mutex(&self.inner, "like aggregation");
        let same = inner
            .scope
            .as_ref()
            .is_some_and(|scope| scope.creator == creator && scope.room == room);
        if same {
            return false;
        }
        let resolved_creator_and_room = (creator.to_owned(), room.to_owned());
        inner.session_sequence = inner.session_sequence.saturating_add(1);
        inner.scope = Some(LikeScopeKey {
            creator: resolved_creator_and_room.0,
            room: resolved_creator_and_room.1,
            session: inner.session_sequence,
        });
        // A room/session change is never allowed to credit the previous
        // room's counters. `resetPolicy` is still reported for clients and is
        // used by explicit resets; isolation always wins over a stale total.
        reset_inner(&mut inner, true, true, true);
        true
    }

    /// Restores a persisted session only when it belongs to the same
    /// creator+room and the checkpoint is fresh enough to be meaningful.
    /// Returns `false` when the checkpoint was rejected.
    pub fn restore_session(
        &self,
        creator: &str,
        room: &str,
        observed_total: u64,
        reported_total: Option<u64>,
        accepted_batches: u64,
        goal_crossings: u64,
    ) -> bool {
        let mut inner = recover_mutex(&self.inner, "like aggregation");
        let same = inner
            .scope
            .as_ref()
            .is_some_and(|scope| scope.creator == creator && scope.room == room);
        if !same {
            return false;
        }
        inner.room.observed_total = observed_total;
        inner.room.reported_total = reported_total;
        inner.accepted_batches = accepted_batches;
        inner.goal_crossings = goal_crossings;
        inner.processed_likes = observed_total;
        true
    }

    /// Bearer of session/reconciliation markers for persistence.
    pub fn session_snapshot(&self) -> Option<(String, String, u64, Option<u64>, u64, u64)> {
        let inner = recover_mutex(&self.inner, "like aggregation");
        let scope = inner.scope.as_ref()?;
        Some((
            scope.creator.clone(),
            scope.room.clone(),
            inner.room.observed_total,
            inner.room.reported_total,
            inner.accepted_batches,
            inner.goal_crossings,
        ))
    }

    /// Bounded checkpoint for SQLite/app-state persistence.
    pub fn checkpoint(&self) -> Option<LikeCheckpoint> {
        let inner = recover_mutex(&self.inner, "like aggregation");
        let scope = inner.scope.as_ref()?;
        Some(LikeCheckpoint {
            creator: scope.creator.clone(),
            room: scope.room.clone(),
            observed_total: inner.room.observed_total,
            reported_total: inner.room.reported_total,
            accepted_batches: inner.accepted_batches,
            goal_crossings: inner.goal_crossings,
            updated_at: inner.room.last_update_ms,
        })
    }

    /// Restores counters from a checkpoint only when the room and creator
    /// match. A stale or mismatched checkpoint is reported as rejected.
    pub fn restore_checkpoint(&self, checkpoint: &LikeCheckpoint) -> bool {
        self.restore_session(
            &checkpoint.creator,
            &checkpoint.room,
            checkpoint.observed_total,
            checkpoint.reported_total,
            checkpoint.accepted_batches,
            checkpoint.goal_crossings,
        )
    }

    /// Records an accepted LIKE batch. Callers must have applied native
    /// message dedup first; this method intentionally does not suppress
    /// distinct packets that happen to carry the same `count`.
    pub fn observe(&self, user_id: &str, count: u64, reported_total: u64) -> LikeObservation {
        self.observe_at(user_id, count, reported_total, Instant::now(), like_wall_millis())
    }

    /// Deterministic variant for tests and replay tooling.
    pub fn observe_at(
        &self,
        user_id: &str,
        count: u64,
        reported_total: u64,
        now: Instant,
        wall_ms: u64,
    ) -> LikeObservation {
        let viewer_id = normalize_viewer(user_id);
        let mut inner = recover_mutex(&self.inner, "like aggregation");
        if !inner.config.enabled {
            return LikeObservation::disabled(viewer_id);
        }
        let timeout = Duration::from_millis(inner.config.combo_idle_timeout_ms);
        let mut timed_out = sweep_locked(&mut inner, now, timeout);

        let previous_room = inner.room.observed_total;
        let previous_reported = inner.room.reported_total;
        let viewer = inner
            .viewers
            .entry(viewer_id.clone())
            .or_insert_with(|| ViewerLikeState {
                observed_total: 0,
                combo_count: 0,
                combo_generation: 0,
                combo_started_at: now,
                combo_started_ms: wall_ms,
                last_update_at: now,
                last_update_ms: wall_ms,
            });
        let previous_observed = viewer.observed_total;
        let combo_expired = now.saturating_duration_since(viewer.last_update_at) > timeout;
        let mut previous_combo = viewer.combo_count;
        let status = if combo_expired || viewer.combo_count == 0 {
            if combo_expired && viewer.combo_count > 0 {
                // A viewer returning after the idle window starts a fresh
                // combo; the previous one is reported complete.
                timed_out.push(LikeComboUpdate {
                    user_id: viewer_id.clone(),
                    count: viewer.combo_count,
                    previous_count: 0,
                    status: LikeComboStatus::TimedOut,
                    duration_ms: now
                        .saturating_duration_since(viewer.combo_started_at)
                        .as_millis()
                        .min(u64::MAX as u128) as u64,
                    scope: LikeGoalScope::ViewerCombo,
                    complete: true,
                });
            }
            previous_combo = 0;
            viewer.combo_count = 0;
            viewer.combo_generation = viewer.combo_generation.saturating_add(1);
            viewer.combo_started_at = now;
            viewer.combo_started_ms = wall_ms;
            LikeComboStatus::Started
        } else {
            LikeComboStatus::Updated
        };

        viewer.observed_total = viewer.observed_total.saturating_add(count);
        viewer.combo_count = viewer.combo_count.saturating_add(count);
        viewer.last_update_at = now;
        viewer.last_update_ms = wall_ms;
        let viewer_id_after = viewer_id.clone();
        let viewer_observed = viewer.observed_total;
        let viewer_combo = viewer.combo_count;
        let combo_generation = viewer.combo_generation;
        let combo_duration_ms = wall_ms.saturating_sub(viewer.combo_started_ms);

        inner.room.observed_total = previous_room.saturating_add(count);
        inner.room.last_update_ms = wall_ms;
        if reported_total > 0 {
            match previous_reported {
                Some(previous) if reported_total < previous => {
                    // A decreasing room total is not a counter reset we can
                    // verify; keep the high-water mark and expose uncertainty.
                    inner.room.reported_monotonic = false;
                    inner.uncertainty = inner.uncertainty.saturating_add(1);
                }
                Some(previous) if reported_total > previous => {
                    inner.room.reported_total = Some(reported_total);
                }
                None => {
                    inner.room.reported_total = Some(reported_total);
                }
                _ => {}
            }
        }
        inner.accepted_batches = inner.accepted_batches.saturating_add(1);
        inner.processed_likes = inner.processed_likes.saturating_add(count);
        inner
            .viewer_order
            .retain(|candidate| candidate != &viewer_id_after);
        inner.viewer_order.push_back(viewer_id_after.clone());
        while inner.viewers.len() > MAX_VIEWERS {
            let Some(oldest) = inner.viewer_order.pop_front() else {
                break;
            };
            if oldest != viewer_id_after {
                inner.viewers.remove(&oldest);
            }
        }

        let room_observed = inner.room.observed_total;
        let room_reported = inner.room.reported_total;
        let session_id = inner
            .scope
            .as_ref()
            .map(LikeScopeKey::id)
            .unwrap_or_else(|| "unscoped".to_owned());
        let goals = evaluate_goals(
            &mut inner,
            &session_id,
            &viewer_id_after,
            combo_generation,
            previous_observed,
            viewer_observed,
            previous_combo,
            viewer_combo,
            previous_room,
            room_observed,
            previous_reported,
            room_reported,
        );
        inner.goal_crossings = inner
            .goal_crossings
            .saturating_add(goals.len() as u64);

        LikeObservation {
            accepted: true,
            viewer_id: viewer_id_after,
            batch_count: count,
            viewer_observed_total: viewer_observed,
            viewer_combo_count: viewer_combo,
            combo_status: status,
            combo_duration_ms,
            previous_combo_count: previous_combo,
            room_observed_total: room_observed,
            room_reported_total: room_reported,
            goals,
            timed_out,
        }
    }

    /// Sweeps idle combos. Called at most once per second from `observe`, and
    /// available directly to tests/lifecycle hooks.
    pub fn sweep_idle_combos(&self) -> Vec<LikeComboUpdate> {
        self.sweep_idle_combos_at(Instant::now())
    }

    pub fn sweep_idle_combos_at(&self, now: Instant) -> Vec<LikeComboUpdate> {
        let mut inner = recover_mutex(&self.inner, "like aggregation");
        let timeout = Duration::from_millis(inner.config.combo_idle_timeout_ms);
        let updates = sweep_locked(&mut inner, now, timeout);
        inner.last_sweep_at = now;
        updates
    }

    /// Marks accepted packet loss/order gaps for diagnostics.
    pub fn record_gap(&self, gaps: u64) {
        let mut inner = recover_mutex(&self.inner, "like aggregation");
        inner.gaps = inner.gaps.saturating_add(gaps);
    }

    pub fn stats(&self, limit: usize) -> LikeStats {
        let now = Instant::now();
        let mut inner = recover_mutex(&self.inner, "like aggregation");
        let timeout = Duration::from_millis(inner.config.combo_idle_timeout_ms);
        // Stats is an explicit snapshot: expiring here keeps the reported
        // active set honest without adding work to every event.
        sweep_locked(&mut inner, now, timeout);
        let mut viewers: Vec<LikeViewerAggregate> = inner
            .viewers
            .iter()
            .map(|(user_id, state)| LikeViewerAggregate {
                user_id: user_id.clone(),
                observed_total: state.observed_total,
                combo_count: state.combo_count,
                combo_generation: state.combo_generation,
                combo_active: state.combo_count > 0 && now.saturating_duration_since(state.last_update_at) <= timeout,
                combo_started_at: state.combo_started_ms,
                last_update_at: state.last_update_ms,
            })
            .collect();
        viewers.sort_by(|left, right| {
            right
                .observed_total
                .cmp(&left.observed_total)
                .then_with(|| left.user_id.cmp(&right.user_id))
        });
        let total_viewers = viewers.len() as u64;
        if limit > 0 {
            viewers.truncate(limit);
        }
        let active_combos = inner
            .viewers
            .values()
            .filter(|state| {
                state.combo_count > 0
                    && now.saturating_duration_since(state.last_update_at) <= timeout
            })
            .count() as u64;
        let scope = inner.scope.clone();
        LikeStats {
            enabled: inner.config.enabled,
            creator: scope.as_ref().map(|scope| scope.creator.clone()),
            room: scope.as_ref().map(|scope| scope.room.clone()),
            session: scope.as_ref().map(|scope| scope.session).unwrap_or(0),
            room_observed_total: inner.room.observed_total,
            room_reported_total: inner.room.reported_total,
            active_combos,
            total_viewers,
            viewers,
            accepted_batches: inner.accepted_batches,
            processed_likes: inner.processed_likes,
            goal_crossings: inner.goal_crossings,
            completed_milestones: inner.completed.len() as u64,
            gaps: inner.gaps,
            uncertainty: inner.uncertainty,
            last_update_at: inner.room.last_update_ms,
            combo_idle_timeout_ms: inner.config.combo_idle_timeout_ms,
            default_scope: inner.config.default_scope,
            config: inner.config.clone(),
            data_quality: LikeDataQuality {
                source: "accepted-native-like-events".to_owned(),
                exact: false,
                packet_loss_possible: true,
                reported_total_supported: inner.room.reported_total.is_some(),
                reported_total_monotonic: inner.room.reported_monotonic,
                note: "Observed totals count accepted packets exactly; upstream loss cannot be reconstructed. Reported total is TikTok's room counter, not a per-viewer value.".to_owned(),
            },
        }
    }

    /// Explicit reset with validated scope. Returns what was cleared.
    pub fn reset(
        &self,
        scope: LikeResetScope,
        viewer: Option<&str>,
    ) -> LikeResetResult {
        let mut inner = recover_mutex(&self.inner, "like aggregation");
        let viewer = viewer.map(normalize_viewer);
        let mut result = LikeResetResult {
            scope,
            viewers_reset: 0,
            combos_reset: 0,
            room_reset: false,
            goals_reset: 0,
        };
        match scope {
            LikeResetScope::All => {
                result.viewers_reset = inner.viewers.len() as u64;
                result.combos_reset = inner
                    .viewers
                    .values()
                    .filter(|state| state.combo_count > 0)
                    .count() as u64;
                result.goals_reset = inner.completed.len() as u64;
                result.room_reset = true;
                reset_inner(&mut inner, true, true, true);
            }
            LikeResetScope::Room => {
                result.room_reset = true;
                result.goals_reset = inner.completed.len() as u64;
                inner.room = RoomLikeState::default();
                inner.completed.clear();
                inner.completed_order.clear();
            }
            LikeResetScope::Viewer => {
                if let Some(viewer) = viewer.as_deref() {
                    if let Some(state) = inner.viewers.remove(viewer) {
                        result.viewers_reset = 1;
                        result.combos_reset = u64::from(state.combo_count > 0);
                        inner.viewer_order.retain(|candidate| candidate != viewer);
                    }
                } else {
                    result.viewers_reset = inner.viewers.len() as u64;
                    result.combos_reset = inner
                        .viewers
                        .values()
                        .filter(|state| state.combo_count > 0)
                        .count() as u64;
                    inner.viewers.clear();
                    inner.viewer_order.clear();
                }
            }
            LikeResetScope::Combo => {
                if let Some(viewer) = viewer.as_deref() {
                    if let Some(state) = inner.viewers.get_mut(viewer) {
                        if state.combo_count > 0 {
                            result.combos_reset = 1;
                        }
                        state.combo_count = 0;
                        state.combo_generation = state.combo_generation.saturating_add(1);
                        state.combo_started_at = Instant::now();
                        state.combo_started_ms = like_wall_millis();
                    }
                } else {
                    for state in inner.viewers.values_mut() {
                        if state.combo_count > 0 {
                            result.combos_reset = result.combos_reset.saturating_add(1);
                        }
                        state.combo_count = 0;
                        state.combo_generation = state.combo_generation.saturating_add(1);
                    }
                }
            }
            LikeResetScope::Goals => {
                result.goals_reset = inner.completed.len() as u64;
                inner.completed.clear();
                inner.completed_order.clear();
            }
        }
        result
    }
}

fn normalize_viewer(user_id: &str) -> String {
    let trimmed = user_id.trim().trim_start_matches('@');
    if trimmed.is_empty() {
        "anonymous".to_owned()
    } else {
        trimmed.to_owned()
    }
}

fn reset_inner(inner: &mut LikeInner, viewers: bool, room: bool, goals: bool) {
    if viewers {
        inner.viewers.clear();
        inner.viewer_order.clear();
    }
    if room {
        inner.room = RoomLikeState::default();
        inner.accepted_batches = 0;
        inner.processed_likes = 0;
        inner.goal_crossings = 0;
        inner.gaps = 0;
        inner.uncertainty = 0;
    }
    if goals {
        inner.completed.clear();
        inner.completed_order.clear();
    }
}

fn sweep_locked(
    inner: &mut LikeInner,
    now: Instant,
    timeout: Duration,
) -> Vec<LikeComboUpdate> {
    if now.saturating_duration_since(inner.last_sweep_at) < SWEEP_INTERVAL {
        return Vec::new();
    }
    inner.last_sweep_at = now;
    let mut updates = Vec::new();
    for (user_id, state) in inner.viewers.iter_mut() {
        if state.combo_count == 0 {
            continue;
        }
        if now.saturating_duration_since(state.last_update_at) > timeout {
            updates.push(LikeComboUpdate {
                user_id: user_id.clone(),
                count: state.combo_count,
                previous_count: 0,
                status: LikeComboStatus::TimedOut,
                duration_ms: now
                    .saturating_duration_since(state.combo_started_at)
                    .as_millis()
                    .min(u64::MAX as u128) as u64,
                scope: LikeGoalScope::ViewerCombo,
                complete: true,
            });
            state.combo_count = 0;
            state.combo_generation = state.combo_generation.saturating_add(1);
        }
    }
    // Deterministic order for diagnostics/automation.
    updates.sort_by(|left, right| left.user_id.cmp(&right.user_id));
    updates
}

#[allow(clippy::too_many_arguments)]
fn evaluate_goals(
    inner: &mut LikeInner,
    session_id: &str,
    viewer_id: &str,
    combo_generation: u64,
    previous_observed: u64,
    current_observed: u64,
    previous_combo: u64,
    current_combo: u64,
    previous_room: u64,
    current_room: u64,
    previous_reported: Option<u64>,
    current_reported: Option<u64>,
) -> Vec<LikeGoalCrossed> {
    let config = inner.config.clone();
    if !config.enabled {
        return Vec::new();
    }

    // `(target, scope, milestone id, repeatEvery)` in deterministic order.
    let mut goals: Vec<(u64, LikeGoalScope, String, Option<u64>)> = Vec::new();
    for target in &config.milestones {
        for scope in &config.goal_scopes {
            goals.push((
                *target,
                *scope,
                format!("like-{}-{target}", scope.as_str()),
                None,
            ));
        }
    }
    for goal in &config.goals {
        let scope = goal.scope.unwrap_or(config.default_scope);
        let id = goal
            .id
            .clone()
            .unwrap_or_else(|| format!("like-{}-{}", scope.as_str(), goal.target));
        goals.push((goal.target, scope, id, goal.repeat_every));
    }
    goals.sort_by(|left, right| {
        left.0
            .cmp(&right.0)
            .then_with(|| left.1.as_str().cmp(right.1.as_str()))
            .then_with(|| left.2.cmp(&right.2))
    });
    goals.dedup_by(|left, right| left.0 == right.0 && left.1 == right.1);

    let mut crossed = Vec::new();
    for (target, scope, milestone_id, repeat_every) in goals {
        let (previous, current) = match scope {
            LikeGoalScope::ViewerObserved => (previous_observed, current_observed),
            LikeGoalScope::ViewerCombo => (previous_combo, current_combo),
            LikeGoalScope::RoomObserved => (previous_room, current_room),
            LikeGoalScope::RoomReported => {
                let (Some(previous), Some(current)) = (previous_reported, current_reported)
                else {
                    // Unsupported/stale reported totals are never presented
                    // as authoritative goal progress.
                    continue;
                };
                (previous, current)
            }
        };
        if previous >= current {
            continue;
        }
        let mut thresholds = vec![target];
        if let Some(every) = repeat_every.filter(|every| *every > 0) {
            // Bounded re-arm: every additional `every` likes after the base
            // target. The loop is capped so a malicious jump cannot schedule
            // unbounded work.
            let mut next = target.saturating_add(every);
            let mut count = 0;
            while next <= current && count < 64 {
                if next > previous {
                    thresholds.push(next);
                }
                let Some(following) = next.checked_add(every) else {
                    break;
                };
                next = following;
                count += 1;
            }
            thresholds.retain(|threshold| *threshold > previous && *threshold <= current);
            thresholds.sort_unstable();
            thresholds.dedup();
        }
        for threshold in thresholds {
            if previous >= threshold || current < threshold {
                continue;
            }
            let identity = milestone_identity(
                session_id,
                scope,
                viewer_id,
                combo_generation,
                &milestone_id,
                threshold,
            );
            if !inner.completed.insert(identity.clone()) {
                continue;
            }
            inner.completed_order.push_back(identity);
            while inner.completed_order.len() > MAX_COMPLETED_MILESTONES {
                if let Some(oldest) = inner.completed_order.pop_front() {
                    inner.completed.remove(&oldest);
                }
            }
            crossed.push(LikeGoalCrossed {
                scope,
                viewer_id: scope.is_viewer().then(|| viewer_id.to_owned()),
                goal: threshold,
                previous,
                current,
                crossed: true,
                milestone_id: milestone_id.clone(),
                repeat_every,
            });
        }
    }
    crossed
}

/// Milestone identity policy:
/// * room scopes: session + milestone;
/// * viewer observed: session + viewer + milestone;
/// * viewer combo: session + viewer + combo generation + milestone.
/// Including the combo generation means a deliberately repeated goal in a new
/// combo is allowed, while replays inside one combo are suppressed.
fn milestone_identity(
    session_id: &str,
    scope: LikeGoalScope,
    viewer_id: &str,
    combo_generation: u64,
    milestone_id: &str,
    threshold: u64,
) -> String {
    match scope {
        LikeGoalScope::RoomObserved | LikeGoalScope::RoomReported => {
            format!("{session_id}|{}|{milestone_id}|{threshold}", scope.as_str())
        }
        LikeGoalScope::ViewerObserved => format!(
            "{session_id}|{}|{viewer_id}|{milestone_id}|{threshold}",
            scope.as_str()
        ),
        LikeGoalScope::ViewerCombo => format!(
            "{session_id}|{}|{viewer_id}|{combo_generation}|{milestone_id}|{threshold}",
            scope.as_str()
        ),
    }
}

fn like_wall_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn service() -> LikeAggregation {
        let service = LikeAggregation::default();
        service.enter_room("creator", "room");
        service
    }

    fn observe(
        service: &LikeAggregation,
        user: &str,
        count: u64,
        total: u64,
        at: Instant,
    ) -> LikeObservation {
        service.observe_at(user, count, total, at, at.elapsed().as_millis() as u64)
    }

    #[test]
    fn batches_sum_for_one_viewer() {
        let service = service();
        let base = Instant::now();
        for index in 0..4 {
            let update = observe(&service, "alice", 15, 15 * (index + 1), base + Duration::from_millis(100 * index as u64));
            assert!(update.accepted);
            assert_eq!(update.batch_count, 15);
        }
        let stats = service.stats(10);
        assert_eq!(stats.room_observed_total, 60);
        assert_eq!(stats.processed_likes, 60);
        assert_eq!(stats.viewers[0].observed_total, 60);
        assert_eq!(stats.viewers[0].combo_count, 60);
        assert_eq!(stats.active_combos, 1);
    }

    #[test]
    fn goal_uses_crossing_semantics_and_triggers_once() {
        let service = LikeAggregation::new_with_config(LikeAggregationConfig {
            default_scope: LikeGoalScope::ViewerCombo,
            milestones: vec![50, 100],
            goal_scopes: vec![LikeGoalScope::ViewerCombo],
            ..LikeAggregationConfig::default()
        })
        .unwrap();
        service.enter_room("creator", "room");
        let base = Instant::now();
        observe(&service, "alice", 15, 15, base);
        observe(&service, "alice", 15, 30, base + Duration::from_millis(10));
        observe(&service, "alice", 15, 45, base + Duration::from_millis(20));
        let crossing = observe(
            &service,
            "alice",
            15,
            60,
            base + Duration::from_millis(30),
        );
        assert_eq!(crossing.viewer_combo_count, 60);
        assert_eq!(crossing.goals.len(), 1);
        assert_eq!(crossing.goals[0].goal, 50);
        assert_eq!(crossing.goals[0].previous, 45);
        assert_eq!(crossing.goals[0].current, 60);
        // Replaying the same accepted batch (as a distinct count) does not
        // repeat the already completed milestone.
        let later = observe(
            &service,
            "alice",
            1,
            61,
            base + Duration::from_millis(40),
        );
        assert!(later.goals.is_empty());
        assert_eq!(service.stats(10).goal_crossings, 1);
    }

    #[test]
    fn large_jump_crosses_every_configured_milestone_once() {
        let service = LikeAggregation::new_with_config(LikeAggregationConfig {
            default_scope: LikeGoalScope::ViewerObserved,
            milestones: vec![50, 100],
            goal_scopes: vec![LikeGoalScope::ViewerObserved],
            ..LikeAggregationConfig::default()
        })
        .unwrap();
        service.enter_room("creator", "room");
        let base = Instant::now();
        observe(&service, "alice", 45, 45, base);
        let update = observe(&service, "alice", 75, 120, base + Duration::from_millis(10));
        let goals: Vec<u64> = update.goals.iter().map(|goal| goal.goal).collect();
        assert_eq!(goals, vec![50, 100]);
        assert!(update.goals.iter().all(|goal| goal.previous == 45 && goal.current == 120));
    }

    #[test]
    fn viewers_have_independent_combos_and_room_totals_are_global() {
        let service = service();
        let base = Instant::now();
        observe(&service, "alice", 15, 15, base);
        let bob = observe(&service, "bob", 15, 30, base + Duration::from_millis(10));
        assert_eq!(bob.viewer_combo_count, 15);
        let stats = service.stats(10);
        assert_eq!(stats.room_observed_total, 30);
        assert_eq!(stats.total_viewers, 2);
        assert_eq!(stats.active_combos, 2);
    }

    #[test]
    fn idle_timeout_closes_combo_and_next_event_starts_a_new_one() {
        let service = LikeAggregation::new_with_config(LikeAggregationConfig {
            combo_idle_timeout_ms: 500,
            ..LikeAggregationConfig::default()
        })
        .unwrap();
        service.enter_room("creator", "room");
        let base = Instant::now();
        let first = observe(&service, "alice", 15, 15, base);
        assert_eq!(first.combo_status, LikeComboStatus::Started);
        let late = observe(
            &service,
            "alice",
            15,
            30,
            base + Duration::from_millis(1_500),
        );
        assert_eq!(late.combo_status, LikeComboStatus::Started);
        assert_eq!(late.previous_combo_count, 0);
        assert_eq!(late.viewer_combo_count, 15);
        assert_eq!(late.viewer_observed_total, 30);
    }

    #[test]
    fn room_reported_total_is_never_summed_into_count() {
        let service = service();
        let base = Instant::now();
        let first = observe(&service, "alice", 15, 1_000, base);
        assert_eq!(first.room_observed_total, 15);
        assert_eq!(first.room_reported_total, Some(1_000));
        let second = observe(&service, "alice", 15, 1_015, base + Duration::from_millis(10));
        assert_eq!(second.room_observed_total, 30);
        assert_eq!(second.room_reported_total, Some(1_015));
        assert_eq!(second.viewer_observed_total, 30);
    }

    #[test]
    fn decreasing_reported_total_is_flagged_not_applied() {
        let service = service();
        let base = Instant::now();
        observe(&service, "alice", 15, 1_000, base);
        let update = observe(&service, "alice", 15, 900, base + Duration::from_millis(10));
        assert_eq!(update.room_reported_total, Some(1_000));
        let stats = service.stats(10);
        assert_eq!(stats.uncertainty, 1);
        assert!(!stats.data_quality.reported_total_monotonic);
    }

    #[test]
    fn counters_saturate_instead_of_overflowing() {
        let service = service();
        let base = Instant::now();
        let update = observe(&service, "alice", u64::MAX, u64::MAX, base);
        assert_eq!(update.viewer_observed_total, u64::MAX);
        let again = observe(
            &service,
            "alice",
            u64::MAX,
            u64::MAX,
            base + Duration::from_millis(10),
        );
        assert_eq!(again.viewer_observed_total, u64::MAX);
        assert_eq!(again.room_observed_total, u64::MAX);
    }

    #[test]
    fn room_change_isolates_state_reconnect_preserves_it() {
        let service = service();
        let base = Instant::now();
        observe(&service, "alice", 15, 15, base);
        assert!(!service.enter_room("creator", "room"));
        assert_eq!(service.stats(10).room_observed_total, 15);
        assert!(service.enter_room("creator", "other-room"));
        assert_eq!(service.stats(10).room_observed_total, 0);
        assert_eq!(service.stats(10).total_viewers, 0);
        assert!(service.enter_room("other-creator", "other-room"));
        assert_eq!(service.stats(10).session, 3);
    }

    #[test]
    fn reset_scopes_clear_only_what_was_asked() {
        let service = service();
        let base = Instant::now();
        observe(&service, "alice", 60, 60, base);
        let reset = service.reset(LikeResetScope::Combo, Some("alice"));
        assert_eq!(reset.combos_reset, 1);
        let stats = service.stats(10);
        assert_eq!(stats.viewers[0].observed_total, 60);
        assert_eq!(stats.viewers[0].combo_count, 0);
        let reset = service.reset(LikeResetScope::Viewer, Some("alice"));
        assert_eq!(reset.viewers_reset, 1);
        assert_eq!(service.stats(10).total_viewers, 0);
        assert_eq!(service.stats(10).room_observed_total, 60);
        service.reset(LikeResetScope::All, None);
        assert_eq!(service.stats(10).room_observed_total, 0);
    }

    #[test]
    fn very_large_milestone_jump_is_bounded() {
        let service = LikeAggregation::new_with_config(LikeAggregationConfig {
            default_scope: LikeGoalScope::ViewerObserved,
            milestones: vec![1],
            goal_scopes: vec![LikeGoalScope::ViewerObserved],
            goals: vec![LikeGoal {
                id: Some("repeat".to_owned()),
                target: 1,
                scope: Some(LikeGoalScope::ViewerObserved),
                repeat_every: Some(1),
            }],
            ..LikeAggregationConfig::default()
        })
        .unwrap();
        service.enter_room("creator", "room");
        let update = service.observe_at(
            "alice",
            10_000_000,
            10_000_000,
            Instant::now(),
            0,
        );
        assert!(update.goals.len() <= 66, "bounded goal emission");
    }

    #[test]
    fn config_update_validates_bounds() {
        let service = service();
        let config = service
            .update_config(LikeAggregationConfigUpdate {
                combo_idle_timeout_ms: Some(1),
                milestones: Some(vec![0, 50, 50, 100]),
                ..LikeAggregationConfigUpdate::default()
            })
            .unwrap();
        assert_eq!(config.combo_idle_timeout_ms, MIN_COMBO_IDLE_TIMEOUT_MS);
        assert_eq!(config.milestones, vec![50, 100]);
        assert!(service
            .update_config(LikeAggregationConfigUpdate {
                goals: Some(vec![LikeGoal {
                    id: None,
                    target: 0,
                    scope: None,
                    repeat_every: None,
                }]),
                ..LikeAggregationConfigUpdate::default()
            })
            .is_err());
    }
}
