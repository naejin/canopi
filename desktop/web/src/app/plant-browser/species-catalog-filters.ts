import {
  PLANT_FILTER_FIELDS,
  SPECIES_FILTER_FIXED_BEHAVIORS,
  type PlantFilterFieldDef,
  type PlantFilterUiPlacement,
  type SpeciesFilterFixedBehavior,
} from '../../generated/plant-filter-fields'
import type { FilterOptions, SpeciesFilter } from '../../types/species'

export type SpeciesFilterKey = Exclude<keyof SpeciesFilter, 'extra'>

type SpeciesFilterValue = SpeciesFilter[SpeciesFilterKey]
type FilterActivityKind = 'array' | 'boolean' | 'numeric' | 'string'

type FilterOptionsKey = keyof Pick<
  FilterOptions,
  'climate_zones' | 'habits' | 'life_cycles' | 'sun_tolerances'
>

const FIXED_FILTER_BEHAVIORS: readonly SpeciesFilterFixedBehavior[] = SPECIES_FILTER_FIXED_BEHAVIORS
const FIXED_FILTER_KEYS = FIXED_FILTER_BEHAVIORS.map((behavior) => behavior.key as SpeciesFilterKey)

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

interface StripThresholdBehavior {
  readonly labelI18nKey: string
  readonly fallbackLabel: string
  readonly min: number
  readonly max: number
  readonly color: string
}

interface StripBooleanBehavior {
  readonly labelI18nKey: string
  readonly fallbackLabel: string
  readonly color: string
}

interface ActiveBooleanChipBehavior {
  readonly labelI18nKey: string
  readonly color: string
}

interface ActiveNumericChipBehavior {
  readonly labelI18nKey: string
  readonly color: string
  readonly suffix: string
}

interface AdapterFilterBehavior {
  readonly key: SpeciesFilterKey
  readonly kind: FilterActivityKind
  readonly countable: boolean
  readonly stripChoice?: StripChoiceBehavior
  readonly stripThreshold?: StripThresholdBehavior
  readonly stripBoolean?: StripBooleanBehavior
  readonly activeArrayChip?: ActiveArrayChipBehavior
  readonly activeBooleanChip?: ActiveBooleanChipBehavior
  readonly activeNumericChip?: ActiveNumericChipBehavior
}

export interface StripOptionSource {
  readonly filterOptionsKey: FilterOptionsKey
  readonly valueI18nPrefix: string
}

export interface StripChoiceField {
  readonly kind: 'choice'
  readonly field?: PlantFilterFieldDef
  readonly filterKey: SpeciesFilterKey
  readonly labelI18nKey: string
  readonly fallbackLabel: string
  readonly optionsKey: FilterOptionsKey
  readonly valueI18nPrefix: string
  readonly color: string
  readonly source: 'schema' | 'adapter'
}

export interface StripBooleanField {
  readonly kind: 'boolean'
  readonly field?: PlantFilterFieldDef
  readonly filterKey: SpeciesFilterKey
  readonly labelI18nKey: string
  readonly fallbackLabel: string
  readonly color: string
  readonly activeValue: boolean
  readonly source: 'schema' | 'adapter'
}

export interface StripThresholdField {
  readonly kind: 'threshold'
  readonly filterKey: SpeciesFilterKey
  readonly labelI18nKey: string
  readonly fallbackLabel: string
  readonly color: string
  readonly min: number
  readonly max: number
  readonly source: 'adapter'
}

export type StripControlField = StripChoiceField | StripBooleanField | StripThresholdField

export interface ActiveArrayChipField {
  readonly kind: 'array'
  readonly filterKey: SpeciesFilterKey
  readonly keyPrefix: string
  readonly valueI18nPrefix: string
  readonly color: string
  readonly source: 'schema' | 'adapter'
}

export interface ActiveBooleanChipField {
  readonly kind: 'boolean'
  readonly filterKey: SpeciesFilterKey
  readonly labelI18nKey: string
  readonly fallbackLabel: string
  readonly color: string
  readonly source: 'schema' | 'adapter'
}

export interface ActiveNumericChipField {
  readonly kind: 'numeric-threshold'
  readonly filterKey: SpeciesFilterKey
  readonly labelI18nKey: string
  readonly fallbackLabel: string
  readonly color: string
  readonly suffix: string
  readonly source: 'adapter'
}

export type ActiveChipField = ActiveArrayChipField | ActiveBooleanChipField | ActiveNumericChipField

const SPECIES_FILTER_KEYS = new Set<string>([
  ...FIXED_FILTER_BEHAVIORS.map((behavior) => behavior.key),
  ...PLANT_FILTER_FIELDS
    .filter((field) => field.uiPlacement === 'strip')
    .map((field) => field.key),
])

const SCHEMA_STRIP_FILTER_KEYS = new Set<string>(
  PLANT_FILTER_FIELDS
    .filter((field) => field.uiPlacement === 'strip')
    .map((field) => field.key),
)

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

const ADAPTER_FILTER_BEHAVIORS: readonly AdapterFilterBehavior[] = FIXED_FILTER_BEHAVIORS
  .filter((behavior) => !SCHEMA_STRIP_FILTER_KEYS.has(behavior.key))
  .map((behavior) => ({
    key: behavior.key as SpeciesFilterKey,
    kind: behavior.kind,
    countable: behavior.countable,
    stripChoice: behavior.stripChoice
      ? {
          labelI18nKey: behavior.stripChoice.labelI18nKey,
          fallbackLabel: behavior.stripChoice.fallbackLabel,
          optionsKey: behavior.stripChoice.optionsKey as FilterOptionsKey,
          valueI18nPrefix: behavior.stripChoice.valueI18nPrefix,
          color: behavior.stripChoice.colorToken,
        }
      : undefined,
    stripThreshold: behavior.stripThreshold
      ? {
          labelI18nKey: behavior.stripThreshold.labelI18nKey,
          fallbackLabel: behavior.stripThreshold.fallbackLabel,
          min: behavior.stripThreshold.min,
          max: behavior.stripThreshold.max,
          color: behavior.stripThreshold.colorToken,
        }
      : undefined,
    stripBoolean: behavior.stripBoolean
      ? {
          labelI18nKey: behavior.stripBoolean.labelI18nKey,
          fallbackLabel: behavior.stripBoolean.fallbackLabel,
          color: behavior.stripBoolean.colorToken,
        }
      : undefined,
    activeArrayChip: behavior.activeArrayChip
      ? {
          keyPrefix: behavior.activeArrayChip.keyPrefix,
          valueI18nPrefix: behavior.activeArrayChip.valueI18nPrefix,
          color: behavior.activeArrayChip.colorToken,
        }
      : undefined,
    activeBooleanChip: behavior.activeBooleanChip
      ? {
          labelI18nKey: behavior.activeBooleanChip.labelI18nKey,
          color: behavior.activeBooleanChip.colorToken,
        }
      : undefined,
    activeNumericChip: behavior.activeNumericChip
      ? {
          labelI18nKey: behavior.activeNumericChip.labelI18nKey,
          color: behavior.activeNumericChip.colorToken,
          suffix: behavior.activeNumericChip.suffix,
        }
      : undefined,
  }))

function isSpeciesFilterKey(key: string): key is SpeciesFilterKey {
  return SPECIES_FILTER_KEYS.has(key)
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

export function fixedFilterKeys(): readonly SpeciesFilterKey[] {
  return FIXED_FILTER_KEYS
}

export function createEmptyFixedFilterState(): Pick<SpeciesFilter, SpeciesFilterKey> {
  return Object.fromEntries(
    FIXED_FILTER_KEYS.map((key) => [key, null]),
  ) as Pick<SpeciesFilter, SpeciesFilterKey>
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
      kind: 'choice',
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
      kind: 'choice',
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

export function stripThresholdFields(): readonly StripThresholdField[] {
  return ADAPTER_FILTER_BEHAVIORS.flatMap((behavior): StripThresholdField[] => {
    if (!behavior.stripThreshold) return []
    return [{
      kind: 'threshold',
      filterKey: behavior.key,
      labelI18nKey: behavior.stripThreshold.labelI18nKey,
      fallbackLabel: behavior.stripThreshold.fallbackLabel,
      min: behavior.stripThreshold.min,
      max: behavior.stripThreshold.max,
      color: behavior.stripThreshold.color,
      source: 'adapter',
    }]
  })
}

export function stripBooleanFields(): readonly StripBooleanField[] {
  const schemaFields = schemaStripFields().flatMap((field): StripBooleanField[] => {
    if (!isSpeciesFilterKey(field.key) || field.kind !== 'boolean') return []
    return [{
      kind: 'boolean',
      field,
      filterKey: field.key,
      labelI18nKey: field.i18nKey,
      fallbackLabel: field.key,
      color: field.colorToken,
      activeValue: true,
      source: 'schema',
    }]
  })

  const adapterFields = ADAPTER_FILTER_BEHAVIORS.flatMap((behavior): StripBooleanField[] => {
    if (!behavior.stripBoolean) return []
    return [{
      kind: 'boolean',
      filterKey: behavior.key,
      labelI18nKey: behavior.stripBoolean.labelI18nKey,
      fallbackLabel: behavior.stripBoolean.fallbackLabel,
      color: behavior.stripBoolean.color,
      activeValue: true,
      source: 'adapter',
    }]
  })

  return [...schemaFields, ...adapterFields]
}

export function stripControls(): readonly StripControlField[] {
  return [
    ...stripChoiceFields(),
    ...stripThresholdFields(),
    ...stripBooleanFields(),
  ]
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
      kind: 'array',
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
      kind: 'array',
      filterKey: behavior.key,
      keyPrefix: behavior.activeArrayChip.keyPrefix,
      valueI18nPrefix: behavior.activeArrayChip.valueI18nPrefix,
      color: behavior.activeArrayChip.color,
      source: 'adapter',
    }]
  })

  return [...schemaFields, ...adapterFields]
}

export function activeBooleanChipFields(): readonly ActiveBooleanChipField[] {
  const schemaFields = schemaStripFields().flatMap((field): ActiveBooleanChipField[] => {
    if (!isSpeciesFilterKey(field.key) || field.kind !== 'boolean') return []
    return [{
      kind: 'boolean',
      filterKey: field.key,
      labelI18nKey: field.i18nKey,
      fallbackLabel: field.key,
      color: field.colorToken,
      source: 'schema',
    }]
  })

  const adapterFields = ADAPTER_FILTER_BEHAVIORS.flatMap((behavior): ActiveBooleanChipField[] => {
    if (!behavior.activeBooleanChip) return []
    return [{
      kind: 'boolean',
      filterKey: behavior.key,
      labelI18nKey: behavior.activeBooleanChip.labelI18nKey,
      fallbackLabel: behavior.stripBoolean?.fallbackLabel ?? behavior.key,
      color: behavior.activeBooleanChip.color,
      source: 'adapter',
    }]
  })

  return [...schemaFields, ...adapterFields]
}

export function activeNumericChipFields(): readonly ActiveNumericChipField[] {
  return ADAPTER_FILTER_BEHAVIORS.flatMap((behavior): ActiveNumericChipField[] => {
    if (!behavior.activeNumericChip) return []
    return [{
      kind: 'numeric-threshold',
      filterKey: behavior.key,
      labelI18nKey: behavior.activeNumericChip.labelI18nKey,
      fallbackLabel: behavior.stripThreshold?.fallbackLabel ?? behavior.key,
      color: behavior.activeNumericChip.color,
      suffix: behavior.activeNumericChip.suffix,
      source: 'adapter',
    }]
  })
}

export function activeChipFields(): readonly ActiveChipField[] {
  return [
    ...activeArrayChipFields(),
    ...activeBooleanChipFields(),
    ...activeNumericChipFields(),
  ]
}
