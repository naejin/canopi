pub mod design_notebook;
pub(crate) mod plant_catalog_connection;
pub mod plant_db;
pub(crate) mod plant_filter_fields;
pub mod query_builder;
pub mod recent_files;
pub(crate) mod schema_contract;
pub(crate) mod species_search_normalization;
#[cfg(test)]
pub(crate) mod test_support;
pub mod user_db;

use common_types::health::PlantDbStatus;
use rusqlite::{Connection, InterruptHandle};
use std::ops::Deref;
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};

pub use user_db::UserDbInitError;

/// Plant database availability boundary.
///
/// When the bundled plant DB is missing or corrupt, the app shell still starts,
/// but species-dependent services must fail explicitly instead of receiving a
/// fake in-memory connection that looks usable.
#[derive(Clone)]
pub struct PlantDb(PlantDbState);

#[derive(Clone)]
enum PlantDbState {
    Available {
        connection: Arc<Mutex<Connection>>,
        interrupt: Arc<InterruptHandle>,
    },
    Missing,
    Corrupt,
}

impl PlantDb {
    pub fn available(connection: Connection) -> Self {
        if let Err(error) = plant_catalog_connection::admit_prepared_catalog(&connection) {
            tracing::error!("Rejected bundled plant database: {error}");
            return Self(PlantDbState::Corrupt);
        }
        let interrupt = Arc::new(connection.get_interrupt_handle());
        Self(PlantDbState::Available {
            connection: Arc::new(Mutex::new(connection)),
            interrupt,
        })
    }

    pub fn missing() -> Self {
        Self(PlantDbState::Missing)
    }

    pub fn corrupt() -> Self {
        Self(PlantDbState::Corrupt)
    }

    pub fn status(&self) -> PlantDbStatus {
        match &self.0 {
            PlantDbState::Available { .. } => PlantDbStatus::Available,
            PlantDbState::Missing => PlantDbStatus::Missing,
            PlantDbState::Corrupt => PlantDbStatus::Corrupt,
        }
    }

    pub fn interrupt_handle(&self) -> Option<Arc<InterruptHandle>> {
        match &self.0 {
            PlantDbState::Available { interrupt, .. } => Some(Arc::clone(interrupt)),
            PlantDbState::Missing | PlantDbState::Corrupt => None,
        }
    }
}

pub(crate) struct PlantDbConnectionGuard<'a>(MutexGuard<'a, Connection>);

impl Deref for PlantDbConnectionGuard<'_> {
    type Target = Connection;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

/// User database — writable, serialized access via Mutex.
#[derive(Clone)]
pub struct UserDb(Arc<Mutex<Connection>>);

impl UserDb {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, UserDbInitError> {
        let connection = Connection::open(path).map_err(UserDbInitError::Open)?;
        Self::initialize(connection)
    }

    pub fn initialize(connection: Connection) -> Result<Self, UserDbInitError> {
        user_db::initialize_connection(&connection)?;
        Ok(Self(Arc::new(Mutex::new(connection))))
    }

    pub(crate) fn acquire(&self) -> MutexGuard<'_, Connection> {
        acquire(&self.0, "UserDb")
    }
}

pub fn acquire<'a, T>(mutex: &'a Mutex<T>, name: &str) -> MutexGuard<'a, T> {
    mutex.lock().unwrap_or_else(|e| {
        tracing::warn!("Recovered poisoned {name} lock; a prior command panicked while holding it");
        e.into_inner()
    })
}

pub fn plant_db_unavailable_error(status: PlantDbStatus) -> String {
    match status {
        PlantDbStatus::Available => "Plant database unavailable".to_owned(),
        PlantDbStatus::Missing => {
            "Plant database unavailable: bundled plant database is missing".to_owned()
        }
        PlantDbStatus::Corrupt => {
            "Plant database unavailable: bundled plant database is corrupt".to_owned()
        }
    }
}

pub(crate) fn require_plant_db(plant_db: &PlantDb) -> Result<PlantDbConnectionGuard<'_>, String> {
    match &plant_db.0 {
        PlantDbState::Available { connection, .. } => {
            Ok(PlantDbConnectionGuard(acquire(connection, "PlantDb")))
        }
        PlantDbState::Missing => Err(plant_db_unavailable_error(PlantDbStatus::Missing)),
        PlantDbState::Corrupt => Err(plant_db_unavailable_error(PlantDbStatus::Corrupt)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connection_with_identity(schema_version: i32, fingerprint: &str) -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        plant_catalog_connection::stamp_expected_prepared_identity(&connection);
        connection
            .execute(
                "UPDATE species_search_metadata SET value = ?2 WHERE key = ?1",
                ("normalization_fingerprint", fingerprint),
            )
            .unwrap();
        connection
            .pragma_update(None, "user_version", schema_version)
            .unwrap();
        connection
    }

    #[test]
    fn plant_db_rejects_stale_v12_without_normalization_identity() {
        let connection = Connection::open_in_memory().unwrap();
        connection.pragma_update(None, "user_version", 12).unwrap();

        assert_eq!(
            PlantDb::available(connection).status(),
            PlantDbStatus::Corrupt
        );
    }

    #[test]
    fn plant_db_rejects_current_schema_with_missing_normalization_identity() {
        let missing_table = Connection::open_in_memory().unwrap();
        missing_table
            .pragma_update(
                None,
                "user_version",
                schema_contract::EXPECTED_PLANT_SCHEMA_VERSION,
            )
            .unwrap();
        assert_eq!(
            PlantDb::available(missing_table).status(),
            PlantDbStatus::Corrupt
        );

        let missing_key = connection_with_identity(
            schema_contract::EXPECTED_PLANT_SCHEMA_VERSION,
            schema_contract::SPECIES_SEARCH_NORMALIZATION_FINGERPRINT,
        );
        missing_key
            .execute(
                "DELETE FROM species_search_metadata WHERE key = 'normalization_fingerprint'",
                [],
            )
            .unwrap();
        assert_eq!(
            PlantDb::available(missing_key).status(),
            PlantDbStatus::Corrupt
        );
    }

    #[test]
    fn plant_db_rejects_current_schema_with_any_wrong_embedded_identity() {
        for key in [
            "schema_version",
            "storage_contract_fingerprint",
            "normalization_version",
            "normalization_fingerprint",
        ] {
            let connection = connection_with_identity(
                schema_contract::EXPECTED_PLANT_SCHEMA_VERSION,
                schema_contract::SPECIES_SEARCH_NORMALIZATION_FINGERPRINT,
            );
            connection
                .execute(
                    "UPDATE species_search_metadata SET value = 'wrong' WHERE key = ?1",
                    [key],
                )
                .unwrap();

            assert_eq!(
                PlantDb::available(connection).status(),
                PlantDbStatus::Corrupt,
                "wrong {key} was admitted",
            );
        }
    }

    #[test]
    fn plant_db_accepts_exact_schema_and_normalization_identity() {
        let connection = connection_with_identity(
            schema_contract::EXPECTED_PLANT_SCHEMA_VERSION,
            schema_contract::SPECIES_SEARCH_NORMALIZATION_FINGERPRINT,
        );

        assert_eq!(
            PlantDb::available(connection).status(),
            PlantDbStatus::Available
        );
    }

    #[test]
    fn plant_db_rejects_duplicate_or_extra_identity_keys() {
        let duplicate = Connection::open_in_memory().unwrap();
        plant_catalog_connection::stamp_expected_prepared_identity(&duplicate);
        duplicate
            .execute_batch(
                "ALTER TABLE species_search_metadata RENAME TO original_identity;
                CREATE TABLE species_search_metadata (key TEXT, value TEXT NOT NULL);
                INSERT INTO species_search_metadata SELECT key, value FROM original_identity;
                INSERT INTO species_search_metadata
                    SELECT key, value FROM original_identity
                    WHERE key = 'normalization_fingerprint';",
            )
            .unwrap();
        assert_eq!(
            PlantDb::available(duplicate).status(),
            PlantDbStatus::Corrupt
        );

        let extra = Connection::open_in_memory().unwrap();
        plant_catalog_connection::stamp_expected_prepared_identity(&extra);
        extra
            .execute(
                "INSERT INTO species_search_metadata (key, value) VALUES ('unexpected', 'value')",
                [],
            )
            .unwrap();
        assert_eq!(PlantDb::available(extra).status(), PlantDbStatus::Corrupt);
    }
}
