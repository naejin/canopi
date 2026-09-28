//! The user database migration ladder (ADR 0013).
//!
//! This module is the only place that knows what an older user database looks
//! like. [`upgrade`] takes a database at a supported older `user_version` and
//! runs one pure step per version, all inside one transaction, then runs the
//! same integrity check a fresh database gets before committing. If anything
//! fails the transaction rolls back and the file is left exactly as it was;
//! the caller reports the typed error and never sets the database aside.
//!
//! History of the schema (`PRAGMA user_version`), recovered from git:
//!
//! | version | shipped in | change |
//! |---|---|---|
//! | 1 | never (pre-release) | `settings`, `recent_files`, `favorites` |
//! | 2 | Canopi 0.1.0 | `recently_viewed` and its pruning trigger |
//! | 3 | Canopi 0.8.0 | `saved_object_stamps` |
//! | 4 | dev builds | `design_notebook_entries` |
//! | 5 | dev builds | `design_notebook_sections`, `design_notebook_section_memberships` |
//! | 6 | dev builds | `design_notebook_entries.pinned` (removed again at 8) |
//! | 7 | dev builds | `sort_order` on sections and entries, backfilled |
//! | 8 | Canopi 1.0.0 to 1.2.0 | `pinned` dropped |
//! | 9 | Canopi v2 | same tables; orphan memberships removed so foreign keys verify |
//!
//! The ladder starts at 2, the first schema a tagged release wrote. Version 1
//! only ever existed in pre-release development builds and is refused.

use rusqlite::{Connection, Transaction};
use std::fmt;

use super::user_db::{CURRENT_USER_DB_VERSION, UserDbInitError, verify_integrity};

/// The oldest `user_version` this build upgrades (Canopi 0.1.0). Anything
/// older is refused with [`UserDbInitError::UnsupportedSchemaVersion`].
pub(crate) const OLDEST_SUPPORTED_USER_DB_VERSION: i32 = 2;

/// Why an upgrade stopped. The transaction has been rolled back.
#[derive(Debug)]
pub enum UserDbMigrationFailure {
    /// The transaction could not be started or committed.
    Transaction(rusqlite::Error),
    /// The step from `version` to `version + 1` failed.
    Step {
        version: i32,
        source: rusqlite::Error,
    },
    /// The upgraded database failed the integrity check a fresh one must pass.
    Integrity(Box<UserDbInitError>),
}

impl fmt::Display for UserDbMigrationFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Transaction(error) => write!(formatter, "transaction failed: {error}"),
            Self::Step { version, source } => write!(
                formatter,
                "step from schema {version} to {} failed: {source}",
                version + 1
            ),
            Self::Integrity(error) => {
                write!(formatter, "upgraded database failed verification: {error}")
            }
        }
    }
}

impl std::error::Error for UserDbMigrationFailure {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Transaction(error) | Self::Step { source: error, .. } => Some(error),
            Self::Integrity(error) => Some(error.as_ref()),
        }
    }
}

type Step = fn(&Transaction<'_>) -> rusqlite::Result<()>;

/// `STEPS[i]` upgrades from `OLDEST_SUPPORTED_USER_DB_VERSION + i` to the next
/// version. The length is checked against the version span at compile time so
/// a bumped `CURRENT_USER_DB_VERSION` cannot ship without its step.
const STEPS: [Step; (CURRENT_USER_DB_VERSION - OLDEST_SUPPORTED_USER_DB_VERSION) as usize] = [
    step_2_to_3_saved_object_stamps,
    step_3_to_4_design_notebook_entries,
    step_4_to_5_design_notebook_sections,
    step_5_to_6_pinned_entries,
    step_6_to_7_notebook_order,
    step_7_to_8_drop_pinned,
    step_8_to_9_remove_orphan_memberships,
];

/// Upgrade a database at schema `from` to [`CURRENT_USER_DB_VERSION`] in one
/// transaction. `from` must be older than the current version; the caller
/// handles empty, current and newer databases.
pub(super) fn upgrade(conn: &Connection, from: i32) -> Result<(), UserDbInitError> {
    if from < OLDEST_SUPPORTED_USER_DB_VERSION {
        return Err(UserDbInitError::UnsupportedSchemaVersion {
            found: from,
            oldest_supported: OLDEST_SUPPORTED_USER_DB_VERSION,
        });
    }
    debug_assert!(from < CURRENT_USER_DB_VERSION);

    run_in_transaction(conn, from).map_err(|source| UserDbInitError::Migration {
        from,
        to: CURRENT_USER_DB_VERSION,
        source,
    })
}

fn run_in_transaction(conn: &Connection, from: i32) -> Result<(), UserDbMigrationFailure> {
    let transaction = conn
        .unchecked_transaction()
        .map_err(UserDbMigrationFailure::Transaction)?;
    for (offset, step) in STEPS
        .iter()
        .enumerate()
        .skip((from - OLDEST_SUPPORTED_USER_DB_VERSION) as usize)
    {
        let version = OLDEST_SUPPORTED_USER_DB_VERSION + offset as i32;
        step(&transaction).map_err(|source| UserDbMigrationFailure::Step { version, source })?;
    }
    transaction
        .pragma_update(None, "user_version", CURRENT_USER_DB_VERSION)
        .map_err(|source| UserDbMigrationFailure::Step {
            version: CURRENT_USER_DB_VERSION - 1,
            source,
        })?;
    verify_integrity(&transaction)
        .map_err(|error| UserDbMigrationFailure::Integrity(Box::new(error)))?;
    transaction
        .commit()
        .map_err(UserDbMigrationFailure::Transaction)
}

fn step_2_to_3_saved_object_stamps(tx: &Transaction<'_>) -> rusqlite::Result<()> {
    tx.execute_batch(
        "CREATE TABLE saved_object_stamps (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            sort_order INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );",
    )
}

fn step_3_to_4_design_notebook_entries(tx: &Transaction<'_>) -> rusqlite::Result<()> {
    tx.execute_batch(
        "CREATE TABLE design_notebook_entries (
            path TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            plant_count INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            last_opened TEXT NOT NULL
        );",
    )
}

fn step_4_to_5_design_notebook_sections(tx: &Transaction<'_>) -> rusqlite::Result<()> {
    tx.execute_batch(
        "CREATE TABLE design_notebook_sections (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
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
        );",
    )
}

/// Version 6 added `design_notebook_entries.pinned`, which version 8 removed
/// again. A database climbing through this step never gets the column; the
/// slot exists so the version numbers of real v6 and v7 databases stay
/// meaningful and step 7 to 8 handles both shapes.
fn step_5_to_6_pinned_entries(_tx: &Transaction<'_>) -> rusqlite::Result<()> {
    Ok(())
}

/// Sections are ordered by creation, entries by most recently opened first,
/// exactly as Canopi 1.0.0 ordered them when it introduced manual ordering.
fn step_6_to_7_notebook_order(tx: &Transaction<'_>) -> rusqlite::Result<()> {
    tx.execute_batch(
        "ALTER TABLE design_notebook_sections
         ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

         UPDATE design_notebook_sections
         SET sort_order = (
             SELECT COUNT(*)
             FROM design_notebook_sections AS earlier
             WHERE earlier.created_at < design_notebook_sections.created_at
                OR (
                     earlier.created_at = design_notebook_sections.created_at
                     AND earlier.id < design_notebook_sections.id
                )
         );

         ALTER TABLE design_notebook_entries
         ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

         UPDATE design_notebook_entries
         SET sort_order = (
             SELECT COUNT(*)
             FROM design_notebook_entries AS earlier
             WHERE earlier.last_opened > design_notebook_entries.last_opened
                OR (
                     earlier.last_opened = design_notebook_entries.last_opened
                     AND earlier.created_at > design_notebook_entries.created_at
                )
                OR (
                     earlier.last_opened = design_notebook_entries.last_opened
                     AND earlier.created_at = design_notebook_entries.created_at
                     AND earlier.path < design_notebook_entries.path
                )
         );",
    )
}

/// Drops the short-lived `pinned` column when the database really has it (a
/// v6 or v7 database); one that climbed from v5 or below never got it.
fn step_7_to_8_drop_pinned(tx: &Transaction<'_>) -> rusqlite::Result<()> {
    let has_pinned = tx
        .prepare("PRAGMA table_info(design_notebook_entries)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<_>>>()?
        .iter()
        .any(|column| column == "pinned");
    if has_pinned {
        tx.execute_batch("ALTER TABLE design_notebook_entries DROP COLUMN pinned;")?;
    }
    Ok(())
}

/// Version 9 changed no table. Databases written before foreign keys were
/// enforced may hold memberships whose entry or section is gone; they would
/// fail the foreign-key check every current database must pass, so they go.
fn step_8_to_9_remove_orphan_memberships(tx: &Transaction<'_>) -> rusqlite::Result<()> {
    tx.execute(
        "DELETE FROM design_notebook_section_memberships
         WHERE NOT EXISTS (
            SELECT 1 FROM design_notebook_entries
            WHERE design_notebook_entries.path = design_notebook_section_memberships.path
         )
         OR NOT EXISTS (
            SELECT 1 FROM design_notebook_sections
            WHERE design_notebook_sections.id = design_notebook_section_memberships.section_id
         )",
        [],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::UserDb;
    use crate::db::user_db::{
        get_favorite_names, get_recently_viewed_names, get_saved_object_stamps, get_setting,
        schema_version,
    };
    use std::path::{Path, PathBuf};

    /// The `CREATE` statements each historical version wrote, as its own
    /// release ran them (recovered from `desktop/migrations/*.sql`).
    fn historical_schema(version: i32) -> String {
        assert!((1..CURRENT_USER_DB_VERSION).contains(&version));
        let mut sql = String::from(
            "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE recent_files (
                 path TEXT PRIMARY KEY, name TEXT NOT NULL, last_opened TEXT NOT NULL
             );
             CREATE TABLE favorites (canonical_name TEXT PRIMARY KEY, added_at TEXT NOT NULL);",
        );
        if version >= 2 {
            sql.push_str(
                "CREATE TABLE recently_viewed (
                     canonical_name TEXT PRIMARY KEY,
                     viewed_at TEXT NOT NULL DEFAULT (datetime('now'))
                 );
                 CREATE TRIGGER limit_recently_viewed
                 AFTER INSERT ON recently_viewed
                 BEGIN
                     DELETE FROM recently_viewed WHERE canonical_name NOT IN (
                         SELECT canonical_name FROM recently_viewed
                         ORDER BY viewed_at DESC LIMIT 50
                     );
                 END;",
            );
        }
        if version >= 3 {
            sql.push_str(
                "CREATE TABLE saved_object_stamps (
                     id TEXT PRIMARY KEY,
                     name TEXT NOT NULL,
                     payload_json TEXT NOT NULL,
                     sort_order INTEGER NOT NULL,
                     created_at TEXT NOT NULL,
                     updated_at TEXT NOT NULL
                 );",
            );
        }
        if version >= 4 {
            sql.push_str(
                "CREATE TABLE design_notebook_entries (
                     path TEXT PRIMARY KEY,
                     name TEXT NOT NULL,
                     updated_at TEXT NOT NULL,
                     plant_count INTEGER NOT NULL DEFAULT 0,
                     created_at TEXT NOT NULL,
                     last_opened TEXT NOT NULL
                 );",
            );
        }
        if version >= 5 {
            sql.push_str(
                "CREATE TABLE design_notebook_sections (
                     id TEXT PRIMARY KEY,
                     name TEXT NOT NULL,
                     created_at TEXT NOT NULL,
                     updated_at TEXT NOT NULL
                 );
                 CREATE TABLE design_notebook_section_memberships (
                     path TEXT PRIMARY KEY,
                     section_id TEXT NOT NULL,
                     created_at TEXT NOT NULL,
                     updated_at TEXT NOT NULL,
                     FOREIGN KEY(path) REFERENCES design_notebook_entries(path)
                         ON DELETE CASCADE,
                     FOREIGN KEY(section_id) REFERENCES design_notebook_sections(id)
                         ON DELETE CASCADE
                 );",
            );
        }
        if (6..8).contains(&version) {
            sql.push_str(
                "ALTER TABLE design_notebook_entries
                 ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;",
            );
        }
        if version >= 7 {
            sql.push_str(
                "ALTER TABLE design_notebook_sections
                 ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
                 ALTER TABLE design_notebook_entries
                 ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;",
            );
        }
        sql.push_str(&format!("PRAGMA user_version = {version};"));
        sql
    }

    /// Rows a user of that version could have written. Foreign keys are off
    /// while writing, as they were in every release before Canopi 1.0.1, so
    /// the v5+ fixtures also carry one orphan membership.
    fn sample_rows(version: i32) -> String {
        let mut sql = String::from(
            "INSERT INTO settings VALUES ('locale', 'fr');
             INSERT INTO recent_files VALUES ('/designs/verger.canopi', 'Verger', '2026-05-01T10:00:00Z');
             INSERT INTO favorites VALUES ('Malus domestica', '2026-05-01T10:00:00Z');
             INSERT INTO favorites VALUES ('Pyrus communis', '2026-05-02T10:00:00Z');",
        );
        if version >= 2 {
            sql.push_str(
                "INSERT INTO recently_viewed VALUES ('Alnus glutinosa', '2026-05-03T10:00:00Z');",
            );
        }
        if version >= 3 {
            sql.push_str(
                "INSERT INTO saved_object_stamps VALUES
                    ('stamp-a', 'Apple guild', '{\"plants\":[]}', 0, '2026-06-01', '2026-06-01');",
            );
        }
        if version >= 4 {
            let pinned = if (6..8).contains(&version) { ", 1" } else { "" };
            let order = if version >= 7 { ", 0" } else { "" };
            sql.push_str(&format!(
                "INSERT INTO design_notebook_entries
                    (path, name, updated_at, plant_count, created_at, last_opened{pinned_col}{order_col})
                 VALUES
                    ('/designs/verger.canopi', 'Verger', '2026-06-02', 12, '2026-06-01', '2026-06-03'{pinned}{order}),
                    ('/designs/haie.canopi', 'Haie', '2026-06-02', 3, '2026-06-01', '2026-06-02'{pinned}{order});",
                pinned_col = if pinned.is_empty() { "" } else { ", pinned" },
                order_col = if order.is_empty() { "" } else { ", sort_order" },
            ));
        }
        if version >= 5 {
            let order = if version >= 7 { ", 0" } else { "" };
            sql.push_str(&format!(
                "INSERT INTO design_notebook_sections
                    (id, name, created_at, updated_at{order_col})
                 VALUES
                    ('section-b', 'Later', '2026-06-02', '2026-06-02'{order}),
                    ('section-a', 'Earlier', '2026-06-01', '2026-06-01'{order});
                 INSERT INTO design_notebook_section_memberships VALUES
                    ('/designs/verger.canopi', 'section-a', '2026-06-01', '2026-06-01'),
                    ('/designs/gone.canopi', 'section-a', '2026-06-01', '2026-06-01');",
                order_col = if order.is_empty() { "" } else { ", sort_order" },
            ));
        }
        sql
    }

    /// The bundled SQLite enforces foreign keys by default; the fixtures turn
    /// that off so they can hold the orphan rows older databases may contain.
    fn fixture_connection(path: &Path) -> Connection {
        let conn = Connection::open(path).unwrap();
        conn.pragma_update(None, "foreign_keys", false).unwrap();
        conn
    }

    fn temp_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "canopi_user_db_migration_{name}_{}_{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ))
    }

    fn write_fixture(path: &Path, version: i32) {
        let conn = fixture_connection(path);
        conn.execute_batch(&historical_schema(version)).unwrap();
        conn.execute_batch(&sample_rows(version)).unwrap();
    }

    fn sibling_files(path: &Path) -> Vec<PathBuf> {
        let prefix = path.file_name().unwrap().to_string_lossy().into_owned();
        std::fs::read_dir(path.parent().unwrap())
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|candidate| {
                candidate != path
                    && candidate
                        .file_name()
                        .is_some_and(|name| name.to_string_lossy().starts_with(&prefix))
            })
            .collect()
    }

    fn column_names(conn: &Connection, table: &str) -> Vec<String> {
        conn.prepare(&format!("PRAGMA table_info({table})"))
            .unwrap()
            .query_map([], |row| row.get(1))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    }

    fn fresh_schema_columns() -> Vec<(String, Vec<String>)> {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::user_db::initialize_connection(&conn).unwrap();
        table_columns(&conn)
    }

    /// Every table with its column names sorted, so an upgraded database is
    /// compared with a fresh one shape for shape (column order may differ
    /// after `ALTER TABLE`, which no query depends on).
    fn table_columns(conn: &Connection) -> Vec<(String, Vec<String>)> {
        let mut tables: Vec<String> = conn
            .prepare(
                "SELECT name FROM sqlite_master
                 WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
            )
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        tables.sort();
        tables
            .into_iter()
            .map(|table| {
                let mut columns = column_names(conn, &table);
                columns.sort();
                (table, columns)
            })
            .collect()
    }

    #[test]
    fn every_supported_older_version_upgrades_to_the_current_schema_and_keeps_its_rows() {
        let expected_tables = fresh_schema_columns();
        for version in OLDEST_SUPPORTED_USER_DB_VERSION..CURRENT_USER_DB_VERSION {
            let path = temp_path(&format!("v{version}"));
            write_fixture(&path, version);

            let user_db = UserDb::open(&path)
                .unwrap_or_else(|error| panic!("schema {version} must upgrade: {error}"));
            let conn = user_db.acquire();

            assert_eq!(schema_version(&conn).unwrap(), CURRENT_USER_DB_VERSION);
            assert_eq!(table_columns(&conn), expected_tables, "schema {version}");
            crate::db::user_db::verify_integrity(&conn).unwrap();

            assert_eq!(get_setting(&conn, "locale").unwrap().as_deref(), Some("fr"));
            assert_eq!(
                get_favorite_names(&conn).unwrap(),
                ["Pyrus communis", "Malus domestica"]
            );
            assert_eq!(
                get_recently_viewed_names(&conn, 10).unwrap(),
                ["Alnus glutinosa"]
            );
            let recent = crate::db::recent_files::get_recent_files(&conn, 20).unwrap();
            assert_eq!(recent.len(), 1, "schema {version}");
            assert_eq!(recent[0].name, "Verger");
            if version >= 3 {
                let stamps = get_saved_object_stamps(&conn).unwrap();
                assert_eq!(stamps.len(), 1);
                assert_eq!(stamps[0].name, "Apple guild");
            }
            if version >= 4 {
                let entries =
                    crate::db::design_notebook::get_design_notebook_entries_with_sections(&conn)
                        .unwrap();
                let mut names: Vec<_> = entries.iter().map(|entry| entry.name.as_str()).collect();
                names.sort();
                assert_eq!(names, ["Haie", "Verger"], "schema {version}");
                if version < 7 {
                    // Backfilled order: most recently opened first.
                    let verger = entries.iter().find(|entry| entry.name == "Verger").unwrap();
                    let haie = entries.iter().find(|entry| entry.name == "Haie").unwrap();
                    assert_eq!((verger.sort_order, haie.sort_order), (0, 1));
                }
            }
            if version >= 5 {
                let sections = crate::db::design_notebook::get_notebook_sections(&conn).unwrap();
                assert_eq!(
                    sections
                        .iter()
                        .map(|section| section.id.as_str())
                        .collect::<Vec<_>>(),
                    ["section-a", "section-b"],
                    "schema {version}: sections keep creation order"
                );
                let memberships: Vec<(String, String)> = conn
                    .prepare("SELECT path, section_id FROM design_notebook_section_memberships")
                    .unwrap()
                    .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
                    .unwrap()
                    .collect::<Result<_, _>>()
                    .unwrap();
                assert_eq!(
                    memberships,
                    [("/designs/verger.canopi".to_owned(), "section-a".to_owned())],
                    "schema {version}: the orphan membership is gone, the real one kept"
                );
            }

            drop(conn);
            drop(user_db);
            assert!(sibling_files(&path).is_empty(), "nothing set aside");
            std::fs::remove_file(&path).unwrap();
        }
    }

    #[test]
    fn a_failing_step_rolls_back_and_leaves_the_file_byte_identical() {
        let path = temp_path("failing_step");
        {
            let conn = fixture_connection(&path);
            conn.execute_batch(&historical_schema(3)).unwrap();
            conn.execute_batch(&sample_rows(3)).unwrap();
            // A stray table with the name step 3 -> 4 creates makes that step fail.
            conn.execute_batch("CREATE TABLE design_notebook_entries (stray TEXT);")
                .unwrap();
        }
        let before = std::fs::read(&path).unwrap();

        let error = match UserDb::open(&path) {
            Ok(_) => panic!("the upgrade must fail"),
            Err(error) => error,
        };
        assert!(
            matches!(
                error,
                UserDbInitError::Migration {
                    from: 3,
                    to: CURRENT_USER_DB_VERSION,
                    source: UserDbMigrationFailure::Step { version: 3, .. },
                }
            ),
            "{error:?}"
        );
        assert!(
            !error
                .to_string()
                .contains(&path.to_string_lossy().to_string()),
            "no paths in the message"
        );

        assert_eq!(std::fs::read(&path).unwrap(), before, "file unchanged");
        assert!(sibling_files(&path).is_empty(), "nothing set aside");
        let kept = Connection::open(&path).unwrap();
        assert_eq!(schema_version(&kept).unwrap(), 3);
        assert_eq!(get_saved_object_stamps(&kept).unwrap().len(), 1);
        drop(kept);
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn a_failing_integrity_check_after_the_ladder_rolls_back() {
        let path = temp_path("failing_integrity");
        {
            let conn = fixture_connection(&path);
            conn.execute_batch(&historical_schema(8)).unwrap();
            // An unrelated foreign-key violation no step repairs.
            conn.execute_batch(
                "CREATE TABLE stray_parent (id INTEGER PRIMARY KEY);
                 CREATE TABLE stray_child (
                     id INTEGER PRIMARY KEY,
                     parent_id INTEGER NOT NULL REFERENCES stray_parent(id)
                 );
                 INSERT INTO stray_child VALUES (1, 99);",
            )
            .unwrap();
        }
        let before = std::fs::read(&path).unwrap();

        let error = UserDb::open(&path).err().expect("the upgrade must fail");
        assert!(
            matches!(
                error,
                UserDbInitError::Migration {
                    from: 8,
                    source: UserDbMigrationFailure::Integrity(_),
                    ..
                }
            ),
            "{error:?}"
        );
        assert_eq!(std::fs::read(&path).unwrap(), before);
        assert!(sibling_files(&path).is_empty(), "never set aside");
        assert_eq!(
            schema_version(&Connection::open(&path).unwrap()).unwrap(),
            8
        );
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn versions_below_the_oldest_supported_are_refused_untouched() {
        let path = temp_path("too_old");
        write_fixture(&path, 1);
        let before = std::fs::read(&path).unwrap();

        let error = UserDb::open(&path).err().expect("schema 1 is refused");
        assert!(matches!(
            error,
            UserDbInitError::UnsupportedSchemaVersion {
                found: 1,
                oldest_supported: OLDEST_SUPPORTED_USER_DB_VERSION
            }
        ));
        assert_eq!(std::fs::read(&path).unwrap(), before);
        assert!(sibling_files(&path).is_empty());
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn a_newer_schema_is_refused_before_any_step_runs() {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "user_version", CURRENT_USER_DB_VERSION + 1)
            .unwrap();
        assert!(matches!(
            UserDb::initialize(conn),
            Err(UserDbInitError::NewerSchemaVersion { found, supported })
                if found == CURRENT_USER_DB_VERSION + 1 && supported == CURRENT_USER_DB_VERSION
        ));
    }

    #[test]
    fn migration_errors_name_no_paths_and_expose_their_source() {
        let error = UserDbInitError::Migration {
            from: 4,
            to: CURRENT_USER_DB_VERSION,
            source: UserDbMigrationFailure::Step {
                version: 6,
                source: rusqlite::Error::InvalidQuery,
            },
        };
        let message = error.to_string();
        assert!(message.contains("schema 4"), "{message}");
        assert!(message.contains("schema 6 to 7"), "{message}");
        assert!(std::error::Error::source(&error).is_some());
        assert!(!error.sets_aside_as_corrupt(), "never set aside");
    }
}
