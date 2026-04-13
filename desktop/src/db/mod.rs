pub mod plant_db;
pub mod query_builder;
pub mod recent_files;
pub(crate) mod schema_contract;
#[cfg(test)]
pub(crate) mod test_support;
pub mod user_db;

use rusqlite::Connection;
use std::sync::{Mutex, MutexGuard};

/// Plant database — read-only, serialized access via Mutex
/// (rusqlite::Connection is not Sync, so Arc alone would be unsound).
pub struct PlantDb(pub Mutex<Connection>);

/// User database — writable, serialized access via Mutex.
pub struct UserDb(pub Mutex<Connection>);

pub fn acquire<'a, T>(mutex: &'a Mutex<T>, name: &str) -> MutexGuard<'a, T> {
    mutex.lock().unwrap_or_else(|e| {
        tracing::warn!("Recovered poisoned {name} lock; a prior command panicked while holding it");
        e.into_inner()
    })
}
