use rusqlite::Connection;
use std::fmt;

use super::user_db_migrations::{self, UserDbMigrationFailure};

/// The user database shape this build writes (Canopi v2).
///
/// An older database is upgraded in place by the migration ladder in
/// `user_db_migrations` (ADR 0013); a newer one is refused untouched.
pub(crate) const CURRENT_USER_DB_VERSION: i32 = 9;

const SCHEMA: &str = include_str!("user_db_schema.sql");

#[derive(Debug)]
pub enum UserDbInitError {
    Open(rusqlite::Error),
    ReadSchemaVersion(rusqlite::Error),
    /// Written by a Canopi older than the migration ladder reaches. It is
    /// refused and left untouched.
    UnsupportedSchemaVersion {
        found: i32,
        oldest_supported: i32,
    },
    /// Written by a newer Canopi. It is refused and left untouched; the user
    /// must run that newer Canopi (or move the file) to continue.
    NewerSchemaVersion {
        found: i32,
        supported: i32,
    },
    /// The upgrade from `from` to `to` failed and rolled back; the file is
    /// exactly as it was and is never set aside.
    Migration {
        from: i32,
        to: i32,
        source: UserDbMigrationFailure,
    },
    SetAside {
        source: std::io::Error,
    },
    ConfigureForeignKeys(rusqlite::Error),
    CreateSchema(rusqlite::Error),
    VerifyIntegrity(rusqlite::Error),
    ForeignKeysDisabled,
    ForeignKeyViolation {
        table: String,
        row_id: Option<i64>,
        parent: String,
        constraint_index: i32,
    },
}

impl UserDbInitError {
    /// Whether the file should be kept aside as corrupt and replaced by an
    /// empty database: it is not a SQLite database, is damaged, or a current
    /// database fails its integrity checks. Older and newer databases and
    /// failed upgrades are never set aside.
    pub(crate) fn sets_aside_as_corrupt(&self) -> bool {
        match self {
            Self::ForeignKeyViolation { .. } => true,
            Self::ReadSchemaVersion(error)
            | Self::ConfigureForeignKeys(error)
            | Self::CreateSchema(error)
            | Self::VerifyIntegrity(error) => is_corrupt_database_error(error),
            Self::Open(_)
            | Self::UnsupportedSchemaVersion { .. }
            | Self::NewerSchemaVersion { .. }
            | Self::Migration { .. }
            | Self::SetAside { .. }
            | Self::ForeignKeysDisabled => false,
        }
    }
}

fn is_corrupt_database_error(error: &rusqlite::Error) -> bool {
    matches!(
        error,
        rusqlite::Error::SqliteFailure(failure, _)
            if matches!(
                failure.code,
                rusqlite::ErrorCode::NotADatabase | rusqlite::ErrorCode::DatabaseCorrupt
            )
    )
}

impl fmt::Display for UserDbInitError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Open(error) => write!(formatter, "failed to open user database: {error}"),
            Self::ReadSchemaVersion(error) => write!(
                formatter,
                "failed to read user database schema version: {error}"
            ),
            Self::UnsupportedSchemaVersion {
                found,
                oldest_supported,
            } => write!(
                formatter,
                "user database schema version {found} is older than this Canopi can upgrade (oldest supported {oldest_supported})"
            ),
            Self::NewerSchemaVersion { found, supported } => write!(
                formatter,
                "user database schema version {found} was written by a newer Canopi (this version reads {supported}); open it with that newer Canopi"
            ),
            Self::Migration { from, to, source } => write!(
                formatter,
                "failed to upgrade the user database from schema {from} to {to}; it was left unchanged: {source}"
            ),
            Self::SetAside { source } => write!(
                formatter,
                "failed to set aside the damaged user database: {source}"
            ),
            Self::ConfigureForeignKeys(error) => write!(
                formatter,
                "failed to enable user database foreign-key enforcement: {error}"
            ),
            Self::CreateSchema(error) => {
                write!(formatter, "failed to create the user database: {error}")
            }
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
            | Self::CreateSchema(error)
            | Self::VerifyIntegrity(error) => Some(error),
            Self::Migration { source, .. } => Some(source),
            Self::SetAside { source } => Some(source),
            Self::UnsupportedSchemaVersion { .. }
            | Self::NewerSchemaVersion { .. }
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

/// Schema version recorded in a user database (`PRAGMA user_version`).
pub(super) fn schema_version(conn: &Connection) -> Result<i32, UserDbInitError> {
    conn.pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(UserDbInitError::ReadSchemaVersion)
}

/// Create the schema in an empty database, accept a current one, or upgrade
/// an older one in place through the migration ladder. A newer database is
/// refused. Every path ends in the same integrity check.
pub(super) fn initialize_connection(conn: &Connection) -> Result<(), UserDbInitError> {
    let version = schema_version(conn)?;
    conn.pragma_update(None, "foreign_keys", true)
        .map_err(UserDbInitError::ConfigureForeignKeys)?;
    match version {
        0 => create_schema(conn)?,
        CURRENT_USER_DB_VERSION => {}
        found if found > CURRENT_USER_DB_VERSION => {
            return Err(UserDbInitError::NewerSchemaVersion {
                found,
                supported: CURRENT_USER_DB_VERSION,
            });
        }
        found => user_db_migrations::upgrade(conn, found)?,
    }
    verify_integrity(conn)
}

fn create_schema(conn: &Connection) -> Result<(), UserDbInitError> {
    let create = || -> Result<(), rusqlite::Error> {
        let transaction = conn.unchecked_transaction()?;
        transaction.execute_batch(SCHEMA)?;
        transaction.pragma_update(None, "user_version", CURRENT_USER_DB_VERSION)?;
        transaction.commit()
    };
    create().map_err(UserDbInitError::CreateSchema)
}

/// Foreign keys are enforced and no row violates them. Runs on every open and,
/// inside the upgrade transaction, before a migrated database is committed.
pub(super) fn verify_integrity(conn: &Connection) -> Result<(), UserDbInitError> {
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
pub fn is_favorite(conn: &Connection, canonical_name: &str) -> Result<bool, rusqlite::Error> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM favorites WHERE canonical_name = ?1)",
        [canonical_name],
        |row| row.get::<_, bool>(0),
    )
}

/// Returns all favorited canonical names, ordered by most recently added.
pub fn get_favorite_names(conn: &Connection) -> Result<Vec<String>, rusqlite::Error> {
    let mut stmt = conn.prepare("SELECT canonical_name FROM favorites ORDER BY added_at DESC")?;
    stmt.query_map([], |row| row.get(0))?.collect()
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
    stmt.query_map([limit], |row| row.get(0))?.collect()
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
        initialize_connection(&conn).unwrap();
        conn
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
        assert!(!is_favorite(&conn, "Lavandula angustifolia").unwrap());
        let now_fav = toggle_favorite(&conn, "Lavandula angustifolia").unwrap();
        assert!(now_fav);
        assert!(is_favorite(&conn, "Lavandula angustifolia").unwrap());
        let still_fav = toggle_favorite(&conn, "Lavandula angustifolia").unwrap();
        assert!(!still_fav);
        assert!(!is_favorite(&conn, "Lavandula angustifolia").unwrap());
    }

    #[test]
    fn favorite_reads_report_database_errors_instead_of_hiding_them() {
        let conn = test_db();
        conn.execute_batch(
            "DROP TABLE favorites;
             CREATE TABLE favorites (canonical_name BLOB, added_at TEXT);
             INSERT INTO favorites VALUES (x'ff', '1');",
        )
        .unwrap();

        assert!(
            get_favorite_names(&conn).is_err(),
            "an unreadable favorite row must not be dropped silently"
        );
        conn.execute_batch("DROP TABLE favorites;").unwrap();
        assert!(is_favorite(&conn, "Malus domestica").is_err());
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
    fn initialization_refuses_a_newer_schema_version() {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "user_version", CURRENT_USER_DB_VERSION + 1)
            .unwrap();

        assert!(matches!(
            crate::db::UserDb::initialize(conn),
            Err(UserDbInitError::NewerSchemaVersion { found, supported })
                if found == CURRENT_USER_DB_VERSION + 1 && supported == CURRENT_USER_DB_VERSION
        ));
    }

    fn files_starting_with(path: &std::path::Path, suffix: &str) -> Vec<std::path::PathBuf> {
        let prefix = format!("{}{suffix}", path.file_name().unwrap().to_string_lossy());
        let mut found = std::fs::read_dir(path.parent().unwrap())
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|candidate| {
                candidate
                    .file_name()
                    .is_some_and(|name| name.to_string_lossy().starts_with(&prefix))
            })
            .collect::<Vec<_>>();
        found.sort();
        found
    }

    fn remove_all_starting_with(path: &std::path::Path) {
        for file in files_starting_with(path, "") {
            let _ = std::fs::remove_file(file);
        }
    }

    #[test]
    fn a_corrupt_database_is_set_aside_and_the_app_starts_fresh() {
        let path = temp_user_db_path("corrupt");
        std::fs::write(&path, b"this is not a SQLite database, it is just text").unwrap();

        let user_db =
            crate::db::UserDb::open(&path).expect("a corrupt user DB must not stop startup");
        {
            let conn = user_db.acquire();
            assert_eq!(schema_version(&conn).unwrap(), CURRENT_USER_DB_VERSION);
        }
        drop(user_db);

        let aside = files_starting_with(&path, ".corrupt-");
        assert_eq!(aside.len(), 1, "{aside:?}");
        assert_eq!(
            std::fs::read(&aside[0]).unwrap(),
            b"this is not a SQLite database, it is just text"
        );

        remove_all_starting_with(&path);
    }

    #[test]
    fn a_database_with_foreign_key_violations_is_set_aside_as_corrupt() {
        let path = temp_user_db_path("foreign_keys");
        {
            let conn = Connection::open(&path).unwrap();
            initialize_connection(&conn).unwrap();
            conn.pragma_update(None, "foreign_keys", false).unwrap();
            conn.execute(
                "INSERT INTO design_notebook_section_memberships (
                    path, section_id, created_at, updated_at
                 ) VALUES ('/orphan.canopi', 'missing', datetime('now'), datetime('now'))",
                [],
            )
            .unwrap();
        }

        let user_db =
            crate::db::UserDb::open(&path).expect("an FK-violating user DB must not stop startup");
        {
            let conn = user_db.acquire();
            let memberships: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM design_notebook_section_memberships",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(memberships, 0);
        }
        drop(user_db);
        assert_eq!(files_starting_with(&path, ".corrupt-").len(), 1);

        remove_all_starting_with(&path);
    }

    /// A newer database is refused with a typed error and left exactly where it is.
    #[test]
    fn opening_a_newer_database_is_refused_and_kept() {
        let path = temp_user_db_path("newer");
        Connection::open(&path)
            .unwrap()
            .pragma_update(None, "user_version", CURRENT_USER_DB_VERSION + 1)
            .unwrap();
        assert!(matches!(
            crate::db::UserDb::open(&path),
            Err(UserDbInitError::NewerSchemaVersion { found, supported })
                if found == CURRENT_USER_DB_VERSION + 1 && supported == CURRENT_USER_DB_VERSION
        ));
        assert!(
            files_starting_with(&path, ".").is_empty(),
            "nothing is set aside"
        );
        let kept = Connection::open(&path).unwrap();
        assert_eq!(schema_version(&kept).unwrap(), CURRENT_USER_DB_VERSION + 1);
        drop(kept);
        std::fs::remove_file(path).unwrap();
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
    fn initialization_rejects_foreign_key_violations() {
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
            Ok(_) => panic!("a foreign-key violation should be rejected"),
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
