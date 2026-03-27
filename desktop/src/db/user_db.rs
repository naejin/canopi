use rusqlite::Connection;

#[allow(dead_code)]
const CURRENT_SCHEMA_VERSION: i32 = 2;

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
    let mut stmt = conn.prepare(
        "SELECT canonical_name FROM favorites ORDER BY added_at DESC",
    )?;
    let names = stmt.query_map([], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(names)
}

/// Toggles a favorite. Returns `true` if now favorited, `false` if unfavorited.
pub fn toggle_favorite(
    conn: &Connection,
    canonical_name: &str,
) -> Result<bool, rusqlite::Error> {
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
pub fn get_recently_viewed_names(conn: &Connection, limit: u32) -> Result<Vec<String>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT canonical_name FROM recently_viewed ORDER BY viewed_at DESC LIMIT ?1",
    )?;
    let names = stmt.query_map([limit], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(names)
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
}
