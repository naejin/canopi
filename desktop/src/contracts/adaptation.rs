use serde::{Deserialize, Serialize};

/// Result of checking a single species against a target hardiness zone.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CompatibilityResult {
    pub species_id: String,
    pub canonical_name: String,
    pub common_name: Option<String>,
    pub hardiness_min: Option<i32>,
    pub hardiness_max: Option<i32>,
    pub is_compatible: bool,
    /// How many zones the plant is outside the target (0 = compatible).
    pub zone_diff: i32,
}

/// A lighter species record used for replacement suggestions.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReplacementSuggestion {
    pub canonical_name: String,
    pub common_name: Option<String>,
    pub hardiness_min: Option<i32>,
    pub hardiness_max: Option<i32>,
    pub stratum: Option<String>,
    pub height_max_m: Option<f32>,
}
