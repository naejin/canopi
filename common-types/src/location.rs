use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct GeoResult {
    pub display_name: String,
    pub lat: f64,
    pub lon: f64,
}
