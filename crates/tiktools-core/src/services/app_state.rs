use std::{collections::BTreeMap, sync::RwLock};

#[derive(Default)]
pub struct AppStateService {
    values: RwLock<BTreeMap<String, String>>,
}

impl AppStateService {
    pub fn read(&self, keys: Option<&[String]>) -> BTreeMap<String, String> {
        let values = self.values.read().expect("app state poisoned");
        match keys {
            Some(keys) if !keys.is_empty() => keys
                .iter()
                .filter_map(|key| values.get(key).map(|value| (key.clone(), value.clone())))
                .collect(),
            _ => values.clone(),
        }
    }

    pub fn set(&self, key: String, value: String) {
        self.values
            .write()
            .expect("app state poisoned")
            .insert(key, value);
    }
}
