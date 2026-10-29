use super::{DatabaseError, DatabaseManager};
use rusqlite::params;
use tiktools_aggregation::model::Definition;

impl DatabaseManager {
    pub(crate) fn load_aggregation_definitions(&self) -> Result<Vec<Definition>, DatabaseError> {
        let connection = self.open(&self.automation_path())?;
        let mut statement = connection
            .prepare("SELECT definition_json FROM aggregation_definitions ORDER BY id")?;
        let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
        rows.map(|row| Ok(serde_json::from_str(&row?)?)).collect()
    }
    pub(crate) fn insert_aggregation_definition(
        &self,
        definition: &Definition,
    ) -> Result<(), DatabaseError> {
        let connection = self.open(&self.automation_path())?;
        connection.execute("INSERT INTO aggregation_definitions(id, creator_id, room_id, schema_version, definition_json) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![definition.id, definition.creator_id, definition.room_id, definition.schema_version, serde_json::to_string(definition)?])?;
        Ok(())
    }
    pub(crate) fn update_aggregation_definition(
        &self,
        definition: &Definition,
    ) -> Result<bool, DatabaseError> {
        let connection = self.open(&self.automation_path())?;
        Ok(connection.execute("UPDATE aggregation_definitions SET creator_id=?2, room_id=?3, schema_version=?4, definition_json=?5 WHERE id=?1", params![definition.id, definition.creator_id, definition.room_id, definition.schema_version, serde_json::to_string(definition)?])? > 0)
    }
    pub(crate) fn delete_aggregation_definition(&self, id: &str) -> Result<bool, DatabaseError> {
        let connection = self.open(&self.automation_path())?;
        Ok(connection.execute("DELETE FROM aggregation_definitions WHERE id = ?1", [id])? > 0)
    }
}
