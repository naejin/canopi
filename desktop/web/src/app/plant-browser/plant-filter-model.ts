import type {
  DynamicFilter,
  SpeciesFilter,
} from '../../types/species'
import * as speciesCatalogFilters from './species-catalog-filters'

export const plantFilterCatalog = {
  fields: speciesCatalogFilters.fields,

  stripFields: speciesCatalogFilters.stripFields,

  stripChoiceFields: speciesCatalogFilters.stripChoiceFields,

  stripThresholdFields: speciesCatalogFilters.stripThresholdFields,

  stripBooleanFields: speciesCatalogFilters.stripBooleanFields,

  stripControls: speciesCatalogFilters.stripControls,

  stripOptionSource: speciesCatalogFilters.stripOptionSource,

  hasSpeciesFilterStrategy: speciesCatalogFilters.hasSpeciesFilterStrategy,

  activeArrayChipFields: speciesCatalogFilters.activeArrayChipFields,

  activeBooleanChipFields: speciesCatalogFilters.activeBooleanChipFields,

  activeNumericChipFields: speciesCatalogFilters.activeNumericChipFields,

  activeChipFields: speciesCatalogFilters.activeChipFields,
}

export type {
  ActiveChipField,
  ActiveArrayChipField,
  ActiveBooleanChipField,
  ActiveNumericChipField,
  SpeciesFilterKey,
  StripBooleanField,
  StripChoiceField,
  StripControlField,
  StripOptionSource,
  StripThresholdField,
} from './species-catalog-filters'

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
      speciesCatalogFilters.FILTER_ACTIVITY_STRATEGIES.some((strategy) => (
        speciesCatalogFilters.isActiveValue(strategy.kind, filters[strategy.key])
      )) ||
      (filters.extra !== null && filters.extra.length > 0) ||
      extraFilters.length > 0
    )
  },

  activeCount(filters: SpeciesFilter, extraFilters: readonly DynamicFilter[] = []): number {
    const fixedCount = speciesCatalogFilters.FILTER_ACTIVITY_STRATEGIES.filter((strategy) => (
      strategy.countable && speciesCatalogFilters.isActiveValue(strategy.kind, filters[strategy.key])
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
