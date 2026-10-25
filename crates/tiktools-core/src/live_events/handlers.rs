use crate::*;
#[cfg(all(feature = "native-tiktok", feature = "persistence"))]
use std::time::Duration;

impl AppCore {
    #[cfg(feature = "native-tiktok")]
    pub(crate) async fn handle_native_event(self: &Arc<Self>, event: ClientEvent) {
        match event {
            ClientEvent::Connected(info) => {
                let generation = self.connection_sequence.load(Ordering::Acquire);
                self.publish_disconnected_event().await;
                if self.live.connection_snapshot().generation == generation {
                    self.handle_connected(info).await;
                }
            }
            ClientEvent::Event(event) => self.handle_live_event(event).await,
            ClientEvent::Reconnecting { attempt, delay_ms } => {
                // Domain topic only: the legacy push was removed once the
                // frontend migrated to `live.reconnecting`.
                self.events
                    .publish_domain(crate::events::DomainEvent::LiveReconnecting {
                        attempt,
                        delay_ms,
                    });
            }
            ClientEvent::Disconnected { reason } => {
                let generation = self.live.connection_snapshot().generation;
                self.publish_disconnected_event().await;
                if self.live.connection_snapshot().generation != generation {
                    return;
                }
                // Native drops publish the same domain events as an explicit
                // RPC disconnect so every origin converges on one topic.
                self.events
                    .publish_domain(crate::events::DomainEvent::LiveDisconnected);
                self.events
                    .publish_domain(crate::events::DomainEvent::CreatorChanged { unique_id: None });
                tracing::info!(%reason, "TikTok live disconnected");
            }
            ClientEvent::Error { phase, message } => {
                let phase_name = match phase {
                    tiktools_tiktok::ErrorPhase::Connect => "connect",
                    tiktools_tiktok::ErrorPhase::Live => "live",
                };
                self.events
                    .publish_domain(crate::events::DomainEvent::LiveError {
                        phase: phase_name.to_owned(),
                        message,
                    });
            }
        }
    }
    #[cfg(feature = "native-tiktok")]
    pub(crate) async fn handle_connected(self: &Arc<Self>, info: tiktools_tiktok::ConnectionInfo) {
        self.live_dedup.set_scope(&info.unique_id, &info.room_id);
        self.likes.enter_room(&info.unique_id, &info.room_id);
        self.gift_streaks.enter_room(
            &info.unique_id,
            &info.room_id,
            self.connection_sequence.load(Ordering::Acquire),
        );
        let sequence = self.connection_sequence.load(Ordering::Acquire);
        let context = LiveContext {
            unique_id: info.unique_id.clone(),
            room_id: info.room_id.clone(),
            connection_id: format!("connection-{sequence}"),
        };
        *recover_rwlock_write(&self.connection_context, "connection context") =
            Some(context.clone());

        #[cfg(feature = "persistence")]
        self.write_live_session(&info.unique_id, Some(info.room_id.as_str()), true)
            .await;

        let gifts = info
            .gifts
            .iter()
            .map(|gift| {
                json!({
                    "id": gift.id,
                    "name": gift.name,
                    "diamondCount": gift.diamond_count,
                    "iconUrl": gift.icon_url,
                })
            })
            .collect::<Vec<_>>();

        #[cfg(feature = "persistence")]
        let app_state = {
            let database = Arc::clone(&self.db);
            let info_for_db = info.clone();
            let gifts_for_db = gifts.clone();
            match tokio::time::timeout(
                Duration::from_secs(2),
                tokio::task::spawn_blocking(move || {
                    // Creator/creator-list reads fed only the removed legacy
                    // pushes; the frontend now refreshes via RPC on
                    // `creator.changed`. The writes below are still needed.
                    if let Err(error) = database.save_creator(
                        &info_for_db.unique_id,
                        Some(&info_for_db.room_id),
                        Some(&info_for_db.nickname),
                        info_for_db.avatar_url.as_deref(),
                        Some(&info_for_db.title),
                        Some(&info_for_db.unique_id),
                    ) {
                        tracing::warn!(%error, "could not persist connected creator");
                    }
                    let app_state = database
                        .load_app_state()
                        .ok()
                        .map(|values| {
                            values
                                .into_iter()
                                .filter_map(|(key, value)| {
                                    value.as_str().map(|value| (key, value.to_owned()))
                                })
                                .collect::<std::collections::BTreeMap<_, _>>()
                        })
                        .unwrap_or_default();
                    if let Err(error) = database.save_gift_catalog(&gifts_for_db) {
                        tracing::warn!(%error, "could not persist TikTok gift catalog");
                    }
                    app_state
                }),
            )
            .await
            {
                Ok(Ok(values)) => values,
                Ok(Err(error)) => {
                    tracing::error!(%error, "connection persistence worker failed");
                    std::collections::BTreeMap::new()
                }
                Err(_) => {
                    tracing::warn!(
                        "connection persistence exceeded 2 seconds; continuing live event delivery"
                    );
                    std::collections::BTreeMap::new()
                }
            }
        };

        #[cfg(not(feature = "persistence"))]
        let app_state = std::collections::BTreeMap::new();

        if self.live.connection_snapshot().generation != sequence {
            return;
        }
        self.events
            .publish_domain(crate::events::DomainEvent::LiveConnected {
                unique_id: Some(info.unique_id.clone()),
                room_id: Some(info.room_id.clone()),
            });
        self.events
            .publish_domain(crate::events::DomainEvent::CreatorChanged {
                unique_id: Some(info.unique_id.clone()),
            });

        // Connection/creator state travels on `live.connected` plus
        // `creator.changed` now; their legacy pushes were removed with the
        // rest of the migrated duplicates.
        self.emit(HostMessage::AppState { state: app_state });
        self.emit(HostMessage::PointsConfig {
            config: self.points.config(),
        });
        self.emit_leaderboard_if_due();

        self.events
            .publish_domain(crate::events::DomainEvent::GiftsCatalog { gifts });

        self.queue_automation_event(
            self.make_automation_event(
                "tiktok.connected",
                serde_json::to_value(crate::contracts::ConnectionAutomationData {
                    unique_id: info.unique_id,
                    room_id: info.room_id,
                })
                .expect("connection automation data must serialize"),
                None,
            ),
        );
    }
    #[cfg(feature = "native-tiktok")]
    pub(crate) async fn handle_live_event(self: &Arc<Self>, event: NativeLiveEvent) {
        // Canonical replay guard: one choke point before points,
        // analytics, automation, and UI fan out, so a replay is either
        // fully applied or fully skipped everywhere. The frontend keeps
        // its own guard as defense in depth.
        if self.live_dedup.check_duplicate(&event) {
            tracing::debug!(
                msg_id = event.msg_id(),
                "skipping replayed live event; no side effects applied"
            );
            return;
        }
        // Gift streaks are owned by one state machine. `timedOut` transitions
        // are reported explicitly and never award, while duplicate finals are
        // suppressed before any feed/points/automation side effect.
        let timed_out_gifts = self.gift_streaks.sweep_idle();
        let gift_streak = self.gift_streaks.observe(&event);
        if gift_streak.as_ref().is_some_and(|streak| streak.duplicate) {
            tracing::debug!(
                msg_id = event.msg_id(),
                "skipping replayed gift finalization; no side effects applied"
            );
            return;
        }
        // Authoritative LIKE aggregation happens before fan-out so points,
        // raw like automations, derived goals, and every client see one state.
        let like_observation = self.like_observation(&event);
        let automation_event = self.normalize_native_event(&event);
        let Some((mut ui_event, action, options, reason)) =
            self.ui_event_and_points_with_gift(&event, gift_streak.as_ref())
        else {
            if let Some(event) = automation_event {
                self.queue_automation_event(event);
            }
            self.queue_derived_live_events(
                &event,
                like_observation.as_ref(),
                gift_streak.as_ref(),
                &timed_out_gifts,
            );
            if let tiktools_tiktok::events::CanonicalLiveEvent::RoomUser(room) = &event.base {
                // Upstream fills both rank lists from the same contributors;
                // prefer `top_viewers`, fall back to `ranked_viewers`.
                let ranked = if room.top_viewers.is_empty() {
                    &room.ranked_viewers
                } else {
                    &room.top_viewers
                };
                let top_viewers = ranked
                    .iter()
                    .take(25)
                    .map(top_viewer_value)
                    .collect::<Vec<_>>();
                self.events
                    .publish_domain(crate::events::DomainEvent::RoomStats {
                        viewers: room.total,
                        total_users: room.total_user,
                        top_viewers,
                    });
                #[cfg(feature = "persistence")]
                self.record_analytics_viewers(room.total).await;
            }
            return;
        };

        #[cfg(feature = "persistence")]
        self.record_analytics_event(&event).await;

        let should_award = match &event.base {
            tiktools_tiktok::events::CanonicalLiveEvent::EmoteChat(_) => false,
            tiktools_tiktok::events::CanonicalLiveEvent::Gift(_) => gift_streak
                .as_ref()
                .is_some_and(|streak| streak.should_award),
            _ => true,
        };
        let point_award = if should_award {
            let unique_id = ui_event["author"].as_str().unwrap_or("viewer").to_owned();
            match self
                .live_points_work
                .award(unique_id, action, options)
                .await
            {
                Ok(award) => award,
                Err(error) => {
                    tracing::error!(%error, "LIVE points work was not completed");
                    self.record_event_gap();
                    None
                }
            }
        } else {
            None
        };
        if let Some(award) = point_award.as_ref() {
            if let Some(object) = ui_event.as_object_mut() {
                object.insert("points".to_owned(), json!(award.total_points));
                object.insert("level".to_owned(), json!(award.level));
                object.insert("pointsDelta".to_owned(), json!(award.delta));
            }
            // Live awards publish the same topic as manual/automation/plugin
            // adjustments so every origin converges on `points.changed`.
            // The legacy push was removed with the migrated duplicates.
            self.events
                .publish_domain(crate::events::DomainEvent::PointsChanged {
                    unique_id: award.unique_id.clone(),
                    delta: award.delta,
                    total_points: award.total_points,
                    level: award.level,
                });
        }
        if let Some(event) = automation_event {
            let mut event = event;
            if let Some(award) = point_award.as_ref() {
                if let Some(object) = event.as_object_mut() {
                    object.insert(
                        "points".to_owned(),
                        serde_json::to_value(crate::contracts::AutomationPoints {
                            delta: award.delta,
                            total: award.total_points,
                            level: award.level,
                        })
                        .expect("automation points must serialize"),
                    );
                }
            }
            self.queue_automation_event(event);
            if let Some(award) = point_award.as_ref().filter(|award| award.delta != 0.0) {
                self.queue_automation_event(
                    self.make_automation_event(
                        "points.awarded",
                        serde_json::to_value(crate::contracts::PointsAwardedAutomationData {
                            unique_id: award.unique_id.clone(),
                            delta: award.delta,
                            total_points: award.total_points,
                            level: award.level,
                            currency_name: award.currency_name.clone(),
                            reason: reason.to_owned(),
                        })
                        .expect("points awarded automation data must serialize"),
                        None,
                    ),
                );
            }
        }
        self.queue_derived_live_events(
            &event,
            like_observation.as_ref(),
            gift_streak.as_ref(),
            &timed_out_gifts,
        );
        // The UI-ready event goes out on the domain bus (authoritative for
        // WebView/IPC/CLI); the legacy push was removed with the migrated
        // duplicates.
        self.live_ingress
            .ui_published
            .fetch_add(1, Ordering::Relaxed);
        if ui_event["kind"] == "gift" {
            self.live_ingress.ui_gifts.fetch_add(1, Ordering::Relaxed);
            if !ui_event["giftDetails"]["imageUrl"].is_string() {
                self.live_ingress
                    .gifts_without_artwork
                    .fetch_add(1, Ordering::Relaxed);
            }
        }
        tracing::debug!(method = event.method(), msg_id = %event.msg_id(), ui_kind = %ui_event["kind"], "publishing LIVE UI event");
        self.events
            .publish_domain(crate::events::DomainEvent::LiveUiEvent { event: ui_event });
        self.emit_leaderboard_if_due();
    }

    /// Feeds one native LIKE event into the authoritative aggregator.
    #[cfg(feature = "native-tiktok")]
    fn like_observation(
        &self,
        event: &NativeLiveEvent,
    ) -> Option<crate::live_events::like_aggregation::LikeObservation> {
        let tiktools_tiktok::events::CanonicalLiveEvent::Like(like) = &event.base else {
            return None;
        };
        Some(self.likes.observe(
            &like.user.unique_id,
            like.count,
            like.total,
        ))
    }

    /// Publishes derived combo/goal triggers without changing the raw
    /// `tiktok.like` / `tiktok.gift` contract.
    #[cfg(feature = "native-tiktok")]
    fn queue_derived_live_events(
        self: &Arc<Self>,
        event: &NativeLiveEvent,
        like: Option<&crate::live_events::like_aggregation::LikeObservation>,
        gift: Option<&crate::live_events::gift_streak::GiftStreakUpdate>,
        timed_out_gifts: &[crate::live_events::gift_streak::GiftStreakUpdate],
    ) {
        let method = event.method().to_owned();
        let msg_id = event.msg_id().to_string();
        let is_history = event.is_history();
        if let Some(observation) = like {
            let user = match &event.base {
                tiktools_tiktok::events::CanonicalLiveEvent::Like(like) => {
                    Some(user_value(&like.user))
                }
                _ => None,
            };
            let config = self.likes.config();
            if config.emit_intermediate_updates || observation.combo_status.complete() {
                self.queue_automation_event(self.make_automation_event(
                    "tiktok.like.combo",
                    serde_json::to_value(crate::contracts::LikeComboAutomationData {
                        user_id: observation.viewer_id.clone(),
                        count: observation.viewer_combo_count,
                        previous_count: observation.previous_combo_count,
                        status: observation.combo_status.as_str().to_owned(),
                        duration_ms: observation.combo_duration_ms,
                        scope: "viewer_combo".to_owned(),
                        complete: observation.combo_status.complete(),
                        method: method.clone(),
                        msg_id: msg_id.clone(),
                        is_history,
                    })
                    .expect("like combo data must serialize"),
                    user.clone(),
                ));
            }
            for update in &observation.timed_out {
                let user = Some(synthetic_user(&update.user_id));
                self.queue_automation_event(self.make_automation_event(
                    "tiktok.like.combo",
                    serde_json::to_value(crate::contracts::LikeComboAutomationData {
                        user_id: update.user_id.clone(),
                        count: update.count,
                        previous_count: update.previous_count,
                        status: update.status.as_str().to_owned(),
                        duration_ms: update.duration_ms,
                        scope: update.scope.as_str().to_owned(),
                        complete: true,
                        method: method.clone(),
                        msg_id: msg_id.clone(),
                        is_history,
                    })
                    .expect("like combo timeout data must serialize"),
                    user,
                ));
            }
            for goal in &observation.goals {
                self.queue_automation_event(self.make_automation_event(
                    "tiktok.like.goal",
                    serde_json::to_value(crate::contracts::LikeGoalAutomationData {
                        scope: goal.scope.as_str().to_owned(),
                        viewer_id: goal.viewer_id.clone(),
                        goal: goal.goal,
                        previous: goal.previous,
                        current: goal.current,
                        crossed: goal.crossed,
                        milestone_id: goal.milestone_id.clone(),
                        method: method.clone(),
                        msg_id: msg_id.clone(),
                        is_history,
                    })
                    .expect("like goal data must serialize"),
                    user.clone(),
                ));
            }
            // One authoritative snapshot per accepted batch on the lossy lane.
            self.events
                .publish_domain(crate::events::DomainEvent::LikeStatsUpdated {
                    stats: json!(self.likes.stats(0)),
                });
        }
        if let Some(gift) = gift {
            let user = event.user().map(user_value);
            self.queue_automation_event(self.make_automation_event(
                "tiktok.gift.combo",
                serde_json::to_value(crate::contracts::GiftComboAutomationData {
                    gift_id: gift.gift_id.clone(),
                    gift_name: gift.gift_name.clone(),
                    group_id: gift.group_id.clone(),
                    count: gift.count,
                    previous_count: gift.previous_count,
                    diamonds_each: gift.diamonds_each,
                    total_diamonds: gift.total_diamonds,
                    status: gift.status.as_str().to_owned(),
                    complete: gift.complete,
                    classification: gift.classification.as_str().to_owned(),
                    method: method.clone(),
                    msg_id: msg_id.clone(),
                    is_history,
                })
                .expect("gift combo data must serialize"),
                user,
            ));
        }
        for gift in timed_out_gifts {
            self.queue_automation_event(self.make_automation_event(
                "tiktok.gift.combo",
                serde_json::to_value(crate::contracts::GiftComboAutomationData {
                    gift_id: gift.gift_id.clone(),
                    gift_name: gift.gift_name.clone(),
                    group_id: gift.group_id.clone(),
                    count: gift.count,
                    previous_count: gift.previous_count,
                    diamonds_each: gift.diamonds_each,
                    total_diamonds: gift.total_diamonds,
                    status: gift.status.as_str().to_owned(),
                    complete: true,
                    classification: gift.classification.as_str().to_owned(),
                    method: method.clone(),
                    msg_id: String::new(),
                    is_history: false,
                })
                .expect("gift combo timeout data must serialize"),
                None,
            ));
        }
    }
}

/// Minimal identity for timeout notifications, which arrive outside an event
/// envelope and therefore carry no full user record.
#[cfg(feature = "native-tiktok")]
fn synthetic_user(unique_id: &str) -> serde_json::Value {
    user_value(&tiktools_tiktok::events::EventUser {
        id: 0,
        unique_id: unique_id.to_owned(),
        nickname: unique_id.to_owned(),
        sec_uid: String::new(),
        avatar_url: None,
    })
}
