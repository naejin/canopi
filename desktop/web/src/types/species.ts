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
  height_min_m: number | null;
  height_max_m: number | null;
  width_max_m: number | null;
  hardiness_zone_min: number | null;
  hardiness_zone_max: number | null;
  soil_ph_min: number | null;
  soil_ph_max: number | null;
  growth_rate: string | null;
  edibility_rating: number | null;
  medicinal_rating: number | null;
  habit: string | null;
  deciduous_evergreen: string | null;
  stratum: string | null;
  nitrogen_fixer: boolean | null;
  is_annual: boolean | null;
  is_biennial: boolean | null;
  is_perennial: boolean | null;
  tolerates_full_sun: boolean | null;
  tolerates_semi_shade: boolean | null;
  tolerates_full_shade: boolean | null;
  uses: SpeciesUse[];
  soil_types: string[];
  relationships: Relationship[];
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
