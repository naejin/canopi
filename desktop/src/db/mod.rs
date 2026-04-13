pub mod plant_db;
pub mod query_builder;
pub mod recent_files;
pub(crate) mod schema_contract;
#[cfg(test)]
pub(crate) mod test_support;
pub mod user_db;

use common_types::health::PlantDbStatus;
use rusqlite::Connection;
use std::sync::{Mutex, MutexGuard};

/// Plant database availability boundary.
///
/// When the bundled plant DB is missing or corrupt, the app shell still starts,
/// but species-dependent services must fail explicitly instead of receiving a
/// fake in-memory connection that looks usable.
pub enum PlantDb {
    Available(Mutex<Connection>),
    Missing,
    Corrupt,
}

impl PlantDb {
    pub fn available(connection: Connection) -> Self {
        Self::Available(Mutex::new(connection))
    }

    pub fn missing() -> Self {
        Self::Missing
    }

    pub fn corrupt() -> Self {
        Self::Corrupt
    }

    pub fn status(&self) -> PlantDbStatus {
        match self {
            Self::Available(_) => PlantDbStatus::Available,
            Self::Missing => PlantDbStatus::Missing,
            Self::Corrupt => PlantDbStatus::Corrupt,
        }
    }
}

/// User database — writable, serialized access via Mutex.
pub struct UserDb(pub Mutex<Connection>);

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
        PlantDb::Available(connection) => Ok(acquire(connection, "PlantDb")),
        PlantDb::Missing => Err(plant_db_unavailable_error(PlantDbStatus::Missing)),
        PlantDb::Corrupt => Err(plant_db_unavailable_error(PlantDbStatus::Corrupt)),
    }
}
