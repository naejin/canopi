import {
  PLANT_FILTER_FIELDS,
  type PlantFilterFieldDef,
  type PlantFilterUiPlacement,
} from '../../generated/plant-filter-fields'
import type { FilterOptions, SpeciesFilter } from '../../types/species'

export type SpeciesFilterKey = Exclude<keyof SpeciesFilter, 'extra'>

type SpeciesFilterValue = SpeciesFilter[SpeciesFilterKey]
type FilterActivityKind = 'array' | 'boolean' | 'numeric' | 'string'

type FilterOptionsKey = keyof Pick<
  FilterOptions,
  'climate_zones' | 'habits' | 'life_cycles' | 'sun_tolerances'
>

interface FilterActivityStrategy {
  readonly key: SpeciesFilterKey
  readonly kind: FilterActivityKind
  readonly countable: boolean
  readonly source: 'schema' | 'adapter'
}

interface StripChoiceBehavior {
  readonly labelI18nKey: string
  readonly fallbackLabel: string
  readonly optionsKey: FilterOptionsKey
  readonly valueI18nPrefix: string
  readonly color: string
}

interface ActiveArrayChipBehavior {
  readonly keyPrefix: string
  readonly valueI18nPrefix: string
  readonly color: string
}

interface AdapterFilterBehavior {
  readonly key: SpeciesFilterKey
  readonly kind: FilterActivityKind
  readonly countable: boolean
  readonly stripChoice?: StripChoiceBehavior
  readonly activeArrayChip?: ActiveArrayChipBehavior
}

export interface StripOptionSource {
  readonly filterOptionsKey: FilterOptionsKey
  readonly valueI18nPrefix: string
}

export interface StripChoiceField {
  readonly field?: PlantFilterFieldDef
  readonly filterKey: SpeciesFilterKey
  readonly labelI18nKey: string
  readonly fallbackLabel: string
  readonly optionsKey: FilterOptionsKey
  readonly valueI18nPrefix: string
  readonly color: string
  readonly source: 'schema' | 'adapter'
}

export interface ActiveArrayChipField {
  readonly filterKey: SpeciesFilterKey
  readonly keyPrefix: string
  readonly valueI18nPrefix: string
  readonly color: string
  readonly source: 'schema' | 'adapter'
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

const SCHEMA_STRIP_OPTION_SOURCES: Partial<Record<SpeciesFilterKey, StripOptionSource>> = {
  climate_zones: {
    filterOptionsKey: 'climate_zones',
    valueI18nPrefix: 'filters.climateZone_',
  },
  habit: {
    filterOptionsKey: 'habits',
    valueI18nPrefix: 'filters.habit_',
  },
}

const SCHEMA_ACTIVE_ARRAY_CHIPS: Partial<Record<SpeciesFilterKey, ActiveArrayChipBehavior>> = {
  climate_zones: {
    keyPrefix: 'cz',
    valueI18nPrefix: 'filters.climateZone_',
    color: '--color-sun',
  },
  habit: {
    keyPrefix: 'hab',
    valueI18nPrefix: 'filters.habit_',
    color: '--color-family',
  },
}

const ADAPTER_FILTER_BEHAVIORS: readonly AdapterFilterBehavior[] = [
  {
    key: 'sun_tolerances',
    kind: 'array',
    countable: true,
    stripChoice: {
      labelI18nKey: 'filters.sun',
      fallbackLabel: 'Sun',
      optionsKey: 'sun_tolerances',
      valueI18nPrefix: 'plantDb.sunTolerance_',
      color: '--color-sun',
    },
    activeArrayChip: {
      keyPrefix: 'sun',
      valueI18nPrefix: 'plantDb.sunTolerance_',
      color: '--color-sun',
    },
  },
  {
    key: 'soil_tolerances',
    kind: 'array',
    countable: true,
  },
  {
    key: 'life_cycle',
    kind: 'array',
    countable: true,
    stripChoice: {
      labelI18nKey: 'filters.lifecycle',
      fallbackLabel: 'Life cycle',
      optionsKey: 'life_cycles',
      valueI18nPrefix: 'filters.lifeCycle_',
      color: '--color-family',
    },
    activeArrayChip: {
      keyPrefix: 'lc',
      valueI18nPrefix: 'filters.lifeCycle_',
      color: '--color-family',
    },
  },
  {
    key: 'growth_rate',
    kind: 'array',
    countable: true,
    activeArrayChip: {
      keyPrefix: 'gr',
      valueI18nPrefix: 'filters.growthRate_',
      color: '--color-family',
    },
  },
  { key: 'edible', kind: 'boolean', countable: false },
  { key: 'edibility_min', kind: 'numeric', countable: true },
  { key: 'nitrogen_fixer', kind: 'boolean', countable: true },
  { key: 'family', kind: 'string', countable: false },
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

function schemaStripFields(): readonly PlantFilterFieldDef[] {
  return PLANT_FILTER_FIELDS.filter((field) => field.uiPlacement === 'strip')
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

const ADAPTER_FILTER_STRATEGIES: readonly FilterActivityStrategy[] = ADAPTER_FILTER_BEHAVIORS
  .map((behavior) => ({
    key: behavior.key,
    kind: behavior.kind,
    countable: behavior.countable,
    source: 'adapter' as const,
  }))

export const FILTER_ACTIVITY_STRATEGIES: readonly FilterActivityStrategy[] = [
  ...SCHEMA_STRIP_FILTER_STRATEGIES,
  ...ADAPTER_FILTER_STRATEGIES,
]

export function isActiveValue(kind: FilterActivityKind, value: SpeciesFilterValue): boolean {
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

export function fields(options: { placement?: PlantFilterUiPlacement } = {}): readonly PlantFilterFieldDef[] {
  const { placement } = options
  return placement
    ? PLANT_FILTER_FIELDS.filter((field) => field.uiPlacement === placement)
    : PLANT_FILTER_FIELDS
}

export function stripFields(): readonly PlantFilterFieldDef[] {
  return schemaStripFields()
}

export function stripChoiceFields(): readonly StripChoiceField[] {
  const schemaFields = schemaStripFields().flatMap((field): StripChoiceField[] => {
    if (!isSpeciesFilterKey(field.key) || field.kind !== 'categorical') return []
    const source = SCHEMA_STRIP_OPTION_SOURCES[field.key]
    if (source === undefined) return []
    return [{
      field,
      filterKey: field.key,
      labelI18nKey: field.i18nKey,
      fallbackLabel: field.key,
      optionsKey: source.filterOptionsKey,
      valueI18nPrefix: source.valueI18nPrefix,
      color: field.colorToken,
      source: 'schema',
    }]
  })

  const adapterFields = ADAPTER_FILTER_BEHAVIORS.flatMap((behavior): StripChoiceField[] => {
    if (!behavior.stripChoice) return []
    return [{
      filterKey: behavior.key,
      labelI18nKey: behavior.stripChoice.labelI18nKey,
      fallbackLabel: behavior.stripChoice.fallbackLabel,
      optionsKey: behavior.stripChoice.optionsKey,
      valueI18nPrefix: behavior.stripChoice.valueI18nPrefix,
      color: behavior.stripChoice.color,
      source: 'adapter',
    }]
  })

  return [...schemaFields, ...adapterFields]
}

export function stripOptionSource(fieldKey: string): StripOptionSource | undefined {
  if (!isSpeciesFilterKey(fieldKey)) return undefined
  const schemaSource = SCHEMA_STRIP_OPTION_SOURCES[fieldKey]
  if (schemaSource) return schemaSource

  const adapter = ADAPTER_FILTER_BEHAVIORS.find((behavior) => behavior.key === fieldKey)
  return adapter?.stripChoice
    ? {
        filterOptionsKey: adapter.stripChoice.optionsKey,
        valueI18nPrefix: adapter.stripChoice.valueI18nPrefix,
      }
    : undefined
}

export function hasSpeciesFilterStrategy(fieldKey: string): boolean {
  return FILTER_ACTIVITY_STRATEGIES.some((strategy) => strategy.key === fieldKey)
}

export function activeArrayChipFields(): readonly ActiveArrayChipField[] {
  const schemaFields = schemaStripFields().flatMap((field): ActiveArrayChipField[] => {
    if (!isSpeciesFilterKey(field.key) || field.kind !== 'categorical') return []
    const behavior = SCHEMA_ACTIVE_ARRAY_CHIPS[field.key]
    if (!behavior) return []
    return [{
      filterKey: field.key,
      keyPrefix: behavior.keyPrefix,
      valueI18nPrefix: behavior.valueI18nPrefix,
      color: behavior.color,
      source: 'schema',
    }]
  })

  const adapterFields = ADAPTER_FILTER_BEHAVIORS.flatMap((behavior): ActiveArrayChipField[] => {
    if (!behavior.activeArrayChip) return []
    return [{
      filterKey: behavior.key,
      keyPrefix: behavior.activeArrayChip.keyPrefix,
      valueI18nPrefix: behavior.activeArrayChip.valueI18nPrefix,
      color: behavior.activeArrayChip.color,
      source: 'adapter',
    }]
  })

  return [...schemaFields, ...adapterFields]
}
