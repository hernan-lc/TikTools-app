use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

use super::{
    util::{bool_int, now, required_value_string},
    DatabaseError, DatabaseManager,
};

impl DatabaseManager {
    pub(crate) fn load_behavior_snapshot(&self) -> Result<Value, DatabaseError> {
        let actions = self.load_behavior_rows("behavior_actions")?;
        let events = self.load_behavior_rows("behavior_events")?;
        let plugins = self.load_plugin_states()?;
        Ok(json!({
            "actions": actions,
            "events": events,
            "plugins": plugins,
            "actionTypes": [],
            "translations": {}
        }))
    }
    pub(crate) fn save_behavior(&self, table: &str, value: &Value) -> Result<Value, DatabaseError> {
        let object = value.as_object().ok_or_else(|| {
            DatabaseError::Invalid("behavior record must be an object".to_owned())
        })?;
        let id = required_value_string(object, "id")?;
        let name = required_value_string(object, "name")?;
        let enabled = object
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let connection = self.open(&self.automation_path())?;
        let existing: Option<i64> = connection
            .query_row(
                &format!("SELECT created_at FROM {table} WHERE id = ?"),
                [&id],
                |row| row.get(0),
            )
            .optional()?;
        let created_at = existing.unwrap_or_else(now);
        let updated_at = now();
        connection.execute(
            &format!(
                "INSERT INTO {table} (id, name, enabled, payload_json, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET name = excluded.name,
                   enabled = excluded.enabled, payload_json = excluded.payload_json,
                   updated_at = excluded.updated_at"
            ),
            params![
                id,
                name,
                bool_int(enabled),
                serde_json::to_string(value)?,
                created_at,
                updated_at
            ],
        )?;
        Ok(value.clone())
    }
    pub(crate) fn delete_behavior(&self, table: &str, id: &str) -> Result<bool, DatabaseError> {
        let connection = self.open(&self.automation_path())?;
        let changed = connection.execute(&format!("DELETE FROM {table} WHERE id = ?"), [id])?;
        if changed > 0 && table == "behavior_actions" {
            remove_action_references(&connection, id)?;
        }
        Ok(changed > 0)
    }
    pub(crate) fn set_behavior_enabled(
        &self,
        table: &str,
        id: &str,
        enabled: bool,
    ) -> Result<Value, DatabaseError> {
        let connection = self.open(&self.automation_path())?;
        let changed = connection.execute(
            &format!("UPDATE {table} SET enabled = ?, updated_at = ? WHERE id = ?"),
            params![bool_int(enabled), now(), id],
        )?;
        if changed == 0 {
            return Err(DatabaseError::Invalid(format!("unknown behavior: {id}")));
        }
        self.load_behavior_row(&connection, table, id)
    }
    /// Flips `enabled` for many records in one transaction.
    /// Missing ids are skipped and reported back so callers can
    /// prune them; any other error rolls the whole batch back.
    pub(crate) fn set_behavior_enabled_many(
        &self,
        table: &str,
        updates: &[(String, bool)],
    ) -> Result<Vec<String>, DatabaseError> {
        if updates.is_empty() {
            return Ok(Vec::new());
        }
        let mut connection = self.open(&self.automation_path())?;
        let transaction = connection.transaction()?;
        let mut missing = Vec::new();
        for (id, enabled) in updates {
            let changed = transaction.execute(
                &format!("UPDATE {table} SET enabled = ?, updated_at = ? WHERE id = ?"),
                params![bool_int(*enabled), now(), id],
            )?;
            if changed == 0 {
                missing.push(id.clone());
            }
        }
        transaction.commit()?;
        Ok(missing)
    }
    pub(crate) fn set_plugin_state(
        &self,
        id: &str,
        installed: bool,
        enabled: bool,
    ) -> Result<Value, DatabaseError> {
        let connection = self.open(&self.automation_path())?;
        connection.execute(
            "INSERT INTO behavior_plugins (id, installed, enabled, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET installed = excluded.installed,
               enabled = excluded.enabled, updated_at = excluded.updated_at",
            params![id, bool_int(installed), bool_int(enabled), now()],
        )?;
        Ok(json!({"id": id, "installed": installed, "enabled": enabled}))
    }
    pub(crate) fn remove_plugin_state(&self, id: &str) -> Result<(), DatabaseError> {
        let connection = self.open(&self.automation_path())?;
        connection.execute("DELETE FROM behavior_plugins WHERE id = ?", [id])?;
        Ok(())
    }
    fn load_behavior_row(
        &self,
        connection: &Connection,
        table: &str,
        id: &str,
    ) -> Result<Value, DatabaseError> {
        connection
            .query_row(
                &format!("SELECT id, name, enabled, payload_json FROM {table} WHERE id = ?"),
                [id],
                |row| {
                    let id: String = row.get(0)?;
                    let name: String = row.get(1)?;
                    let enabled: bool = row.get::<_, i64>(2)? != 0;
                    let payload: String = row.get(3)?;
                    Ok((id, name, enabled, payload))
                },
            )
            .map(|(id, name, enabled, payload)| {
                let mut object = serde_json::from_str::<Value>(&payload)
                    .ok()
                    .and_then(|value| value.as_object().cloned())
                    .unwrap_or_default();
                object.insert("id".to_owned(), Value::String(id));
                object.insert("name".to_owned(), Value::String(name));
                object.insert("enabled".to_owned(), Value::Bool(enabled));
                Value::Object(object)
            })
            .map_err(|_| DatabaseError::Invalid(format!("unknown behavior: {id}")))
    }
    fn load_behavior_rows(&self, table: &str) -> Result<Vec<Value>, DatabaseError> {
        let connection = self.open(&self.automation_path())?;
        let mut statement = connection.prepare(&format!(
            "SELECT id, name, enabled, payload_json, created_at, updated_at
             FROM {table} ORDER BY updated_at DESC, name ASC"
        ))?;
        let rows = statement.query_map([], |row| {
            let id: String = row.get(0)?;
            let name: String = row.get(1)?;
            let enabled: bool = row.get::<_, i64>(2)? != 0;
            let payload: String = row.get(3)?;
            Ok((id, name, enabled, payload))
        })?;
        let mut result = Vec::new();
        for row in rows {
            let (id, name, enabled, payload) = row?;
            let mut object = serde_json::from_str::<Value>(&payload)?
                .as_object()
                .cloned()
                .ok_or_else(|| DatabaseError::Invalid(format!("{table}/{id} is not an object")))?;
            object.insert("id".to_owned(), Value::String(id));
            object.insert("name".to_owned(), Value::String(name));
            object.insert("enabled".to_owned(), Value::Bool(enabled));
            result.push(Value::Object(object));
        }
        Ok(result)
    }
    fn load_plugin_states(&self) -> Result<Vec<Value>, DatabaseError> {
        let connection = self.open(&self.automation_path())?;
        let mut statement = connection
            .prepare("SELECT id, installed, enabled FROM behavior_plugins ORDER BY id ASC")?;
        let rows = statement.query_map([], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "installed": row.get::<_, i64>(1)? != 0,
                "enabled": row.get::<_, i64>(2)? != 0
            }))
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }
}

fn remove_action_references(connection: &Connection, action_id: &str) -> Result<(), DatabaseError> {
    let mut statement = connection
        .prepare("SELECT id, payload_json FROM behavior_events WHERE payload_json IS NOT NULL")?;
    let rows = statement.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut updates = Vec::new();
    for row in rows {
        let (id, payload) = row?;
        let mut object = serde_json::from_str::<Value>(&payload)?
            .as_object()
            .cloned()
            .ok_or_else(|| {
                DatabaseError::Invalid(format!("behavior_events/{id} is not an object"))
            })?;
        let Some(action_ids) = object.get_mut("actionIds").and_then(Value::as_array_mut) else {
            continue;
        };
        let original = action_ids.len();
        action_ids.retain(|value| value.as_str() != Some(action_id));
        if action_ids.len() != original {
            updates.push((id, Value::Object(object)));
        }
    }
    drop(statement);
    for (id, value) in updates {
        let object = value
            .as_object()
            .ok_or_else(|| DatabaseError::Invalid("event is not an object".to_owned()))?;
        let name = required_value_string(object, "name")?;
        let enabled = object
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        connection.execute(
            "UPDATE behavior_events SET name = ?, enabled = ?, payload_json = ?, updated_at = ? WHERE id = ?",
            params![name, bool_int(enabled), serde_json::to_string(&value)?, now(), id],
        )?;
    }
    Ok(())
}
