pub mod user_db;

use std::sync::{Arc, Mutex};
use rusqlite::Connection;

/// Plant database — read-only, concurrent reads safe in WAL mode.
pub struct PlantDb(pub Arc<Connection>);

/// User database — writable, serialized access via Mutex.
pub struct UserDb(pub Mutex<Connection>);
