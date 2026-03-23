use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SpeciesListItem {
    pub canonical_name: String,
    pub common_name: Option<String>,
    pub family: String,
    pub genus: String,
    pub height_max_m: Option<f32>,
    pub hardiness_zone_min: Option<i32>,
    pub hardiness_zone_max: Option<i32>,
    pub growth_rate: Option<String>,
    pub stratum: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SpeciesDetail {
    pub canonical_name: String,
    pub common_name: Option<String>,
    pub family: String,
    pub genus: String,
    pub height_min_m: Option<f32>,
    pub height_max_m: Option<f32>,
    pub width_max_m: Option<f32>,
    pub hardiness_zone_min: Option<i32>,
    pub hardiness_zone_max: Option<i32>,
    pub soil_ph_min: Option<f32>,
    pub soil_ph_max: Option<f32>,
    pub growth_rate: Option<String>,
    pub edibility_rating: Option<i32>,
    pub medicinal_rating: Option<i32>,
    pub habit: Option<String>,
    pub deciduous_evergreen: Option<String>,
    pub stratum: Option<String>,
    pub nitrogen_fixation: Option<bool>,
    pub tolerates_full_sun: Option<bool>,
    pub tolerates_semi_shade: Option<bool>,
    pub tolerates_full_shade: Option<bool>,
    pub uses: Vec<String>,
    pub relationships: Vec<Relationship>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct Relationship {
    pub related_canonical_name: String,
    pub relationship_type: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
pub struct SpeciesFilter {
    pub hardiness_min: Option<i32>,
    pub hardiness_max: Option<i32>,
    pub height_max: Option<f32>,
    pub sun_tolerance: Option<Vec<String>>,
    pub soil_types: Option<Vec<String>>,
    pub growth_rate: Option<Vec<String>>,
    pub life_cycle: Option<Vec<String>>,
    pub edible: Option<bool>,
    pub nitrogen_fixer: Option<bool>,
    pub stratum: Option<Vec<String>>,
    pub family: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct PaginatedResult<T: specta::Type> {
    pub items: Vec<T>,
    pub next_cursor: Option<String>,
    pub total_estimate: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct FilterOptions {
    pub families: Vec<String>,
    pub growth_rates: Vec<String>,
    pub soil_types: Vec<String>,
    pub strata: Vec<String>,
    pub hardiness_range: (i32, i32),
}
