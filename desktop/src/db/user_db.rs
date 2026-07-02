use rusqlite::Connection;

#[allow(dead_code)]
const CURRENT_SCHEMA_VERSION: i32 = 5;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SavedObjectStampRow {
    pub id: String,
    pub name: String,
    pub payload_json: String,
    pub sort_order: i32,
    pub created_at: String,
    pub updated_at: String,
}

/// Initialize user database schema using incremental PRAGMA user_version migration.
pub fn init(conn: &Connection) -> Result<(), rusqlite::Error> {
    let version: i32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

    if version < 1 {
        conn.execute_batch(include_str!("../../migrations/init.sql"))?;
        conn.pragma_update(None, "user_version", 1)?;
    }
    if version < 2 {
        conn.execute_batch(include_str!("../../migrations/v2_recently_viewed.sql"))?;
        conn.pragma_update(None, "user_version", 2)?;
    }
    if version < 3 {
        conn.execute_batch(include_str!("../../migrations/v3_saved_object_stamps.sql"))?;
        conn.pragma_update(None, "user_version", 3)?;
    }
    if version < 4 {
        conn.execute_batch(include_str!("../../migrations/v4_design_notebook.sql"))?;
        conn.pragma_update(None, "user_version", 4)?;
    }
    if version < 5 {
        conn.execute_batch(include_str!(
            "../../migrations/v5_design_notebook_sections.sql"
        ))?;
        conn.pragma_update(None, "user_version", 5)?;
    }

    Ok(())
}

pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>, rusqlite::Error> {
    let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
    let mut rows = stmt.query_map([key], |row| row.get(0))?;
    match rows.next() {
        Some(Ok(val)) => Ok(Some(val)),
        Some(Err(e)) => Err(e),
        None => Ok(None),
    }
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, value],
    )?;
    Ok(())
}

/// Returns true if the given canonical name is in the favorites table.
pub fn is_favorite(conn: &Connection, canonical_name: &str) -> bool {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM favorites WHERE canonical_name = ?1)",
        [canonical_name],
        |row| row.get::<_, bool>(0),
    )
    .unwrap_or(false)
}

/// Returns all favorited canonical names, ordered by most recently added.
pub fn get_favorite_names(conn: &Connection) -> Result<Vec<String>, rusqlite::Error> {
    let mut stmt = conn.prepare("SELECT canonical_name FROM favorites ORDER BY added_at DESC")?;
    let names = stmt
        .query_map([], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(names)
}

/// Toggles a favorite. Returns `true` if now favorited, `false` if unfavorited.
pub fn toggle_favorite(conn: &Connection, canonical_name: &str) -> Result<bool, rusqlite::Error> {
    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM favorites WHERE canonical_name = ?1)",
        [canonical_name],
        |row| row.get(0),
    )?;

    if exists {
        conn.execute(
            "DELETE FROM favorites WHERE canonical_name = ?1",
            [canonical_name],
        )?;
        Ok(false)
    } else {
        conn.execute(
            "INSERT INTO favorites (canonical_name, added_at) VALUES (?1, datetime('now'))",
            [canonical_name],
        )?;
        Ok(true)
    }
}

/// Records a species view, updating `viewed_at` if already present.
/// The `limit_recently_viewed` trigger automatically prunes the table to 50 rows.
pub fn record_recently_viewed(
    conn: &Connection,
    canonical_name: &str,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO recently_viewed (canonical_name, viewed_at)
         VALUES (?1, datetime('now'))
         ON CONFLICT(canonical_name) DO UPDATE SET viewed_at = datetime('now')",
        [canonical_name],
    )?;
    Ok(())
}

/// Returns the most recently viewed canonical names, newest first.
pub fn get_recently_viewed_names(
    conn: &Connection,
    limit: u32,
) -> Result<Vec<String>, rusqlite::Error> {
    let mut stmt = conn
        .prepare("SELECT canonical_name FROM recently_viewed ORDER BY viewed_at DESC LIMIT ?1")?;
    let names = stmt
        .query_map([limit], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(names)
}

pub fn create_saved_object_stamp(
    conn: &Connection,
    name: &str,
    payload_json: &str,
) -> Result<SavedObjectStampRow, rusqlite::Error> {
    conn.execute(
        "INSERT INTO saved_object_stamps (id, name, payload_json, sort_order, created_at, updated_at)
         VALUES (
            'stamp-' || lower(hex(randomblob(16))),
            ?1,
            ?2,
            COALESCE((SELECT MAX(sort_order) + 1 FROM saved_object_stamps), 0),
            datetime('now'),
            datetime('now')
         )",
        (name, payload_json),
    )?;

    let id = conn.last_insert_rowid();
    conn.query_row(
        "SELECT id, name, payload_json, sort_order, created_at, updated_at
         FROM saved_object_stamps
         WHERE rowid = ?1",
        [id],
        saved_object_stamp_from_row,
    )
}

pub fn get_saved_object_stamps(
    conn: &Connection,
) -> Result<Vec<SavedObjectStampRow>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, name, payload_json, sort_order, created_at, updated_at
         FROM saved_object_stamps
         ORDER BY sort_order ASC, created_at ASC, id ASC",
    )?;
    stmt.query_map([], saved_object_stamp_from_row)?.collect()
}

pub fn rename_saved_object_stamp(
    conn: &Connection,
    id: &str,
    name: &str,
) -> Result<SavedObjectStampRow, rusqlite::Error> {
    conn.execute(
        "UPDATE saved_object_stamps
         SET name = ?2, updated_at = datetime('now')
         WHERE id = ?1",
        (id, name),
    )?;
    get_saved_object_stamp(conn, id)
}

pub fn delete_saved_object_stamp(conn: &Connection, id: &str) -> Result<bool, rusqlite::Error> {
    let deleted = conn.execute("DELETE FROM saved_object_stamps WHERE id = ?1", [id])?;
    Ok(deleted > 0)
}

pub fn reorder_saved_object_stamps(
    conn: &Connection,
    ids: &[String],
) -> Result<(), rusqlite::Error> {
    let tx = conn.unchecked_transaction()?;
    {
        let mut stmt = tx.prepare(
            "UPDATE saved_object_stamps
             SET sort_order = ?2, updated_at = datetime('now')
             WHERE id = ?1",
        )?;
        for (index, id) in ids.iter().enumerate() {
            stmt.execute((id, index as i32))?;
        }
    }
    tx.commit()
}

fn get_saved_object_stamp(
    conn: &Connection,
    id: &str,
) -> Result<SavedObjectStampRow, rusqlite::Error> {
    conn.query_row(
        "SELECT id, name, payload_json, sort_order, created_at, updated_at
         FROM saved_object_stamps
         WHERE id = ?1",
        [id],
        saved_object_stamp_from_row,
    )
}

fn saved_object_stamp_from_row(
    row: &rusqlite::Row<'_>,
) -> Result<SavedObjectStampRow, rusqlite::Error> {
    Ok(SavedObjectStampRow {
        id: row.get(0)?,
        name: row.get(1)?,
        payload_json: row.get(2)?,
        sort_order: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE recent_files (
                 path TEXT PRIMARY KEY, name TEXT NOT NULL, last_opened TEXT NOT NULL
             );
             CREATE TABLE favorites (
                 canonical_name TEXT PRIMARY KEY,
                 added_at TEXT NOT NULL
             );
             CREATE TABLE recently_viewed (
                 canonical_name TEXT PRIMARY KEY,
                 viewed_at TEXT NOT NULL DEFAULT (datetime('now'))
             );
             CREATE TABLE saved_object_stamps (
                 id TEXT PRIMARY KEY,
                 name TEXT NOT NULL,
                 payload_json TEXT NOT NULL,
                 sort_order INTEGER NOT NULL,
                 created_at TEXT NOT NULL,
                 updated_at TEXT NOT NULL
             );
             CREATE TRIGGER IF NOT EXISTS limit_recently_viewed
             AFTER INSERT ON recently_viewed
             BEGIN
                 DELETE FROM recently_viewed WHERE canonical_name NOT IN (
                     SELECT canonical_name FROM recently_viewed ORDER BY viewed_at DESC LIMIT 50
                 );
             END;",
        )
        .unwrap();
        conn
    }

    #[test]
    fn test_toggle_favorite_adds_then_removes() {
        let conn = test_db();
        assert!(!is_favorite(&conn, "Lavandula angustifolia"));
        let now_fav = toggle_favorite(&conn, "Lavandula angustifolia").unwrap();
        assert!(now_fav);
        assert!(is_favorite(&conn, "Lavandula angustifolia"));
        let still_fav = toggle_favorite(&conn, "Lavandula angustifolia").unwrap();
        assert!(!still_fav);
        assert!(!is_favorite(&conn, "Lavandula angustifolia"));
    }

    #[test]
    fn test_get_favorite_names() {
        let conn = test_db();
        toggle_favorite(&conn, "Alnus glutinosa").unwrap();
        toggle_favorite(&conn, "Lavandula angustifolia").unwrap();
        let names = get_favorite_names(&conn).unwrap();
        assert_eq!(names.len(), 2);
        assert!(names.contains(&"Alnus glutinosa".to_owned()));
        assert!(names.contains(&"Lavandula angustifolia".to_owned()));
    }

    #[test]
    fn test_record_recently_viewed_upserts() {
        let conn = test_db();
        record_recently_viewed(&conn, "Lavandula angustifolia").unwrap();
        record_recently_viewed(&conn, "Alnus glutinosa").unwrap();
        // Re-viewing should upsert without error.
        record_recently_viewed(&conn, "Lavandula angustifolia").unwrap();
        let names = get_recently_viewed_names(&conn, 10).unwrap();
        assert_eq!(names.len(), 2);
    }

    #[test]
    fn test_get_recently_viewed_names_limit() {
        let conn = test_db();
        record_recently_viewed(&conn, "Lavandula angustifolia").unwrap();
        record_recently_viewed(&conn, "Alnus glutinosa").unwrap();
        let names = get_recently_viewed_names(&conn, 1).unwrap();
        assert_eq!(names.len(), 1);
    }

    #[test]
    fn test_settings_round_trip() {
        let conn = test_db();
        set_setting(&conn, "locale", "fr").unwrap();
        let val = get_setting(&conn, "locale").unwrap();
        assert_eq!(val.as_deref(), Some("fr"));
    }

    #[test]
    fn test_saved_object_stamp_round_trip_preserves_payload_and_order() {
        let conn = test_db();

        let saved = create_saved_object_stamp(
            &conn,
            "Apple guild",
            r#"{"plants":[{"id":"plant-1"}],"zones":[],"annotations":[],"groups":[]}"#,
        )
        .unwrap();

        assert_eq!(saved.name, "Apple guild");
        assert_eq!(saved.sort_order, 0);
        assert!(!saved.created_at.is_empty());
        assert_eq!(saved.updated_at, saved.created_at);

        let stamps = get_saved_object_stamps(&conn).unwrap();
        assert_eq!(stamps.len(), 1);
        assert_eq!(stamps[0].id, saved.id);
        assert_eq!(stamps[0].name, "Apple guild");
        assert_eq!(
            stamps[0].payload_json,
            r#"{"plants":[{"id":"plant-1"}],"zones":[],"annotations":[],"groups":[]}"#
        );
        assert_eq!(stamps[0].sort_order, 0);
    }

    #[test]
    fn test_saved_object_stamps_can_be_renamed_deleted_and_reordered() {
        let conn = test_db();
        let first = create_saved_object_stamp(&conn, "First", r#"{"plants":[]}"#).unwrap();
        let second = create_saved_object_stamp(&conn, "Second", r#"{"plants":[]}"#).unwrap();

        let renamed = rename_saved_object_stamp(&conn, &first.id, "Renamed").unwrap();
        assert_eq!(renamed.name, "Renamed");

        reorder_saved_object_stamps(&conn, &[second.id.clone(), first.id.clone()]).unwrap();
        let reordered = get_saved_object_stamps(&conn).unwrap();
        assert_eq!(
            reordered
                .iter()
                .map(|stamp| stamp.id.as_str())
                .collect::<Vec<_>>(),
            [second.id.as_str(), first.id.as_str()]
        );
        assert_eq!(reordered[0].sort_order, 0);
        assert_eq!(reordered[1].sort_order, 1);

        assert!(delete_saved_object_stamp(&conn, &second.id).unwrap());
        assert!(!delete_saved_object_stamp(&conn, &second.id).unwrap());
        let remaining = get_saved_object_stamps(&conn).unwrap();
        assert_eq!(
            remaining
                .iter()
                .map(|stamp| stamp.id.as_str())
                .collect::<Vec<_>>(),
            [first.id.as_str()]
        );
    }

    #[test]
    fn init_creates_design_notebook_tables() {
        let conn = Connection::open_in_memory().unwrap();
        init(&conn).unwrap();

        conn.query_row("SELECT COUNT(*) FROM design_notebook_entries", [], |_| {
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn init_creates_design_notebook_section_tables() {
        let conn = Connection::open_in_memory().unwrap();
        init(&conn).unwrap();

        conn.query_row("SELECT COUNT(*) FROM design_notebook_sections", [], |_| {
            Ok(())
        })
        .unwrap();
        conn.query_row(
            "SELECT COUNT(*) FROM design_notebook_section_memberships",
            [],
            |_| Ok(()),
        )
        .unwrap();
    }
}
