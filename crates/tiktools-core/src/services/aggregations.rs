//! State owned by AppCore; native ingestion and control operations share it.
use std::sync::Mutex;
use tiktools_aggregation::engine::Engine;
#[cfg(feature = "native-tiktok")]
use tiktools_aggregation::model::Contribution;

#[derive(Default)]
pub(crate) struct AggregationService {
    pub(crate) engine: Mutex<Engine>,
    pub(crate) mutations: Mutex<()>,
    #[cfg(feature = "persistence")]
    pub(crate) checkpoint_owner: Option<String>,
}

impl AggregationService {
    #[cfg(feature = "persistence")]
    pub(crate) fn restore(db: &crate::db::DatabaseManager) -> Self {
        let mut bytes = [0u8; 16];
        let checkpoint_owner = getrandom::fill(&mut bytes).ok().map(|()| {
            bytes
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        });
        let mut engine = Engine::default();
        match db.load_aggregation_definitions() {
            Ok(definitions) => {
                for definition in definitions {
                    if let Err(error) = engine.create(definition) {
                        tracing::error!(?error, "cannot restore ranking definition");
                    }
                }
            }
            Err(error) => tracing::error!(%error, "cannot load ranking definitions"),
        }
        // Command-vote rankings are reconstructed from committed participant
        // assignments; other rankings retain their existing in-memory scope.
        match db.load_competition_definitions() {
            Ok(competitions) => {
                let mut used = std::collections::HashSet::new();
                for competition in competitions {
                    let Some(ranking) = engine
                        .definitions()
                        .into_iter()
                        .find(|r| r.id == competition.ranking_id)
                    else {
                        continue;
                    };
                    let vote_ranking = ranking
                        .sources
                        .iter()
                        .any(|source| source.source == "competition.vote");
                    if vote_ranking && !used.insert(ranking.id.clone()) {
                        tracing::error!(ranking = %ranking.id, "multiple competitions share a durable vote ranking");
                        engine.mark_gap(&ranking.creator_id, &ranking.room_id, "competition.vote");
                        continue;
                    }
                    let restored = db
                        .load_competition_state(&competition.id)
                        .and_then(|state| {
                            let state = state.ok_or_else(|| {
                                crate::db::DatabaseError::Invalid(
                                    "competition state missing".into(),
                                )
                            })?;
                            let needs_checkpoint = matches!(
                                state.lifecycle,
                                tiktools_competitions::Lifecycle::Active
                                    | tiktools_competitions::Lifecycle::Paused
                                    | tiktools_competitions::Lifecycle::Finalizing
                            );
                            let clean = if needs_checkpoint {
                                match checkpoint_owner.as_deref() {
                                    Some(owner) => db.begin_competition_recovery(
                                        &competition.id,
                                        state.generation,
                                        owner,
                                    )?,
                                    None => false,
                                }
                            } else {
                                true
                            };
                            let totals = if vote_ranking {
                                db.competition_vote_totals(&competition.id, state.generation)?
                            } else {
                                Vec::new()
                            };
                            let scores = if vote_ranking {
                                db.competition_scored_totals(&competition.id, state.generation)?
                            } else {
                                Vec::new()
                            };
                            Ok((totals, scores, clean))
                        });
                    match restored {
                        Ok((totals, scores, clean)) => {
                            if !vote_ranking {
                                continue;
                            }
                            if !clean {
                                tracing::warn!(ranking = %ranking.id, "unclean competition restart; accounting completeness unknown");
                                engine.mark_gap(
                                    &ranking.creator_id,
                                    &ranking.room_id,
                                    "competition.vote",
                                );
                            }
                            if let Err(error) = engine.restore_assignments_with_scores(
                                &ranking.id,
                                &totals,
                                &scores,
                            ) {
                                tracing::error!(?error, ranking = %ranking.id, "cannot restore competition vote ranking");
                                engine.mark_gap(
                                    &ranking.creator_id,
                                    &ranking.room_id,
                                    "competition.vote",
                                );
                            } else {
                                for option in &competition.options {
                                    let metadata = tiktools_aggregation::EntryMetadata {
                                        label: Some(option.label.clone()),
                                        icon_url: option.image_url.clone(),
                                        ..Default::default()
                                    };
                                    if engine
                                        .set_entry_metadata(&ranking.id, &option.id, &metadata)
                                        .is_err()
                                    {
                                        engine.mark_gap(
                                            &ranking.creator_id,
                                            &ranking.room_id,
                                            "competition.vote",
                                        );
                                    }
                                }
                            }
                        }
                        Err(error) => {
                            tracing::error!(%error, ranking = %ranking.id, "cannot load competition vote ranking");
                            engine.mark_gap(
                                &ranking.creator_id,
                                &ranking.room_id,
                                "competition.vote",
                            );
                        }
                    }
                }
            }
            Err(error) => tracing::error!(%error, "cannot load competitions for ranking recovery"),
        }
        Self {
            engine: Mutex::new(engine),
            mutations: Mutex::new(()),
            checkpoint_owner,
        }
    }

    #[cfg(feature = "native-tiktok")]
    pub(crate) fn ingress_loss(&self, count: u64) {
        crate::recover_mutex(&self.engine, "aggregations").mark_ingress_loss(count);
    }

    #[cfg(feature = "native-tiktok")]
    pub(crate) fn mark_gap(&self, creator: &str, room: &str, source: &str) {
        crate::recover_mutex(&self.engine, "aggregations").mark_gap(creator, room, source);
    }

    #[cfg(feature = "native-tiktok")]
    pub(crate) fn metric_gap(&self, creator: &str, room: &str, source: &str, metric: &str) {
        crate::recover_mutex(&self.engine, "aggregations")
            .mark_metric_gap(creator, room, source, metric);
    }

    #[cfg(feature = "native-tiktok")]
    pub(crate) fn observe(
        &self,
        contribution: Contribution<'_>,
        user: Option<&tiktools_aggregation::EntryMetadata>,
        gift: Option<&tiktools_aggregation::EntryMetadata>,
    ) {
        let mut engine = crate::recover_mutex(&self.engine, "aggregations");
        for (ranking, error) in
            engine.apply_at_with_metadata(&contribution, crate::now_millis(), user, gift)
        {
            tracing::warn!(%ranking, ?error, "ranking contribution rejected");
        }
    }
}
