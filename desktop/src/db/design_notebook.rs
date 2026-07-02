use common_types::design::DesignSummary;
use rusqlite::Connection;

pub fn record_design_reference(
    conn: &Connection,
    path: &str,
    name: &str,
    plant_count: u32,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO design_notebook_entries (
            path,
            name,
            updated_at,
            plant_count,
            created_at,
            last_opened
         )
         VALUES (?1, ?2, datetime('now'), ?3, datetime('now'), datetime('now'))
         ON CONFLICT(path) DO UPDATE SET
            name = excluded.name,
            updated_at = excluded.updated_at,
            plant_count = excluded.plant_count,
            last_opened = excluded.last_opened",
        rusqlite::params![path, name, plant_count],
    )?;
    Ok(())
}

pub fn get_design_notebook_entries(
    conn: &Connection,
) -> Result<Vec<DesignSummary>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT path, name, updated_at, plant_count
         FROM design_notebook_entries
         ORDER BY last_opened DESC, created_at DESC, path ASC",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(DesignSummary {
            path: row.get(0)?,
            name: row.get(1)?,
            updated_at: row.get(2)?,
            plant_count: row.get(3)?,
        })
    })?;

    rows.collect()
}

pub fn remove_design_reference(conn: &Connection, path: &str) -> Result<(), rusqlite::Error> {
    conn.execute(
        "DELETE FROM design_notebook_entries WHERE path = ?1",
        rusqlite::params![path],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE design_notebook_entries (
                path TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                plant_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                last_opened TEXT NOT NULL
            );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn records_and_lists_saved_design_references() {
        let conn = test_db();

        super::record_design_reference(&conn, "/designs/forest.canopi", "Forest Edge", 7).unwrap();

        let entries = super::get_design_notebook_entries(&conn).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path, "/designs/forest.canopi");
        assert_eq!(entries[0].name, "Forest Edge");
        assert_eq!(entries[0].plant_count, 7);
    }

    #[test]
    fn removes_saved_design_references() {
        let conn = test_db();
        super::record_design_reference(&conn, "/designs/forest.canopi", "Forest Edge", 7).unwrap();

        super::remove_design_reference(&conn, "/designs/forest.canopi").unwrap();

        assert!(
            super::get_design_notebook_entries(&conn)
                .unwrap()
                .is_empty()
        );
    }
}
