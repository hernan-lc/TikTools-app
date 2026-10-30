//! Headless access to in-memory aggregation definitions and snapshots.
use super::OperationError;
use crate::{recover_mutex, AppCore};
use tiktools_aggregation::{model::Definition, Snapshot};

impl AppCore {
    /// Called while ranking and competition mutation locks are held in that
    /// order. A live competition must not lose or change its scoring source.
    fn ensure_ranking_not_in_use(&self, id: &str) -> Result<(), OperationError> {
        if self.competitions.load_failed {
            return Err(OperationError::unavailable(
                "competition definitions unavailable",
            ));
        }
        let ids: Vec<String> =
            recover_mutex(&self.competitions.definitions, "competition definitions")
                .values()
                .filter(|definition| definition.ranking_id == id)
                .map(|definition| definition.id.clone())
                .collect();
        for competition in ids {
            let state = self.competition_state(&competition)?;
            if matches!(
                state.lifecycle,
                tiktools_competitions::Lifecycle::Active
                    | tiktools_competitions::Lifecycle::Paused
                    | tiktools_competitions::Lifecycle::Finalizing
            ) {
                return Err(OperationError::conflict(
                    "ranking is used by an active competition",
                ));
            }
        }
        Ok(())
    }
    pub fn ranking_create(&self, definition: Definition) -> Result<(), OperationError> {
        let _mutation = recover_mutex(&self.aggregations.mutations, "ranking mutations");
        // Validate and check capacity before writing, without holding the hot-path
        // engine mutex during synchronous storage operations.
        let mut validation = tiktools_aggregation::engine::Engine::default();
        validation
            .create(definition.clone())
            .map_err(|_| OperationError::invalid("invalid ranking definition"))?;
        {
            let engine = recover_mutex(&self.aggregations.engine, "aggregations");
            let existing = engine.definitions();
            if existing.iter().any(|item| item.id == definition.id) {
                return Err(OperationError::conflict("ranking already exists"));
            }
            if existing.len() >= 128 {
                return Err(OperationError::unavailable("ranking capacity exhausted"));
            }
        }
        #[cfg(feature = "persistence")]
        if let Err(error) = self.db.insert_aggregation_definition(&definition) {
            tracing::error!(%error, "ranking definition persistence failed");
            return Err(OperationError::unavailable(
                "ranking definition persistence failed",
            ));
        }
        recover_mutex(&self.aggregations.engine, "aggregations")
            .create(definition)
            .map_err(|_| OperationError::unavailable("ranking creation failed"))
    }
    /// Updates are serialized with control mutations and require the ranking
    /// to be paused; score-affecting changes require an explicit reset.
    pub fn ranking_update(
        &self,
        definition: Definition,
        reset: bool,
    ) -> Result<(), OperationError> {
        let _mutation = recover_mutex(&self.aggregations.mutations, "ranking mutations");
        let _competition = recover_mutex(&self.competitions.mutations, "competition mutations");
        if reset {
            self.ensure_ranking_not_in_use(&definition.id)?;
        }
        recover_mutex(&self.aggregations.engine, "aggregations")
            .validate_update(&definition, reset)
            .map_err(|error| match error {
                tiktools_aggregation::engine::DefinitionError::NotFound => {
                    OperationError::not_found("ranking not found")
                }
                tiktools_aggregation::engine::DefinitionError::NotPaused => {
                    OperationError::conflict("pause ranking before updating")
                }
                tiktools_aggregation::engine::DefinitionError::ResetRequired => {
                    OperationError::conflict("score-affecting changes require reset")
                }
                _ => OperationError::invalid("invalid ranking update"),
            })?;
        let mut rankings = self.ranking_list();
        if let Some(existing) = rankings
            .iter_mut()
            .find(|ranking| ranking.id == definition.id)
        {
            *existing = definition.clone();
        }
        let index = crate::services::competitions::CompetitionService::build_index(
            &recover_mutex(&self.competitions.definitions, "competition definitions"),
            &rankings,
        )
        .map_err(|_| OperationError::unavailable("competition command index cannot be rebuilt"))?;
        #[cfg(feature = "persistence")]
        match self.db.update_aggregation_definition(&definition) {
            Ok(true) => {}
            Ok(false) => {
                return Err(OperationError::unavailable(
                    "ranking definition missing from storage",
                ))
            }
            Err(error) => {
                tracing::error!(%error, "ranking update failed");
                return Err(OperationError::unavailable("ranking update failed"));
            }
        }
        recover_mutex(&self.aggregations.engine, "aggregations")
            .update(definition, reset)
            .map_err(|_| OperationError::unavailable("ranking update failed"))?;
        *recover_mutex(
            &self.competitions.command_index,
            "competition command index",
        ) = index;
        Ok(())
    }
    pub fn ranking_list(&self) -> Vec<Definition> {
        recover_mutex(&self.aggregations.engine, "aggregations").definitions()
    }
    pub fn ranking_get(&self, id: &str) -> Result<Definition, OperationError> {
        self.ranking_list()
            .into_iter()
            .find(|item| item.id == id)
            .ok_or_else(|| OperationError::not_found("ranking not found"))
    }
    pub fn ranking_snapshot(&self, id: &str) -> Result<Snapshot, OperationError> {
        let (snapshot, limit) = {
            let mut engine = recover_mutex(&self.aggregations.engine, "aggregations");
            engine.expire_at(crate::now_millis());
            engine
                .snapshot_unranked(id)
                .ok_or_else(|| OperationError::not_found("ranking not found"))?
        };
        Ok(snapshot.rank(limit))
    }
    pub fn ranking_reset(&self, id: &str) -> Result<(), OperationError> {
        let _mutation = recover_mutex(&self.aggregations.mutations, "ranking mutations");
        let _competition = recover_mutex(&self.competitions.mutations, "competition mutations");
        self.ensure_ranking_not_in_use(id)?;
        if !recover_mutex(&self.aggregations.engine, "aggregations")
            .definitions()
            .iter()
            .any(|definition| definition.id == id)
        {
            return Err(OperationError::not_found("ranking not found"));
        }
        // Clear durable state first: a crash after the in-memory reset must
        // not restore the discarded scores from an older runtime checkpoint.
        #[cfg(feature = "persistence")]
        if let Err(error) = self.db.clear_aggregation_checkpoint(id) {
            tracing::error!(%error, "ranking checkpoint clear failed");
            return Err(OperationError::unavailable("ranking reset failed"));
        }
        recover_mutex(&self.aggregations.engine, "aggregations")
            .reset(id)
            .ok_or_else(|| OperationError::not_found("ranking not found"))?
            .map_err(|_| OperationError::unavailable("ranking revision overflow"))
    }
    pub fn ranking_pause(&self, id: &str, paused: bool) -> Result<(), OperationError> {
        let _mutation = recover_mutex(&self.aggregations.mutations, "ranking mutations");
        let _competition = recover_mutex(&self.competitions.mutations, "competition mutations");
        if paused {
            self.ensure_ranking_not_in_use(id)?;
        }
        recover_mutex(&self.aggregations.engine, "aggregations")
            .set_paused(id, paused)
            .ok_or_else(|| OperationError::not_found("ranking not found"))?
            .map_err(|_| OperationError::unavailable("ranking revision overflow"))
    }
    pub fn ranking_delete(&self, id: &str) -> Result<(), OperationError> {
        let _mutation = recover_mutex(&self.aggregations.mutations, "ranking mutations");
        if self.competitions.load_failed {
            return Err(OperationError::unavailable(
                "competition definitions unavailable",
            ));
        }
        if recover_mutex(&self.competitions.definitions, "competition definitions")
            .values()
            .any(|definition| definition.ranking_id == id)
        {
            return Err(OperationError::conflict("ranking is used by a competition"));
        }
        if !recover_mutex(&self.aggregations.engine, "aggregations")
            .definitions()
            .iter()
            .any(|definition| definition.id == id)
        {
            return Err(OperationError::not_found("ranking not found"));
        }
        #[cfg(feature = "persistence")]
        match self.db.delete_aggregation_definition(id) {
            Ok(true) => {}
            Ok(false) => {
                return Err(OperationError::unavailable(
                    "ranking definition missing from storage",
                ))
            }
            Err(error) => {
                tracing::error!(%error, "ranking deletion failed");
                return Err(OperationError::unavailable("ranking deletion failed"));
            }
        }
        recover_mutex(&self.aggregations.engine, "aggregations").remove(id);
        Ok(())
    }
}
