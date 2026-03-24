use common_types::design::DesignSummary;
use rusqlite::Connection;

/// Record or update a recent file entry (upsert by path).
pub fn record_recent_file(
    conn: &Connection,
    path: &str,
    name: &str,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO recent_files (path, name, last_opened)
         VALUES (?1, ?2, datetime('now'))
         ON CONFLICT(path) DO UPDATE SET
             name = excluded.name,
             last_opened = excluded.last_opened",
        rusqlite::params![path, name],
    )?;
    Ok(())
}

/// Return recent files ordered by most recently opened, up to `limit` rows.
/// `plant_count` is 0 — we don't parse the file here, just return stored metadata.
pub fn get_recent_files(
    conn: &Connection,
    limit: u32,
) -> Result<Vec<DesignSummary>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT path, name, last_opened
         FROM recent_files
         ORDER BY last_opened DESC
         LIMIT ?1",
    )?;

    let rows = stmt.query_map(rusqlite::params![limit], |row| {
        Ok(DesignSummary {
            path: row.get(0)?,
            name: row.get(1)?,
            updated_at: row.get(2)?,
            plant_count: 0,
        })
    })?;

    rows.collect()
}

/// Remove a recent file entry (for files that no longer exist on disk).
#[allow(dead_code)]
pub fn remove_recent_file(conn: &Connection, path: &str) -> Result<(), rusqlite::Error> {
    conn.execute(
        "DELETE FROM recent_files WHERE path = ?1",
        rusqlite::params![path],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE recent_files (
                path TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                last_opened TEXT NOT NULL
            );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn test_record_and_get_recent_files() {
        let conn = test_db();
        record_recent_file(&conn, "/home/user/garden.canopi", "Garden").unwrap();
        record_recent_file(&conn, "/home/user/forest.canopi", "Forest").unwrap();

        let files = get_recent_files(&conn, 10).unwrap();
        assert_eq!(files.len(), 2);

        // Both entries must be present; plant_count is always 0.
        let names: Vec<&str> = files.iter().map(|f| f.name.as_str()).collect();
        assert!(names.contains(&"Garden"), "Garden should be in recent files");
        assert!(names.contains(&"Forest"), "Forest should be in recent files");
        assert!(files.iter().all(|f| f.plant_count == 0));
    }

    #[test]
    fn test_record_recent_file_upserts() {
        let conn = test_db();
        record_recent_file(&conn, "/home/user/garden.canopi", "Garden").unwrap();
        // Update the name via upsert.
        record_recent_file(&conn, "/home/user/garden.canopi", "My Garden").unwrap();

        let files = get_recent_files(&conn, 10).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name, "My Garden");
    }

    #[test]
    fn test_get_recent_files_respects_limit() {
        let conn = test_db();
        for i in 0..5 {
            record_recent_file(
                &conn,
                &format!("/home/user/garden{i}.canopi"),
                &format!("Garden {i}"),
            )
            .unwrap();
        }

        let files = get_recent_files(&conn, 3).unwrap();
        assert_eq!(files.len(), 3);
    }

    #[test]
    fn test_remove_recent_file() {
        let conn = test_db();
        record_recent_file(&conn, "/home/user/garden.canopi", "Garden").unwrap();
        record_recent_file(&conn, "/home/user/forest.canopi", "Forest").unwrap();

        remove_recent_file(&conn, "/home/user/garden.canopi").unwrap();

        let files = get_recent_files(&conn, 10).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name, "Forest");
    }

    #[test]
    fn test_remove_nonexistent_recent_file_is_noop() {
        let conn = test_db();
        // Should not error even if the row doesn't exist.
        remove_recent_file(&conn, "/nonexistent.canopi").unwrap();
        let files = get_recent_files(&conn, 10).unwrap();
        assert_eq!(files.len(), 0);
    }
}
