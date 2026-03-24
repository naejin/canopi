pub mod plant_db;
pub mod query_builder;
pub mod recent_files;
pub mod user_db;

use std::sync::Mutex;
use rusqlite::Connection;

/// Plant database — read-only, serialized access via Mutex
/// (rusqlite::Connection is not Sync, so Arc alone would be unsound).
pub struct PlantDb(pub Mutex<Connection>);

/// User database — writable, serialized access via Mutex.
pub struct UserDb(pub Mutex<Connection>);
