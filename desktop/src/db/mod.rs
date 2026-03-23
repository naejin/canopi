pub mod user_db;

use std::sync::Mutex;
use rusqlite::Connection;

/// User database — writable, serialized access via Mutex.
pub struct UserDb(pub Mutex<Connection>);

// PlantDb will be added in Phase 1 when the plant database is wired up.
// It will also use Mutex<Connection> since rusqlite::Connection is not Sync.
