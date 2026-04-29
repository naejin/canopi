import {
  PLANT_FILTER_FIELDS,
  type PlantFilterFieldDef,
  type PlantFilterUiPlacement,
} from '../../generated/plant-filter-fields'
import type {
  DynamicFilter,
  FilterOptions,
  SpeciesFilter,
} from '../../types/species'

export type SpeciesFilterKey = Exclude<keyof SpeciesFilter, 'extra'>

type SpeciesFilterValue = SpeciesFilter[SpeciesFilterKey]
type FilterActivityKind = 'array' | 'boolean' | 'numeric' | 'string'

interface FilterActivityStrategy {
  readonly key: SpeciesFilterKey
  readonly kind: FilterActivityKind
  readonly countable: boolean
  readonly source: 'schema' | 'fixed'
}

export interface StripOptionSource {
  readonly filterOptionsKey: keyof Pick<FilterOptions, 'climate_zones' | 'habits'>
  readonly valueI18nPrefix: string
}

export interface StripChoiceField {
  readonly field: PlantFilterFieldDef
  readonly filterKey: SpeciesFilterKey
  readonly optionsKey: StripOptionSource['filterOptionsKey']
  readonly valueI18nPrefix: string
}

const SPECIES_FILTER_KEYS = {
  sun_tolerances: true,
  soil_tolerances: true,
  growth_rate: true,
  life_cycle: true,
  edible: true,
  edibility_min: true,
  nitrogen_fixer: true,
  climate_zones: true,
  habit: true,
  woody: true,
  family: true,
} satisfies Record<SpeciesFilterKey, true>

const STRIP_OPTION_SOURCES: Partial<Record<SpeciesFilterKey, StripOptionSource>> = {
  climate_zones: {
    filterOptionsKey: 'climate_zones',
    valueI18nPrefix: 'filters.climateZone_',
  },
  habit: {
    filterOptionsKey: 'habits',
    valueI18nPrefix: 'filters.habit_',
  },
}

const FIXED_FILTER_STRATEGIES: readonly FilterActivityStrategy[] = [
  { key: 'sun_tolerances', kind: 'array', countable: true, source: 'fixed' },
  { key: 'soil_tolerances', kind: 'array', countable: true, source: 'fixed' },
  { key: 'growth_rate', kind: 'array', countable: true, source: 'fixed' },
  { key: 'life_cycle', kind: 'array', countable: true, source: 'fixed' },
  { key: 'edible', kind: 'boolean', countable: false, source: 'fixed' },
  { key: 'edibility_min', kind: 'numeric', countable: true, source: 'fixed' },
  { key: 'nitrogen_fixer', kind: 'boolean', countable: true, source: 'fixed' },
  { key: 'family', kind: 'string', countable: false, source: 'fixed' },
]

function isSpeciesFilterKey(key: string): key is SpeciesFilterKey {
  return key in SPECIES_FILTER_KEYS
}

function activityKindForSchemaField(field: PlantFilterFieldDef): FilterActivityKind {
  switch (field.kind) {
    case 'boolean':
      return 'boolean'
    case 'numeric':
      return 'numeric'
    case 'categorical':
      return 'array'
  }
}

const SCHEMA_STRIP_FILTER_STRATEGIES: readonly FilterActivityStrategy[] = PLANT_FILTER_FIELDS
  .flatMap((field): FilterActivityStrategy[] => {
    if (field.uiPlacement !== 'strip' || !isSpeciesFilterKey(field.key)) return []
    return [{
      key: field.key,
      kind: activityKindForSchemaField(field),
      countable: true,
      source: 'schema',
    }]
  })

const FILTER_ACTIVITY_STRATEGIES: readonly FilterActivityStrategy[] = [
  ...SCHEMA_STRIP_FILTER_STRATEGIES,
  ...FIXED_FILTER_STRATEGIES,
]

function isActiveValue(kind: FilterActivityKind, value: SpeciesFilterValue): boolean {
  switch (kind) {
    case 'array':
      return Array.isArray(value) && value.length > 0
    case 'boolean':
    case 'numeric':
      return value !== null
    case 'string':
      return typeof value === 'string' && value.length > 0
  }
}

function schemaStripFields(): readonly PlantFilterFieldDef[] {
  return PLANT_FILTER_FIELDS.filter((field) => field.uiPlacement === 'strip')
}

export const plantFilterCatalog = {
  fields(options: { placement?: PlantFilterUiPlacement } = {}): readonly PlantFilterFieldDef[] {
    const { placement } = options
    return placement
      ? PLANT_FILTER_FIELDS.filter((field) => field.uiPlacement === placement)
      : PLANT_FILTER_FIELDS
  },

  stripFields(): readonly PlantFilterFieldDef[] {
    return schemaStripFields()
  },

  stripChoiceFields(): readonly StripChoiceField[] {
    return schemaStripFields().flatMap((field) => {
      if (!isSpeciesFilterKey(field.key) || field.kind !== 'categorical') return []
      const source = STRIP_OPTION_SOURCES[field.key]
      if (source === undefined) return []
      return [{
        field,
        filterKey: field.key,
        optionsKey: source.filterOptionsKey,
        valueI18nPrefix: source.valueI18nPrefix,
      }]
    })
  },

  stripOptionSource(fieldKey: string): StripOptionSource | undefined {
    return isSpeciesFilterKey(fieldKey) ? STRIP_OPTION_SOURCES[fieldKey] : undefined
  },

  hasSpeciesFilterStrategy(fieldKey: string): boolean {
    return FILTER_ACTIVITY_STRATEGIES.some((strategy) => strategy.key === fieldKey)
  },
}

export const plantFilterModel = {
  createEmpty(): SpeciesFilter {
    return {
      sun_tolerances: null,
      soil_tolerances: null,
      growth_rate: null,
      life_cycle: null,
      edible: null,
      edibility_min: null,
      nitrogen_fixer: null,
      climate_zones: null,
      habit: null,
      woody: null,
      family: null,
      extra: null,
    }
  },

  hasActive(filters: SpeciesFilter, extraFilters: readonly DynamicFilter[] = []): boolean {
    return (
      FILTER_ACTIVITY_STRATEGIES.some((strategy) => (
        isActiveValue(strategy.kind, filters[strategy.key])
      )) ||
      (filters.extra !== null && filters.extra.length > 0) ||
      extraFilters.length > 0
    )
  },

  activeCount(filters: SpeciesFilter, extraFilters: readonly DynamicFilter[] = []): number {
    const fixedCount = FILTER_ACTIVITY_STRATEGIES.filter((strategy) => (
      strategy.countable && isActiveValue(strategy.kind, filters[strategy.key])
    )).length
    return fixedCount + extraFilters.length
  },

  toRequestFilters(
    filters: SpeciesFilter,
    extraFilters: readonly DynamicFilter[] = [],
  ): SpeciesFilter {
    if (extraFilters.length === 0) return filters
    const existing = filters.extra ?? []
    return { ...filters, extra: [...existing, ...extraFilters] }
  },
}

export function createEmptySpeciesFilter(): SpeciesFilter {
  return plantFilterModel.createEmpty()
}
