//! Bounded routing index for canonical chat commands.
use crate::{Definition, Error};
use std::collections::{BTreeMap, BTreeSet, HashMap};

const MAX_COMPETITIONS: usize = 128;
const MAX_ROUTES: usize = 32_768;
const MAX_ROUTES_PER_COMPETITION: usize = 2_048;
type RouteKey = (String, String, String);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommandRoute {
    pub competition_id: String,
    pub option_id: String,
}

/// Maps one complete command and scope to all matching competitions. The
/// index does not accept votes or perform accounting; lifecycle and replay
/// admission remain the responsibility of the durable ordered worker.
#[derive(Clone, Default)]
pub struct CommandIndex {
    routes: HashMap<RouteKey, BTreeMap<String, String>>,
    registrations: HashMap<String, Vec<RouteKey>>,
    route_count: usize,
    source_routes: HashMap<RouteKey, BTreeSet<String>>,
    source_registrations: HashMap<String, Vec<RouteKey>>,
}
impl CommandIndex {
    /// Atomically replace one definition's routes. On error the previous
    /// registration remains intact. Scope is supplied by its ranking.
    pub fn register(
        &mut self,
        definition: &Definition,
        creator: &str,
        room: &str,
    ) -> Result<(), Error> {
        definition.validate()?;
        if creator.is_empty() || creator.len() > 256 || room.is_empty() || room.len() > 256 {
            return Err(Error::InvalidCandidate);
        }
        if !self.registrations.contains_key(&definition.id)
            && self.registrations.len() >= MAX_COMPETITIONS
        {
            return Err(Error::Capacity);
        }
        let commands: Vec<_> = definition
            .options
            .iter()
            .flat_map(|option| {
                option
                    .commands
                    .iter()
                    .map(move |command| (command.to_lowercase(), option.id.clone()))
            })
            .collect();
        if commands.len() > MAX_ROUTES_PER_COMPETITION
            || commands.iter().any(|(command, _)| command.len() > 512)
        {
            return Err(Error::Capacity);
        }
        let previous = self.registrations.get(&definition.id).map_or(0, Vec::len);
        if self.route_count - previous + commands.len() > MAX_ROUTES {
            return Err(Error::Capacity);
        }
        self.remove(&definition.id);
        let mut keys = Vec::with_capacity(commands.len());
        for (command, option) in commands {
            let key = (creator.to_owned(), room.to_owned(), command);
            self.routes
                .entry(key.clone())
                .or_default()
                .insert(definition.id.clone(), option);
            keys.push(key);
        }
        self.route_count += keys.len();
        self.registrations.insert(definition.id.clone(), keys);
        Ok(())
    }
    pub fn remove(&mut self, id: &str) -> bool {
        let Some(keys) = self.registrations.remove(id) else {
            return false;
        };
        self.route_count -= keys.len();
        if let Some(sources) = self.source_registrations.remove(id) {
            for key in sources {
                if let Some(routes) = self.source_routes.get_mut(&key) {
                    routes.remove(id);
                    if routes.is_empty() {
                        self.source_routes.remove(&key);
                    }
                }
            }
        }
        for key in keys {
            if let Some(routes) = self.routes.get_mut(&key) {
                routes.remove(id);
                if routes.is_empty() {
                    self.routes.remove(&key);
                }
            }
        }
        true
    }
    /// Index the bounded set of native sources for a registered competition.
    /// Replacing a registration clears the old source routes first.
    pub fn register_sources(
        &mut self,
        id: &str,
        creator: &str,
        room: &str,
        sources: &[&str],
    ) -> Result<(), Error> {
        if !self.registrations.contains_key(id)
            || creator.is_empty()
            || creator.len() > 256
            || room.is_empty()
            || room.len() > 256
            || sources.len() > 3
            || sources
                .iter()
                .any(|s| !matches!(*s, "tiktok.like" | "tiktok.share" | "tiktok.gift"))
        {
            return Err(Error::InvalidCandidate);
        }
        let keys: BTreeSet<RouteKey> = sources
            .iter()
            .map(|s| (creator.to_owned(), room.to_owned(), (*s).to_owned()))
            .collect();
        if let Some(previous) = self.source_registrations.remove(id) {
            for key in previous {
                if let Some(routes) = self.source_routes.get_mut(&key) {
                    routes.remove(id);
                    if routes.is_empty() {
                        self.source_routes.remove(&key);
                    }
                }
            }
        }
        let keys: Vec<_> = keys.into_iter().collect();
        for key in &keys {
            self.source_routes
                .entry(key.clone())
                .or_default()
                .insert(id.to_owned());
        }
        self.source_registrations.insert(id.to_owned(), keys);
        Ok(())
    }
    pub fn matching_source(&self, creator: &str, room: &str, source: &str) -> Vec<String> {
        self.source_routes
            .get(&(creator.to_owned(), room.to_owned(), source.to_owned()))
            .into_iter()
            .flat_map(|routes| routes.iter().cloned())
            .collect()
    }
    pub fn matching(&self, creator: &str, room: &str, comment: &str) -> Vec<CommandRoute> {
        if comment.len() > 128 {
            return Vec::new();
        }
        let key = (
            creator.to_owned(),
            room.to_owned(),
            comment.trim().to_lowercase(),
        );
        self.routes
            .get(&key)
            .into_iter()
            .flat_map(|routes| routes.iter())
            .map(|(competition_id, option_id)| CommandRoute {
                competition_id: competition_id.clone(),
                option_id: option_id.clone(),
            })
            .collect()
    }
}
