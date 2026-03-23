use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct Topic {
    pub slug: String,
    pub title: String,
    pub description: Option<String>,
    pub category: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct DbStatus {
    pub core_db_available: bool,
    pub full_db_available: bool,
    pub species_count: u64,
    pub core_db_size_bytes: u64,
    pub full_db_size_bytes: Option<u64>,
}
