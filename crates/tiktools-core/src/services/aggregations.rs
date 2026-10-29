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
        let claim = getrandom::fill(&mut bytes)
            .ok()
            .map(|()| {
                bytes
                    .iter()
                    .map(|byte| format!("{byte:02x}"))
                    .collect::<String>()
            })
            .and_then(|owner| match db.claim_aggregation_checkpoints(&owner) {
                Ok(clean) => Some((owner, clean)),
                Err(error) => {
                    tracing::error!(%error, "cannot claim aggregation checkpoints");
                    None
                }
            });
        let previous_clean = claim.as_ref().is_some_and(|(_, clean)| *clean);
        let checkpoint_owner = claim.map(|(owner, _)| owner);
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
        // Consume ordinary session checkpoints before admission begins. Vote
        // rankings are rebuilt separately from their authoritative ledger.
        {
            for definition in engine.definitions() {
                if definition
                    .sources
                    .iter()
                    .any(|source| source.source == "competition.vote")
                {
                    continue;
                }
                let recovered = match checkpoint_owner
                    .as_deref()
                    .map(|owner| db.take_aggregation_checkpoint(&definition.id, owner))
                {
                    None => false,
                    Some(Ok(Some(checkpoint))) => {
                        if let Err(error) = engine.restore_session_checkpoint(&checkpoint) {
                            tracing::error!(?error, ranking = %definition.id, "invalid aggregation checkpoint");
                            false
                        } else {
                            true
                        }
                    }
                    Some(Ok(None)) => false,
                    Some(Err(error)) => {
                        tracing::error!(%error, ranking = %definition.id, "cannot recover aggregation checkpoint");
                        false
                    }
                };
                if !previous_clean || !recovered {
                    if let Err(error) = engine.mark_recovery_gap(&definition.id) {
                        tracing::error!(?error, ranking = %definition.id, "cannot mark ranking recovery gap");
                    }
                }
            }
        }
        // Command-vote rankings are reconstructed from committed participant assignments.
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

    #[cfg(feature = "persistence")]
    pub(crate) fn checkpoint_shutdown(
        core: &crate::AppCore,
    ) -> Result<(), crate::db::DatabaseError> {
        let _mutation = crate::recover_mutex(&core.aggregations.mutations, "ranking mutations");
        let owner = core
            .aggregations
            .checkpoint_owner
            .as_deref()
            .ok_or_else(|| {
                crate::db::DatabaseError::Invalid("aggregation checkpoint owner unavailable".into())
            })?;
        #[cfg(feature = "native-tiktok")]
        let ingress_complete = !core.live_ingress_stop.is_cancelled()
            && core
                .live_ingress
                .cancelled
                .load(std::sync::atomic::Ordering::Relaxed)
                == 0
            && core
                .live_ingress
                .abandoned
                .load(std::sync::atomic::Ordering::Relaxed)
                == 0
            && core
                .live_ingress
                .admission_cancelled
                .load(std::sync::atomic::Ordering::Relaxed)
                == 0;
        #[cfg(not(feature = "native-tiktok"))]
        let ingress_complete = true;
        let definitions = {
            let mut engine = crate::recover_mutex(&core.aggregations.engine, "aggregations");
            if !ingress_complete {
                engine.mark_ingress_loss(1);
            }
            engine
                .definitions()
                .into_iter()
                .filter(|definition| {
                    !definition
                        .sources
                        .iter()
                        .any(|source| source.source == "competition.vote")
                })
                .collect::<Vec<_>>()
        };
        // Materialize one bounded ranking at a time. A large number of
        // high-cardinality definitions must not multiply snapshot memory.
        let mut first_error = None;
        for definition in definitions {
            let checkpoint = crate::recover_mutex(&core.aggregations.engine, "aggregations")
                .session_checkpoint(&definition.id);
            match checkpoint {
                Ok(checkpoint) => {
                    if let Err(error) = core.db.save_aggregation_checkpoint(&checkpoint, owner) {
                        tracing::error!(%error, ranking = %definition.id, "aggregation checkpoint failed");
                        if first_error.is_none() {
                            first_error = Some(error);
                        }
                    }
                }
                Err(tiktools_aggregation::Error::IncompatibleDefinition) => {}
                Err(error) => {
                    tracing::error!(?error, ranking = %definition.id, "aggregation snapshot failed");
                    if first_error.is_none() {
                        first_error = Some(crate::db::DatabaseError::Invalid(
                            "aggregation snapshot failed".into(),
                        ));
                    }
                }
            }
        }
        if let Some(error) = first_error {
            return Err(error);
        }
        core.db.finish_aggregation_checkpoints(owner)?;
        Ok(())
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
