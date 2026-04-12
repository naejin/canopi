/**
 * Semantic ordering for dynamic filter option values.
 * Values not in the rank map append at end in original order.
 * Fields not in the map return original order unchanged.
 */

// Shared orderings reused across multiple fields
const NONE_LOW_MED_HIGH = ['None', 'Low', 'Medium', 'High']
const LOW_MED_HIGH = ['Low', 'Medium', 'High']
const SEASON_SIMPLE = ['Spring', 'Summer', 'Fall', 'Winter', 'Year Round']
const SPECTRAL = ['White', 'Yellow', 'Orange', 'Red', 'Pink', 'Purple', 'Violet', 'Blue', 'Green', 'Brown', 'Black']
const NONE_SLOW_MOD_RAPID = ['None', 'Slow', 'Moderate', 'Rapid']

const FIELD_ORDERING: Record<string, string[]> = {
  // Seasonal (chronological)
  bloom_period: [
    'Early Spring', 'Mid Spring', 'Late Spring', 'Spring',
    'Early Summer', 'Mid Summer', 'Late Summer', 'Summer',
    'Early Fall', 'Late Fall', 'Fall',
    'Late Winter', 'Winter',
    'Winter-Spring', 'Spring-Summer',
    'Year Round', 'Indeterminate',
  ],
  active_growth_period: [
    'Spring', 'Summer', 'Fall',
    'Spring and Summer', 'Spring and Fall', 'Summer and Fall',
    'Spring, Summer, Fall', 'Spring, Summer, and Fall',
    'Fall, Winter and Spring',
    'Year Round',
  ],
  fruit_seed_period_begin: SEASON_SIMPLE,
  fruit_seed_period_end: SEASON_SIMPLE,

  // Intensity (none/low to high)
  drought_tolerance: NONE_LOW_MED_HIGH,
  anaerobic_tolerance: NONE_LOW_MED_HIGH,
  fruit_seed_abundance: NONE_LOW_MED_HIGH,
  fertility_requirement: LOW_MED_HIGH,
  moisture_use: LOW_MED_HIGH,
  toxicity: ['None', 'Slight', 'Moderate', 'Severe'],
  seed_dormancy_depth: ['Short', 'Partial', 'Long', 'Absolute'],
  vegetative_spread_rate: NONE_SLOW_MOD_RAPID,
  seed_spread_rate: NONE_SLOW_MOD_RAPID,

  // Structural (large to small)
  growth_form_type: ['Tree', 'Shrub', 'Subshrub', 'Herb', 'Forb', 'Graminoid', 'Vine', 'Epiphyte', 'Fern'],
  stratum: ['emergent', 'high', 'medium', 'low'],
  deciduous_evergreen: ['Evergreen', 'Semi-Evergreen', 'Deciduous'],
  canopy_position: ['Canopy', 'Understory'],

  // Ecological
  succession_stage: ['Pioneer I', 'Pioneer II', 'Secondary I', 'Secondary II', 'Climax'],
  grime_strategy: ['C', 'S', 'R', 'CS', 'CR', 'SR', 'CSR'],

  // Spectral (warm to cool)
  flower_color: SPECTRAL,
  fruit_seed_color: SPECTRAL,
}

export function orderFilterValues<T extends { value: string }>(field: string, values: T[]): T[] {
  const order = FIELD_ORDERING[field]
  if (!order) return values

  const rankMap = new Map(order.map((v, i) => [v, i]))
  const ranked: T[] = []
  const unranked: T[] = []

  for (const item of values) {
    if (rankMap.has(item.value)) {
      ranked.push(item)
    } else {
      unranked.push(item)
    }
  }

  ranked.sort((a, b) => rankMap.get(a.value)! - rankMap.get(b.value)!)
  return [...ranked, ...unranked]
}
