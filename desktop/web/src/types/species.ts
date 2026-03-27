export interface SpeciesListItem {
  canonical_name: string;
  slug: string;
  common_name: string | null;
  family: string | null;
  genus: string | null;
  height_max_m: number | null;
  hardiness_zone_min: number | null;
  hardiness_zone_max: number | null;
  growth_rate: string | null;
  stratum: string | null;
  edibility_rating: number | null;
  medicinal_rating: number | null;
  width_max_m: number | null;
  is_favorite: boolean;
}

export interface SpeciesUse {
  use_category: string;
  use_description: string | null;
}

export interface Relationship {
  related_canonical_name: string;
  relationship_type: string;
  description: string | null;
}

export interface SpeciesImage {
  id: string;
  species_id: string;
  url: string;
  source: string | null;
  sort_order: number;
}

export interface SpeciesExternalLink {
  id: string;
  species_id: string;
  link_type: string;
  url: string;
}

export interface SpeciesDetail {
  canonical_name: string;
  common_name: string | null;
  family: string | null;
  genus: string | null;
  // Match / provenance
  match_confidence: string | null;
  tnrs_taxonomic_status: string | null;
  match_score: number | null;
  source: string | null;
  enriched_at: string | null;
  enrichment_provenance: string | null;
  // Taxonomy
  taxonomic_order: string | null;
  taxonomic_class: string | null;
  is_hybrid: boolean | null;
  // Dimensions
  height_min_m: number | null;
  height_max_m: number | null;
  width_max_m: number | null;
  hardiness_zone_min: number | null;
  hardiness_zone_max: number | null;
  growth_rate: string | null;
  age_of_maturity_years: number | null;
  // Life cycle & form
  is_annual: boolean | null;
  is_biennial: boolean | null;
  is_perennial: boolean | null;
  lifespan: string | null;
  deciduous_evergreen: string | null;
  habit: string | null;
  active_growth_period: string | null;
  leaf_retention: boolean | null;
  // Growth form
  growth_form_type: string | null;
  growth_form_shape: string | null;
  growth_habit: string | null;
  woody: boolean | null;
  canopy_position: string | null;
  resprout_ability: boolean | null;
  coppice_potential: boolean | null;
  // Bloom
  bloom_period: string | null;
  flower_color: string | null;
  pollinators: string | null;
  // Light & climate
  tolerates_full_sun: boolean | null;
  tolerates_semi_shade: boolean | null;
  tolerates_full_shade: boolean | null;
  frost_tender: boolean | null;
  drought_tolerance: string | null;
  frost_free_days_min: number | null;
  precip_min_inches: number | null;
  precip_max_inches: number | null;
  // Soil
  soil_ph_min: number | null;
  soil_ph_max: number | null;
  well_drained: boolean | null;
  heavy_clay: boolean | null;
  tolerates_acid: boolean | null;
  tolerates_alkaline: boolean | null;
  tolerates_saline: boolean | null;
  tolerates_wind: boolean | null;
  tolerates_pollution: boolean | null;
  tolerates_nutritionally_poor: boolean | null;
  tolerates_light_soil: boolean | null;
  tolerates_medium_soil: boolean | null;
  tolerates_heavy_soil: boolean | null;
  fertility_requirement: string | null;
  moisture_use: string | null;
  anaerobic_tolerance: string | null;
  root_depth_min_cm: number | null;
  salinity_tolerance: string | null;
  // Ecology
  stratum: string | null;
  succession_stage: string | null;
  nitrogen_fixer: boolean | null;
  attracts_wildlife: boolean | null;
  scented: boolean | null;
  stratum_confidence: number | null;
  succession_confidence: number | null;
  ecological_system: string | null;
  mycorrhizal_type: string | null;
  grime_strategy: string | null;
  raunkiaer_life_form: string | null;
  cn_ratio: string | null;
  allelopathic: boolean | null;
  root_system_type: string | null;
  taproot_persistent: boolean | null;
  // Uses & ratings
  edibility_rating: number | null;
  medicinal_rating: number | null;
  other_uses_rating: number | null;
  edible_uses: string | null;
  medicinal_uses: string | null;
  other_uses: string | null;
  special_uses: string | null;
  // Propagation
  propagated_by_seed: boolean | null;
  propagated_by_cuttings: boolean | null;
  propagated_by_bare_root: boolean | null;
  propagated_by_container: boolean | null;
  propagated_by_sprigs: boolean | null;
  propagated_by_bulb: boolean | null;
  propagated_by_sod: boolean | null;
  propagated_by_tubers: boolean | null;
  propagated_by_corm: boolean | null;
  cold_stratification_required: boolean | null;
  vegetative_spread_rate: string | null;
  seed_spread_rate: string | null;
  propagation_method: string | null;
  sowing_period: string | null;
  harvest_period: string | null;
  dormancy_conditions: string | null;
  management_types: string | null;
  // Fruit & seed
  fruit_type: string | null;
  fruit_seed_color: string | null;
  fruit_seed_period_begin: string | null;
  fruit_seed_period_end: string | null;
  fruit_seed_abundance: string | null;
  fruit_seed_persistence: boolean | null;
  seed_mass_mg: number | null;
  seed_length_mm: number | null;
  seed_germination_rate: number | null;
  seed_dispersal_mechanism: string | null;
  seed_storage_behaviour: string | null;
  seed_dormancy_type: string | null;
  seedbank_type: string | null;
  // Leaf
  leaf_type: string | null;
  leaf_compoundness: string | null;
  leaf_shape: string | null;
  sla_mm2_mg: number | null;
  ldmc_g_g: number | null;
  leaf_nitrogen_mg_g: number | null;
  leaf_carbon_mg_g: number | null;
  leaf_phosphorus_mg_g: number | null;
  leaf_dry_mass_mg: number | null;
  // Reproduction
  pollination_syndrome: string | null;
  sexual_system: string | null;
  mating_system: string | null;
  self_fertile: boolean | null;
  reproductive_type: string | null;
  clonal_growth_form: string | null;
  storage_organ: string | null;
  uses: SpeciesUse[];
  // Risk
  toxicity: string | null;
  known_hazards: string | null;
  invasive_potential: string | null;
  noxious_status: boolean | null;
  invasive_usda: boolean | null;
  weed_potential: boolean | null;
  fire_resistant: boolean | null;
  fire_tolerance: string | null;
  hedge_tolerance: string | null;
  pests_diseases: string | null;
  // Notes
  summary: string | null;
  cultivation_notes: string | null;
  propagation_notes: string | null;
  native_range: string | null;
  // Distribution
  native_distribution: string | null;
  introduced_distribution: string | null;
  range_text: string | null;
  conservation_status: string | null;
  // Text
  carbon_farming: string | null;
  physical_characteristics: string | null;
  habitats: string | null;
  // Ellenberg
  ellenberg_light: number | null;
  ellenberg_temperature: number | null;
  ellenberg_moisture: number | null;
  ellenberg_reaction: number | null;
  ellenberg_nitrogen: number | null;
  ellenberg_salt: number | null;
  // Media
  image_urls: string | null;
  // Classification
  classification_source: string | null;
  model_version: string | null;
  prompt_version: string | null;
  reasoning: string | null;
  classified_at: string | null;
  validation_flags: string | null;
  overall_confidence: number | null;
  validation_flag_count: number | null;
  wood_density_g_cm3: number | null;
  photosynthesis_pathway: string | null;
  // Relations & meta
  relationships: Relationship[];
  data_quality_tier: string | null;
}

export interface SpeciesFilter {
  hardiness_min: number | null;
  hardiness_max: number | null;
  height_max: number | null;
  sun_tolerances: string[] | null;
  soil_tolerances: string[] | null;
  growth_rate: string[] | null;
  life_cycle: string[] | null;
  edible: boolean | null;
  nitrogen_fixer: boolean | null;
  stratum: string[] | null;
  family: string | null;
}

export type Sort = 'Name' | 'Family' | 'Height' | 'Hardiness' | 'GrowthRate' | 'Relevance';

export interface PaginatedResult<T> {
  items: T[];
  next_cursor: string | null;
  total_estimate: number;
}

export interface FilterOptions {
  families: string[];
  growth_rates: string[];
  strata: string[];
  hardiness_range: [number, number];
  life_cycles: string[];
  sun_tolerances: string[];
  soil_tolerances: string[];
}
