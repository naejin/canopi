pub mod design_notebook;
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
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};

pub use user_db::UserDbInitError;

/// Plant database availability boundary.
///
/// When the bundled plant DB is missing or corrupt, the app shell still starts,
/// but species-dependent services must fail explicitly instead of receiving a
/// fake in-memory connection that looks usable.
#[derive(Clone)]
pub enum PlantDb {
    Available {
        connection: Arc<Mutex<Connection>>,
        interrupt: Arc<InterruptHandle>,
    },
    Missing,
    Corrupt,
}

impl PlantDb {
    pub fn available(connection: Connection) -> Self {
        if let Err(error) = species_search_normalization::register_sqlite_function(&connection) {
            tracing::error!("Failed to register Species Search normalization function: {error}");
            return Self::Corrupt;
        }
        let interrupt = Arc::new(connection.get_interrupt_handle());
        Self::Available {
            connection: Arc::new(Mutex::new(connection)),
            interrupt,
        }
    }

    pub fn missing() -> Self {
        Self::Missing
    }

    pub fn corrupt() -> Self {
        Self::Corrupt
    }

    pub fn status(&self) -> PlantDbStatus {
        match self {
            Self::Available { .. } => PlantDbStatus::Available,
            Self::Missing => PlantDbStatus::Missing,
            Self::Corrupt => PlantDbStatus::Corrupt,
        }
    }

    pub fn interrupt_handle(&self) -> Option<Arc<InterruptHandle>> {
        match self {
            Self::Available { interrupt, .. } => Some(Arc::clone(interrupt)),
            Self::Missing | Self::Corrupt => None,
        }
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

pub fn require_plant_db<'a>(plant_db: &'a PlantDb) -> Result<MutexGuard<'a, Connection>, String> {
    match plant_db {
        PlantDb::Available { connection, .. } => Ok(acquire(connection, "PlantDb")),
        PlantDb::Missing => Err(plant_db_unavailable_error(PlantDbStatus::Missing)),
        PlantDb::Corrupt => Err(plant_db_unavailable_error(PlantDbStatus::Corrupt)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connection_with_identity(schema_version: i32, fingerprint: &str) -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE species_search_metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );",
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO species_search_metadata (key, value) VALUES (?1, ?2)",
                ("normalization_version", "1"),
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO species_search_metadata (key, value) VALUES (?1, ?2)",
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
    fn plant_db_rejects_current_schema_with_wrong_normalization_fingerprint() {
        let connection = connection_with_identity(
            schema_contract::EXPECTED_PLANT_SCHEMA_VERSION,
            "wrong-fingerprint",
        );

        assert_eq!(
            PlantDb::available(connection).status(),
            PlantDbStatus::Corrupt
        );
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
}
