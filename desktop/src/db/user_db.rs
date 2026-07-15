use rusqlite::Connection;
use std::fmt;

const CURRENT_USER_DB_VERSION: i32 = 8;

struct Migration {
    version: i32,
    sql: &'static str,
}

const MIGRATIONS: [Migration; CURRENT_USER_DB_VERSION as usize] = [
    Migration {
        version: 1,
        sql: include_str!("../../migrations/init.sql"),
    },
    Migration {
        version: 2,
        sql: include_str!("../../migrations/v2_recently_viewed.sql"),
    },
    Migration {
        version: 3,
        sql: include_str!("../../migrations/v3_saved_object_stamps.sql"),
    },
    Migration {
        version: 4,
        sql: include_str!("../../migrations/v4_design_notebook.sql"),
    },
    Migration {
        version: 5,
        sql: include_str!("../../migrations/v5_design_notebook_sections.sql"),
    },
    Migration {
        version: 6,
        // v6 added a short-lived pinned column; keeping the slot prevents version reuse.
        sql: "",
    },
    Migration {
        version: 7,
        sql: include_str!("../../migrations/v7_design_notebook_order.sql"),
    },
    Migration {
        version: 8,
        sql: include_str!("../../migrations/v8_design_notebook_drop_pinned.sql"),
    },
];

#[derive(Debug)]
pub enum UserDbInitError {
    Open(rusqlite::Error),
    ReadSchemaVersion(rusqlite::Error),
    UnsupportedSchemaVersion {
        found: i32,
        supported: i32,
    },
    ConfigureForeignKeys(rusqlite::Error),
    Migration {
        version: i32,
        source: rusqlite::Error,
    },
    RepairIntegrity(rusqlite::Error),
    VerifyIntegrity(rusqlite::Error),
    ForeignKeysDisabled,
    ForeignKeyViolation {
        table: String,
        row_id: Option<i64>,
        parent: String,
        constraint_index: i32,
    },
}

impl fmt::Display for UserDbInitError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Open(error) => write!(formatter, "failed to open user database: {error}"),
            Self::ReadSchemaVersion(error) => write!(
                formatter,
                "failed to read user database schema version: {error}"
            ),
            Self::UnsupportedSchemaVersion { found, supported } => write!(
                formatter,
                "user database schema version {found} is newer than supported version {supported}"
            ),
            Self::ConfigureForeignKeys(error) => write!(
                formatter,
                "failed to enable user database foreign-key enforcement: {error}"
            ),
            Self::Migration { version, source } => write!(
                formatter,
                "failed to migrate user database to schema version {version}: {source}"
            ),
            Self::RepairIntegrity(error) => write!(
                formatter,
                "failed to repair legacy user database relationships: {error}"
            ),
            Self::VerifyIntegrity(error) => {
                write!(
                    formatter,
                    "failed to verify user database integrity: {error}"
                )
            }
            Self::ForeignKeysDisabled => write!(
                formatter,
                "user database foreign-key enforcement could not be enabled"
            ),
            Self::ForeignKeyViolation {
                table,
                row_id,
                parent,
                constraint_index,
            } => write!(
                formatter,
                "user database foreign-key violation in {table} row {row_id:?} referencing {parent} (constraint {constraint_index})"
            ),
        }
    }
}

impl std::error::Error for UserDbInitError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Open(error)
            | Self::ReadSchemaVersion(error)
            | Self::ConfigureForeignKeys(error)
            | Self::RepairIntegrity(error)
            | Self::VerifyIntegrity(error) => Some(error),
            Self::Migration { source, .. } => Some(source),
            Self::UnsupportedSchemaVersion { .. }
            | Self::ForeignKeysDisabled
            | Self::ForeignKeyViolation { .. } => None,
        }
    }
}

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
pub(super) fn initialize_connection(conn: &Connection) -> Result<(), UserDbInitError> {
    let version: i32 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(UserDbInitError::ReadSchemaVersion)?;
    if version > CURRENT_USER_DB_VERSION {
        return Err(UserDbInitError::UnsupportedSchemaVersion {
            found: version,
            supported: CURRENT_USER_DB_VERSION,
        });
    }
    conn.pragma_update(None, "foreign_keys", true)
        .map_err(UserDbInitError::ConfigureForeignKeys)?;

    for migration in MIGRATIONS
        .iter()
        .filter(|migration| migration.version > version)
    {
        apply_migration(conn, migration)?;
    }
    repair_legacy_integrity(conn).map_err(UserDbInitError::RepairIntegrity)?;
    verify_integrity(conn)?;

    Ok(())
}

fn apply_migration(conn: &Connection, migration: &Migration) -> Result<(), UserDbInitError> {
    let migrate = || -> Result<(), rusqlite::Error> {
        let transaction = conn.unchecked_transaction()?;
        transaction.execute_batch(migration.sql)?;
        transaction.pragma_update(None, "user_version", migration.version)?;
        transaction.commit()
    };

    migrate().map_err(|source| UserDbInitError::Migration {
        version: migration.version,
        source,
    })
}

fn repair_legacy_integrity(conn: &Connection) -> Result<(), rusqlite::Error> {
    let transaction = conn.unchecked_transaction()?;
    transaction.execute(
        "DELETE FROM design_notebook_section_memberships
         WHERE NOT EXISTS (
            SELECT 1
            FROM design_notebook_entries
            WHERE design_notebook_entries.path = design_notebook_section_memberships.path
         )
         OR NOT EXISTS (
            SELECT 1
            FROM design_notebook_sections
            WHERE design_notebook_sections.id = design_notebook_section_memberships.section_id
         )",
        [],
    )?;
    transaction.commit()
}

fn verify_integrity(conn: &Connection) -> Result<(), UserDbInitError> {
    let foreign_keys_enabled: i32 = conn
        .pragma_query_value(None, "foreign_keys", |row| row.get(0))
        .map_err(UserDbInitError::VerifyIntegrity)?;
    if foreign_keys_enabled != 1 {
        return Err(UserDbInitError::ForeignKeysDisabled);
    }

    let mut statement = conn
        .prepare("PRAGMA foreign_key_check")
        .map_err(UserDbInitError::VerifyIntegrity)?;
    let mut rows = statement
        .query([])
        .map_err(UserDbInitError::VerifyIntegrity)?;
    let Some(row) = rows.next().map_err(UserDbInitError::VerifyIntegrity)? else {
        return Ok(());
    };

    Err(UserDbInitError::ForeignKeyViolation {
        table: row.get(0).map_err(UserDbInitError::VerifyIntegrity)?,
        row_id: row.get(1).map_err(UserDbInitError::VerifyIntegrity)?,
        parent: row.get(2).map_err(UserDbInitError::VerifyIntegrity)?,
        constraint_index: row.get(3).map_err(UserDbInitError::VerifyIntegrity)?,
    })
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

    fn column_names(conn: &Connection, table: &str) -> Vec<String> {
        conn.prepare(&format!("PRAGMA table_info({table})"))
            .unwrap()
            .query_map([], |row| row.get(1))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    }

    fn temp_user_db_path(name: &str) -> std::path::PathBuf {
        let unique = format!(
            "canopi_user_db_{name}_{}_{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        std::env::temp_dir().join(unique)
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
        initialize_connection(&conn).unwrap();

        conn.query_row("SELECT COUNT(*) FROM design_notebook_entries", [], |_| {
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn failed_multi_statement_migration_rolls_back_and_can_be_retried() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../../migrations/init.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../migrations/v2_recently_viewed.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../migrations/v3_saved_object_stamps.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../migrations/v4_design_notebook.sql"))
            .unwrap();
        conn.execute_batch(include_str!(
            "../../migrations/v5_design_notebook_sections.sql"
        ))
        .unwrap();
        conn.execute_batch(
            "ALTER TABLE design_notebook_entries
             ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
             PRAGMA user_version = 6;",
        )
        .unwrap();

        let error = initialize_connection(&conn).unwrap_err();
        assert!(matches!(
            error,
            UserDbInitError::Migration { version: 7, .. }
        ));
        assert_eq!(
            conn.pragma_query_value::<i32, _>(None, "user_version", |row| row.get(0))
                .unwrap(),
            6
        );
        assert!(
            !column_names(&conn, "design_notebook_sections")
                .iter()
                .any(|column| column == "sort_order")
        );

        conn.execute_batch("ALTER TABLE design_notebook_entries DROP COLUMN sort_order;")
            .unwrap();
        initialize_connection(&conn).unwrap();

        assert_eq!(
            conn.pragma_query_value::<i32, _>(None, "user_version", |row| row.get(0))
                .unwrap(),
            8
        );
    }

    #[test]
    fn initialization_rejects_a_future_schema_version() {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "user_version", 9).unwrap();

        let error = match crate::db::UserDb::initialize(conn) {
            Ok(_) => panic!("future user database schema should be rejected"),
            Err(error) => error,
        };

        assert!(matches!(
            error,
            UserDbInitError::UnsupportedSchemaVersion {
                found: 9,
                supported: 8
            }
        ));
    }

    #[test]
    fn initialization_enables_foreign_keys_on_a_new_database() {
        let user_db = crate::db::UserDb::initialize(Connection::open_in_memory().unwrap()).unwrap();
        let conn = user_db.acquire();

        let enabled: i32 = conn
            .pragma_query_value(None, "foreign_keys", |row| row.get(0))
            .unwrap();

        assert_eq!(enabled, 1);
    }

    #[test]
    fn reopening_a_current_database_enables_foreign_keys() {
        let path = temp_user_db_path("reopen_foreign_keys");
        drop(crate::db::UserDb::open(&path).unwrap());

        let user_db = crate::db::UserDb::open(&path).unwrap();
        let conn = user_db.acquire();
        let enabled: i32 = conn
            .pragma_query_value(None, "foreign_keys", |row| row.get(0))
            .unwrap();

        assert_eq!(enabled, 1);
        drop(conn);
        drop(user_db);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn initialized_database_rejects_orphan_notebook_memberships() {
        let user_db = crate::db::UserDb::initialize(Connection::open_in_memory().unwrap()).unwrap();
        let conn = user_db.acquire();

        let result = conn.execute(
            "INSERT INTO design_notebook_section_memberships (
                path, section_id, created_at, updated_at
             ) VALUES ('/missing.canopi', 'missing-section', datetime('now'), datetime('now'))",
            [],
        );

        assert!(matches!(
            result,
            Err(rusqlite::Error::SqliteFailure(error, _))
                if error.code == rusqlite::ErrorCode::ConstraintViolation
        ));
    }

    #[test]
    fn deleting_notebook_parents_cascades_memberships() {
        let user_db = crate::db::UserDb::initialize(Connection::open_in_memory().unwrap()).unwrap();
        let conn = user_db.acquire();
        conn.execute_batch(
            "INSERT INTO design_notebook_entries (
                path, name, updated_at, plant_count, sort_order, created_at, last_opened
             ) VALUES
                ('/first.canopi', 'First', datetime('now'), 0, 0, datetime('now'), datetime('now')),
                ('/second.canopi', 'Second', datetime('now'), 0, 1, datetime('now'), datetime('now'));
             INSERT INTO design_notebook_sections (
                id, name, sort_order, created_at, updated_at
             ) VALUES
                ('first-section', 'First', 0, datetime('now'), datetime('now')),
                ('second-section', 'Second', 1, datetime('now'), datetime('now'));
             INSERT INTO design_notebook_section_memberships (
                path, section_id, created_at, updated_at
             ) VALUES
                ('/first.canopi', 'first-section', datetime('now'), datetime('now')),
                ('/second.canopi', 'second-section', datetime('now'), datetime('now'));",
        )
        .unwrap();

        conn.execute(
            "DELETE FROM design_notebook_entries WHERE path = '/first.canopi'",
            [],
        )
        .unwrap();
        conn.execute(
            "DELETE FROM design_notebook_sections WHERE id = 'second-section'",
            [],
        )
        .unwrap();

        let membership_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM design_notebook_section_memberships",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(membership_count, 0);
    }

    #[test]
    fn initialization_repairs_legacy_orphan_notebook_memberships() {
        let conn = Connection::open_in_memory().unwrap();
        initialize_connection(&conn).unwrap();
        conn.pragma_update(None, "foreign_keys", false).unwrap();
        conn.execute(
            "INSERT INTO design_notebook_section_memberships (
                path, section_id, created_at, updated_at
             ) VALUES ('/missing.canopi', 'missing-section', datetime('now'), datetime('now'))",
            [],
        )
        .unwrap();

        let user_db = crate::db::UserDb::initialize(conn).unwrap();
        let conn = user_db.acquire();
        let membership_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM design_notebook_section_memberships",
                [],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(membership_count, 0);
    }

    #[test]
    fn initialization_rejects_unrepaired_foreign_key_violations() {
        let conn = Connection::open_in_memory().unwrap();
        initialize_connection(&conn).unwrap();
        conn.pragma_update(None, "foreign_keys", false).unwrap();
        conn.execute_batch(
            "CREATE TABLE integrity_parent (id INTEGER PRIMARY KEY);
             CREATE TABLE integrity_child (
                id INTEGER PRIMARY KEY,
                parent_id INTEGER NOT NULL REFERENCES integrity_parent(id)
             );
             INSERT INTO integrity_child (id, parent_id) VALUES (1, 99);",
        )
        .unwrap();

        let error = match crate::db::UserDb::initialize(conn) {
            Ok(_) => panic!("unrepaired foreign-key violation should be rejected"),
            Err(error) => error,
        };

        assert!(matches!(
            error,
            UserDbInitError::ForeignKeyViolation {
                ref table,
                row_id: Some(1),
                ref parent,
                constraint_index: 0,
            } if table == "integrity_child" && parent == "integrity_parent"
        ));
    }

    #[test]
    fn v7_notebook_data_and_membership_survive_migration() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../../migrations/init.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../migrations/v2_recently_viewed.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../migrations/v3_saved_object_stamps.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../migrations/v4_design_notebook.sql"))
            .unwrap();
        conn.execute_batch(include_str!(
            "../../migrations/v5_design_notebook_sections.sql"
        ))
        .unwrap();
        conn.execute_batch(
            "ALTER TABLE design_notebook_entries
             ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;",
        )
        .unwrap();
        conn.execute_batch(include_str!(
            "../../migrations/v7_design_notebook_order.sql"
        ))
        .unwrap();
        conn.execute_batch(
            "INSERT INTO design_notebook_sections (
                id, name, sort_order, created_at, updated_at
             ) VALUES ('section-1', 'Orchard', 3, datetime('now'), datetime('now'));
             INSERT INTO design_notebook_entries (
                path, name, updated_at, plant_count, sort_order, created_at, last_opened, pinned
             ) VALUES (
                '/orchard.canopi', 'Orchard', datetime('now'), 12, 4,
                datetime('now'), datetime('now'), 1
             );
             INSERT INTO design_notebook_section_memberships (
                path, section_id, created_at, updated_at
             ) VALUES ('/orchard.canopi', 'section-1', datetime('now'), datetime('now'));
             PRAGMA user_version = 7;",
        )
        .unwrap();

        let user_db = crate::db::UserDb::initialize(conn).unwrap();
        let conn = user_db.acquire();
        let entry: (String, i64, i32) = conn
            .query_row(
                "SELECT name, plant_count, sort_order
                 FROM design_notebook_entries
                 WHERE path = '/orchard.canopi'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        let membership: String = conn
            .query_row(
                "SELECT section_id
                 FROM design_notebook_section_memberships
                 WHERE path = '/orchard.canopi'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(entry, ("Orchard".to_owned(), 12, 4));
        assert_eq!(membership, "section-1");
    }

    #[test]
    fn init_creates_design_notebook_section_tables() {
        let conn = Connection::open_in_memory().unwrap();
        initialize_connection(&conn).unwrap();

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

    #[test]
    fn init_does_not_create_design_notebook_pinned_column() {
        let conn = Connection::open_in_memory().unwrap();
        initialize_connection(&conn).unwrap();

        let columns = conn
            .prepare("PRAGMA table_info(design_notebook_entries)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();

        assert!(!columns.iter().any(|column| column == "pinned"));
    }

    #[test]
    fn init_removes_existing_design_notebook_pinned_column() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE design_notebook_entries (
                path TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                plant_count INTEGER NOT NULL DEFAULT 0,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                last_opened TEXT NOT NULL,
                pinned INTEGER NOT NULL DEFAULT 0
             );
             CREATE TABLE design_notebook_sections (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
             );
             CREATE TABLE design_notebook_section_memberships (
                path TEXT PRIMARY KEY,
                section_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(path) REFERENCES design_notebook_entries(path) ON DELETE CASCADE,
                FOREIGN KEY(section_id) REFERENCES design_notebook_sections(id) ON DELETE CASCADE
             );
             INSERT INTO design_notebook_entries (
                path,
                name,
                updated_at,
                plant_count,
                sort_order,
                created_at,
                last_opened,
                pinned
             )
             VALUES ('/designs/default.canopi', 'Default', datetime('now'), 0, 0, datetime('now'), datetime('now'), 1);
             PRAGMA user_version = 7;",
        )
        .unwrap();

        initialize_connection(&conn).unwrap();

        let columns = conn
            .prepare("PRAGMA table_info(design_notebook_entries)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        let design_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM design_notebook_entries", [], |row| {
                row.get(0)
            })
            .unwrap();

        assert!(!columns.iter().any(|column| column == "pinned"));
        assert_eq!(design_count, 1);
    }

    #[test]
    fn init_creates_design_notebook_order_columns() {
        let conn = Connection::open_in_memory().unwrap();
        initialize_connection(&conn).unwrap();

        conn.execute(
            "INSERT INTO design_notebook_sections (
                id,
                name,
                created_at,
                updated_at
             )
             VALUES ('section-default', 'Default', datetime('now'), datetime('now'))",
            [],
        )
        .unwrap();
        let section_order: i32 = conn
            .query_row(
                "SELECT sort_order FROM design_notebook_sections WHERE id = 'section-default'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        conn.execute(
            "INSERT INTO design_notebook_entries (
                path,
                name,
                updated_at,
                plant_count,
                created_at,
                last_opened
             )
             VALUES ('/designs/default.canopi', 'Default', datetime('now'), 0, datetime('now'), datetime('now'))",
            [],
        )
        .unwrap();
        let entry_order: i32 = conn
            .query_row(
                "SELECT sort_order FROM design_notebook_entries WHERE path = '/designs/default.canopi'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(section_order, 0);
        assert_eq!(entry_order, 0);
    }
}
