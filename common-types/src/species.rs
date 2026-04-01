use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SpeciesListItem {
    pub canonical_name: String,
    pub slug: String,
    pub common_name: Option<String>,
    pub family: Option<String>,
    pub genus: Option<String>,
    pub height_max_m: Option<f32>,
    pub hardiness_zone_min: Option<i32>,
    pub hardiness_zone_max: Option<i32>,
    pub growth_rate: Option<String>,
    pub stratum: Option<String>,
    pub edibility_rating: Option<i32>,
    pub medicinal_rating: Option<i32>,
    pub width_max_m: Option<f32>,
    pub is_favorite: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SpeciesDetail {
    pub canonical_name: String,
    pub common_name: Option<String>,
    pub family: Option<String>,
    pub genus: Option<String>,
    // Taxonomy
    pub taxonomic_order: Option<String>,
    pub taxonomic_class: Option<String>,
    pub is_hybrid: Option<bool>,
    // Match / provenance
    pub match_confidence: Option<String>,
    pub tnrs_taxonomic_status: Option<String>,
    pub match_score: Option<f32>,
    pub source: Option<String>,
    pub enriched_at: Option<String>,
    pub enrichment_provenance: Option<String>,
    // Dimensions
    pub height_min_m: Option<f32>,
    pub height_max_m: Option<f32>,
    pub width_max_m: Option<f32>,
    pub hardiness_zone_min: Option<i32>,
    pub hardiness_zone_max: Option<i32>,
    pub age_of_maturity_years: Option<f32>,
    pub growth_rate: Option<String>,
    // Life cycle
    pub is_annual: Option<bool>,
    pub is_biennial: Option<bool>,
    pub is_perennial: Option<bool>,
    pub lifespan: Option<String>,
    pub deciduous_evergreen: Option<String>,
    pub leaf_retention: Option<bool>,
    pub active_growth_period: Option<String>,
    // Growth form
    pub habit: Option<String>,
    pub growth_form_type: Option<String>,
    pub growth_form_shape: Option<String>,
    pub growth_habit: Option<String>,
    pub woody: Option<bool>,
    pub canopy_position: Option<String>,
    pub resprout_ability: Option<bool>,
    pub coppice_potential: Option<bool>,
    // Bloom
    pub bloom_period: Option<String>,
    pub flower_color: Option<String>,
    pub pollinators: Option<String>,
    // Light & climate
    pub tolerates_full_sun: Option<bool>,
    pub tolerates_semi_shade: Option<bool>,
    pub tolerates_full_shade: Option<bool>,
    pub frost_tender: Option<bool>,
    pub frost_free_days_min: Option<i32>,
    pub drought_tolerance: Option<String>,
    pub precip_min_inches: Option<f32>,
    pub precip_max_inches: Option<f32>,
    // Soil
    pub soil_ph_min: Option<f32>,
    pub soil_ph_max: Option<f32>,
    pub well_drained: Option<bool>,
    pub heavy_clay: Option<bool>,
    pub tolerates_light_soil: Option<bool>,
    pub tolerates_medium_soil: Option<bool>,
    pub tolerates_heavy_soil: Option<bool>,
    pub tolerates_acid: Option<bool>,
    pub tolerates_alkaline: Option<bool>,
    pub tolerates_saline: Option<bool>,
    pub tolerates_wind: Option<bool>,
    pub tolerates_pollution: Option<bool>,
    pub tolerates_nutritionally_poor: Option<bool>,
    pub fertility_requirement: Option<String>,
    pub moisture_use: Option<String>,
    pub anaerobic_tolerance: Option<String>,
    pub root_depth_min_cm: Option<f32>,
    pub salinity_tolerance: Option<String>,
    // Ecology
    pub stratum: Option<String>,
    pub succession_stage: Option<String>,
    pub stratum_confidence: Option<f32>,
    pub succession_confidence: Option<f32>,
    pub nitrogen_fixer: Option<bool>,
    pub ecological_system: Option<String>,
    pub mycorrhizal_type: Option<String>,
    pub grime_strategy: Option<String>,
    pub raunkiaer_life_form: Option<String>,
    pub cn_ratio: Option<String>,
    pub allelopathic: Option<bool>,
    pub root_system_type: Option<String>,
    pub taproot_persistent: Option<bool>,
    // Uses & ratings
    pub edibility_rating: Option<i32>,
    pub medicinal_rating: Option<i32>,
    pub other_uses_rating: Option<i32>,
    pub edible_uses: Option<String>,
    pub medicinal_uses: Option<String>,
    pub other_uses: Option<String>,
    pub special_uses: Option<String>,
    pub attracts_wildlife: Option<bool>,
    pub scented: Option<bool>,
    pub uses: Vec<SpeciesUse>,
    // Propagation
    pub propagated_by_seed: Option<bool>,
    pub propagated_by_cuttings: Option<bool>,
    pub propagated_by_bare_root: Option<bool>,
    pub propagated_by_container: Option<bool>,
    pub propagated_by_sprigs: Option<bool>,
    pub propagated_by_bulb: Option<bool>,
    pub propagated_by_sod: Option<bool>,
    pub propagated_by_tubers: Option<bool>,
    pub propagated_by_corm: Option<bool>,
    pub cold_stratification_required: Option<bool>,
    pub vegetative_spread_rate: Option<String>,
    pub seed_spread_rate: Option<String>,
    pub propagation_method: Option<String>,
    pub sowing_period: Option<String>,
    pub harvest_period: Option<String>,
    pub dormancy_conditions: Option<String>,
    pub management_types: Option<String>,
    // Fruit & seed
    pub fruit_type: Option<String>,
    pub fruit_seed_color: Option<String>,
    pub fruit_seed_period_begin: Option<String>,
    pub fruit_seed_period_end: Option<String>,
    pub fruit_seed_abundance: Option<String>,
    pub fruit_seed_persistence: Option<bool>,
    pub seed_mass_mg: Option<f32>,
    pub seed_length_mm: Option<f32>,
    pub seed_germination_rate: Option<f32>,
    pub seed_dispersal_mechanism: Option<String>,
    pub seed_storage_behaviour: Option<String>,
    pub seed_dormancy_type: Option<String>,
    pub seed_dormancy_depth: Option<String>,
    pub serotinous: Option<bool>,
    pub seedbank_type: Option<String>,
    // Leaf
    pub leaf_type: Option<String>,
    pub leaf_compoundness: Option<String>,
    pub leaf_shape: Option<String>,
    pub sla_mm2_mg: Option<f32>,
    pub ldmc_g_g: Option<f32>,
    pub leaf_nitrogen_mg_g: Option<f32>,
    pub leaf_carbon_mg_g: Option<f32>,
    pub leaf_phosphorus_mg_g: Option<f32>,
    pub leaf_dry_mass_mg: Option<f32>,
    // Reproduction
    pub pollination_syndrome: Option<String>,
    pub sexual_system: Option<String>,
    pub mating_system: Option<String>,
    pub self_fertile: Option<bool>,
    pub reproductive_type: Option<String>,
    pub clonal_growth_form: Option<String>,
    pub storage_organ: Option<String>,
    // Risk
    pub toxicity: Option<String>,
    pub known_hazards: Option<String>,
    pub invasive_potential: Option<String>,
    pub biogeographic_status: Option<String>,
    pub noxious_status: Option<bool>,
    pub invasive_usda: Option<bool>,
    pub weed_potential: Option<bool>,
    pub fire_resistant: Option<bool>,
    pub fire_tolerance: Option<String>,
    pub hedge_tolerance: Option<String>,
    pub pests_diseases: Option<String>,
    // Distribution
    pub native_range: Option<String>,
    pub native_distribution: Option<String>,
    pub introduced_distribution: Option<String>,
    pub range_text: Option<String>,
    pub conservation_status: Option<String>,
    // Text / notes
    pub summary: Option<String>,
    pub physical_characteristics: Option<String>,
    pub cultivation_notes: Option<String>,
    pub propagation_notes: Option<String>,
    pub habitats: Option<String>,
    pub carbon_farming: Option<String>,
    // Media
    pub image_urls: Option<String>,
    // Ellenberg indicators
    pub ellenberg_light: Option<f32>,
    pub ellenberg_temperature: Option<f32>,
    pub ellenberg_moisture: Option<f32>,
    pub ellenberg_reaction: Option<f32>,
    pub ellenberg_nitrogen: Option<f32>,
    pub ellenberg_salt: Option<f32>,
    // Classification / ML
    pub classification_source: Option<String>,
    pub model_version: Option<String>,
    pub prompt_version: Option<String>,
    pub reasoning: Option<String>,
    pub classified_at: Option<String>,
    pub validation_flags: Option<String>,
    pub overall_confidence: Option<f32>,
    pub validation_flag_count: Option<i32>,
    // Science
    pub data_quality_tier: Option<String>,
    pub wood_density_g_cm3: Option<f32>,
    pub photosynthesis_pathway: Option<String>,
    // Relations
    pub relationships: Vec<Relationship>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct FlowerColorResolution {
    pub canonical_name: String,
    pub flower_color: Option<String>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SpeciesUse {
    pub use_category: String,
    pub use_description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct Relationship {
    pub related_canonical_name: String,
    pub relationship_type: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SpeciesImage {
    pub id: String,
    pub species_id: String,
    pub url: String,
    pub source: Option<String>,
    pub sort_order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SpeciesExternalLink {
    pub id: String,
    pub species_id: String,
    pub link_type: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CommonNameEntry {
    pub name: String,
    pub is_primary: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
pub struct SpeciesFilter {
    pub hardiness_min: Option<i32>,
    pub hardiness_max: Option<i32>,
    pub height_max: Option<f32>,
    pub height_min: Option<f32>,
    pub sun_tolerances: Option<Vec<String>>,
    pub soil_tolerances: Option<Vec<String>>,
    pub growth_rate: Option<Vec<String>>,
    pub life_cycle: Option<Vec<String>>,
    pub edible: Option<bool>,
    pub edibility_min: Option<i32>,
    pub nitrogen_fixer: Option<bool>,
    pub stratum: Option<Vec<String>>,
    pub family: Option<String>,
    pub extra: Option<Vec<DynamicFilter>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub enum Sort {
    Name,
    Family,
    Height,
    Hardiness,
    GrowthRate,
    Relevance,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct PaginatedResult<T: specta::Type> {
    pub items: Vec<T>,
    pub next_cursor: Option<String>,
    pub total_estimate: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct FilterOptions {
    pub families: Vec<String>,
    pub growth_rates: Vec<String>,
    pub strata: Vec<String>,
    pub hardiness_range: (i32, i32),
    pub life_cycles: Vec<String>,
    pub sun_tolerances: Vec<String>,
    pub soil_tolerances: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct DynamicFilter {
    pub field: String,
    pub op: FilterOp,
    pub values: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub enum FilterOp {
    Equals,
    In,
    Gte,
    Lte,
    Between,
    IsTrue,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct DynamicFilterOptions {
    pub field: String,
    pub field_type: String,
    pub values: Option<Vec<FilterValue>>,
    pub range: Option<(f64, f64)>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct FilterValue {
    pub value: String,
    pub label: String,
}
