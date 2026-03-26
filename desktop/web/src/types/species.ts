export interface SpeciesListItem {
  canonical_name: string;
  slug: string;
  common_name: string | null;
  family: string;
  genus: string;
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

export interface SpeciesDetail {
  canonical_name: string;
  common_name: string | null;
  family: string;
  genus: string;
  // Dimensions
  height_min_m: number | null;
  height_max_m: number | null;
  width_max_m: number | null;
  hardiness_zone_min: number | null;
  hardiness_zone_max: number | null;
  growth_rate: string | null;
  // Life cycle & form
  is_annual: boolean | null;
  is_biennial: boolean | null;
  is_perennial: boolean | null;
  lifespan: string | null;
  deciduous_evergreen: string | null;
  habit: string | null;
  active_growth_period: string | null;
  bloom_period: string | null;
  flower_color: string | null;
  // Light & climate
  tolerates_full_sun: boolean | null;
  tolerates_semi_shade: boolean | null;
  tolerates_full_shade: boolean | null;
  frost_tender: boolean | null;
  drought_tolerance: string | null;
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
  // Ecology
  stratum: string | null;
  succession_stage: string | null;
  nitrogen_fixer: boolean | null;
  attracts_wildlife: boolean | null;
  scented: boolean | null;
  stratum_confidence: number | null;
  succession_confidence: number | null;
  // Uses & ratings
  edibility_rating: number | null;
  medicinal_rating: number | null;
  other_uses_rating: number | null;
  edible_uses: string | null;
  medicinal_uses: string | null;
  other_uses: string | null;
  uses: SpeciesUse[];
  // Risk
  toxicity: string | null;
  known_hazards: string | null;
  // Notes
  summary: string | null;
  cultivation_notes: string | null;
  propagation_notes: string | null;
  native_range: string | null;
  carbon_farming: string | null;
  // Relations & meta
  soil_types: string[];
  relationships: Relationship[];
  data_quality_tier: string | null;
}

export interface SpeciesFilter {
  hardiness_min: number | null;
  hardiness_max: number | null;
  height_max: number | null;
  sun_tolerances: string[] | null;
  soil_types: string[] | null;
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
  soil_types: string[];
}
