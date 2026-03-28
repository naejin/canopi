export type FilterCategory =
  | 'growth'
  | 'climate'
  | 'ecology'
  | 'reproduce'
  | 'fruit'
  | 'leaf'
  | 'risk'
  | 'uses';

export interface FieldDef {
  key: string;
  type: 'boolean' | 'categorical' | 'numeric';
  category: FilterCategory;
  i18nKey: string;
  color: string;
}

export const CATEGORIES: { key: FilterCategory; i18nKey: string; color: string }[] = [
  { key: 'growth', i18nKey: 'filters.category.growth', color: '--color-family' },
  { key: 'climate', i18nKey: 'filters.category.climate', color: '--color-sun' },
  { key: 'ecology', i18nKey: 'filters.category.ecology', color: '--color-nitrogen' },
  { key: 'reproduce', i18nKey: 'filters.category.reproduce', color: '--color-medicinal' },
  { key: 'fruit', i18nKey: 'filters.category.fruit', color: '--color-edible' },
  { key: 'leaf', i18nKey: 'filters.category.leaf', color: '--color-height' },
  { key: 'risk', i18nKey: 'filters.category.risk', color: '--color-danger' },
  { key: 'uses', i18nKey: 'filters.category.uses', color: '--color-primary' },
];

export const FIELD_REGISTRY: FieldDef[] = [
  // Growth & Form
  { key: 'woody', type: 'boolean', category: 'growth', i18nKey: 'filters.field.woody', color: '--color-family' },
  { key: 'habit', type: 'categorical', category: 'growth', i18nKey: 'filters.field.habit', color: '--color-family' },
  { key: 'growth_form_type', type: 'categorical', category: 'growth', i18nKey: 'filters.field.growthFormType', color: '--color-family' },
  { key: 'growth_habit', type: 'categorical', category: 'growth', i18nKey: 'filters.field.growthHabit', color: '--color-family' },
  { key: 'canopy_position', type: 'categorical', category: 'growth', i18nKey: 'filters.field.canopyPosition', color: '--color-family' },
  { key: 'deciduous_evergreen', type: 'categorical', category: 'growth', i18nKey: 'filters.field.deciduousEvergreen', color: '--color-family' },
  { key: 'resprout_ability', type: 'boolean', category: 'growth', i18nKey: 'filters.field.resproutAbility', color: '--color-family' },
  { key: 'coppice_potential', type: 'boolean', category: 'growth', i18nKey: 'filters.field.coppicePotential', color: '--color-family' },
  { key: 'active_growth_period', type: 'categorical', category: 'growth', i18nKey: 'filters.field.activeGrowthPeriod', color: '--color-family' },

  // Climate & Soil
  { key: 'frost_tender', type: 'boolean', category: 'climate', i18nKey: 'filters.field.frostTender', color: '--color-sun' },
  { key: 'drought_tolerance', type: 'categorical', category: 'climate', i18nKey: 'filters.field.droughtTolerance', color: '--color-sun' },
  { key: 'soil_ph_min', type: 'numeric', category: 'climate', i18nKey: 'filters.field.soilPhMin', color: '--color-sun' },
  { key: 'soil_ph_max', type: 'numeric', category: 'climate', i18nKey: 'filters.field.soilPhMax', color: '--color-sun' },
  { key: 'tolerates_acid', type: 'boolean', category: 'climate', i18nKey: 'filters.field.toleratesAcid', color: '--color-sun' },
  { key: 'tolerates_alkaline', type: 'boolean', category: 'climate', i18nKey: 'filters.field.toleratesAlkaline', color: '--color-sun' },
  { key: 'tolerates_saline', type: 'boolean', category: 'climate', i18nKey: 'filters.field.toleratesSaline', color: '--color-sun' },
  { key: 'tolerates_wind', type: 'boolean', category: 'climate', i18nKey: 'filters.field.toleratesWind', color: '--color-sun' },
  { key: 'tolerates_pollution', type: 'boolean', category: 'climate', i18nKey: 'filters.field.toleratesPollution', color: '--color-sun' },
  { key: 'fertility_requirement', type: 'categorical', category: 'climate', i18nKey: 'filters.field.fertilityRequirement', color: '--color-sun' },
  { key: 'moisture_use', type: 'categorical', category: 'climate', i18nKey: 'filters.field.moistureUse', color: '--color-sun' },
  { key: 'anaerobic_tolerance', type: 'categorical', category: 'climate', i18nKey: 'filters.field.anaerobicTolerance', color: '--color-sun' },

  // Ecology
  { key: 'succession_stage', type: 'categorical', category: 'ecology', i18nKey: 'filters.field.successionStage', color: '--color-nitrogen' },
  { key: 'ecological_system', type: 'categorical', category: 'ecology', i18nKey: 'filters.field.ecologicalSystem', color: '--color-nitrogen' },
  { key: 'mycorrhizal_type', type: 'categorical', category: 'ecology', i18nKey: 'filters.field.mycorrhizalType', color: '--color-nitrogen' },
  { key: 'grime_strategy', type: 'categorical', category: 'ecology', i18nKey: 'filters.field.grimeStrategy', color: '--color-nitrogen' },
  { key: 'allelopathic', type: 'boolean', category: 'ecology', i18nKey: 'filters.field.allelopathic', color: '--color-nitrogen' },
  { key: 'root_system_type', type: 'categorical', category: 'ecology', i18nKey: 'filters.field.rootSystemType', color: '--color-nitrogen' },
  { key: 'attracts_wildlife', type: 'boolean', category: 'ecology', i18nKey: 'filters.field.attractsWildlife', color: '--color-nitrogen' },
  { key: 'cn_ratio', type: 'categorical', category: 'ecology', i18nKey: 'filters.field.cnRatio', color: '--color-nitrogen' },

  // Reproduction
  { key: 'pollination_syndrome', type: 'categorical', category: 'reproduce', i18nKey: 'filters.field.pollinationSyndrome', color: '--color-medicinal' },
  { key: 'self_fertile', type: 'boolean', category: 'reproduce', i18nKey: 'filters.field.selfFertile', color: '--color-medicinal' },
  { key: 'reproductive_type', type: 'categorical', category: 'reproduce', i18nKey: 'filters.field.reproductiveType', color: '--color-medicinal' },
  { key: 'sexual_system', type: 'categorical', category: 'reproduce', i18nKey: 'filters.field.sexualSystem', color: '--color-medicinal' },
  { key: 'vegetative_spread_rate', type: 'categorical', category: 'reproduce', i18nKey: 'filters.field.vegetativeSpreadRate', color: '--color-medicinal' },
  { key: 'seed_spread_rate', type: 'categorical', category: 'reproduce', i18nKey: 'filters.field.seedSpreadRate', color: '--color-medicinal' },

  // Fruit & Seed
  { key: 'fruit_type', type: 'categorical', category: 'fruit', i18nKey: 'filters.field.fruitType', color: '--color-edible' },
  { key: 'seed_dispersal_mechanism', type: 'categorical', category: 'fruit', i18nKey: 'filters.field.seedDispersalMechanism', color: '--color-edible' },
  { key: 'seed_storage_behaviour', type: 'categorical', category: 'fruit', i18nKey: 'filters.field.seedStorageBehaviour', color: '--color-edible' },
  { key: 'fruit_seed_abundance', type: 'categorical', category: 'fruit', i18nKey: 'filters.field.fruitSeedAbundance', color: '--color-edible' },
  { key: 'seed_dormancy_type', type: 'categorical', category: 'fruit', i18nKey: 'filters.field.seedDormancyType', color: '--color-edible' },

  // Leaf
  { key: 'leaf_type', type: 'categorical', category: 'leaf', i18nKey: 'filters.field.leafType', color: '--color-height' },
  { key: 'leaf_compoundness', type: 'categorical', category: 'leaf', i18nKey: 'filters.field.leafCompoundness', color: '--color-height' },
  { key: 'leaf_shape', type: 'categorical', category: 'leaf', i18nKey: 'filters.field.leafShape', color: '--color-height' },

  // Bloom
  { key: 'bloom_period', type: 'categorical', category: 'reproduce', i18nKey: 'filters.field.bloomPeriod', color: '--color-medicinal' },
  { key: 'flower_color', type: 'categorical', category: 'reproduce', i18nKey: 'filters.field.flowerColor', color: '--color-medicinal' },

  // Risk
  { key: 'toxicity', type: 'categorical', category: 'risk', i18nKey: 'filters.field.toxicity', color: '--color-danger' },
  { key: 'invasive_potential', type: 'categorical', category: 'risk', i18nKey: 'filters.field.invasivePotential', color: '--color-danger' },
  { key: 'noxious_status', type: 'boolean', category: 'risk', i18nKey: 'filters.field.noxiousStatus', color: '--color-danger' },
  { key: 'weed_potential', type: 'boolean', category: 'risk', i18nKey: 'filters.field.weedPotential', color: '--color-danger' },
  { key: 'fire_resistant', type: 'boolean', category: 'risk', i18nKey: 'filters.field.fireResistant', color: '--color-danger' },

  // Uses
  { key: 'medicinal_rating', type: 'numeric', category: 'uses', i18nKey: 'filters.field.medicinalRating', color: '--color-primary' },
  { key: 'other_uses_rating', type: 'numeric', category: 'uses', i18nKey: 'filters.field.otherUsesRating', color: '--color-primary' },
  { key: 'scented', type: 'boolean', category: 'uses', i18nKey: 'filters.field.scented', color: '--color-primary' },
  { key: 'propagated_by_seed', type: 'boolean', category: 'reproduce', i18nKey: 'filters.field.propagatedBySeed', color: '--color-medicinal' },
  { key: 'propagated_by_cuttings', type: 'boolean', category: 'reproduce', i18nKey: 'filters.field.propagatedByCuttings', color: '--color-medicinal' },
  { key: 'cold_stratification_required', type: 'boolean', category: 'reproduce', i18nKey: 'filters.field.coldStratificationRequired', color: '--color-medicinal' },
];

// Pre-computed lookups — avoid linear scans on every render
const _fieldsByCategory = new Map<FilterCategory, FieldDef[]>(
  CATEGORIES.map(cat => [cat.key, FIELD_REGISTRY.filter(f => f.category === cat.key)])
);

const _categoryByField = new Map<string, typeof CATEGORIES[number]>(
  FIELD_REGISTRY.map(f => [f.key, CATEGORIES.find(c => c.key === f.category)!]).filter(([, c]) => c != null) as [string, typeof CATEGORIES[number]][]
);

export function fieldsForCategory(category: FilterCategory): FieldDef[] {
  return _fieldsByCategory.get(category) ?? [];
}

export function categoryForField(fieldKey: string): typeof CATEGORIES[number] | undefined {
  return _categoryByField.get(fieldKey);
}
