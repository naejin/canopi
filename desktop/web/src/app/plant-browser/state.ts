import { computed, signal } from '@preact/signals'
import { getDynamicFilterOptions, searchSpecies } from '../../ipc/species'
import { locale } from '../settings/state'
import type {
  DynamicFilter,
  FilterOp,
  FilterOptions,
  SpeciesListItem,
} from '../../types/species'
import {
  createEmptySpeciesFilter,
  createPlantSearchSession,
  DYNAMIC_OPTIONS_BACKEND_MISMATCH_ERROR,
  isPlantSearchLoading,
} from './search-session'

export { createEmptySpeciesFilter, DYNAMIC_OPTIONS_BACKEND_MISMATCH_ERROR }

// ── Search state ──────────────────────────────────────────────────────────────

export const plantSearchSession = createPlantSearchSession({
  search: searchSpecies,
  loadDynamicFilterOptions: getDynamicFilterOptions,
  locale,
})

export const searchText = plantSearchSession.signals.text
export const activeFilters = plantSearchSession.signals.filters
export const sortField = plantSearchSession.signals.sort
export const searchResults = plantSearchSession.signals.items
export const searchResultsRevision = plantSearchSession.signals.committedRevision
export const nextCursor = plantSearchSession.signals.nextCursor
export const totalEstimate = plantSearchSession.signals.totalEstimate
export const searchStatus = plantSearchSession.signals.status
export const searchError = plantSearchSession.signals.error
export const isSearching = computed(() => isPlantSearchLoading(searchStatus.value))

// ── Filter options (loaded once) ─────────────────────────────────────────────

export const filterOptions = signal<FilterOptions | null>(null)

// ── Dynamic "More Filters" state ────────────────────────────────────────────
export const extraFilters = plantSearchSession.signals.extraFilters
export const dynamicOptionsCache = plantSearchSession.signals.dynamicOptionsCache
export const dynamicOptionsPending = plantSearchSession.signals.dynamicOptionsPending
export const dynamicOptionsErrors = plantSearchSession.signals.dynamicOptionsErrors

// ── View state ────────────────────────────────────────────────────────────────

export type ViewMode = 'list' | 'card'
export const viewMode = signal<ViewMode>('list')
export const selectedCanonicalName = signal<string | null>(null)

// ── Favorites / recently viewed ──────────────────────────────────────────────

export const favoriteNames = signal<string[]>([])
export const favoriteItems = signal<SpeciesListItem[]>([])
export const favoriteItemsLoading = signal(false)
export const favoriteItemsRevision = signal(0)
export const recentlyViewed = signal<SpeciesListItem[]>([])

// ── Derived ───────────────────────────────────────────────────────────────────

export const hasActiveFilters = computed(() => {
  const filters = activeFilters.value
  return (
    (filters.sun_tolerances !== null && filters.sun_tolerances.length > 0) ||
    (filters.soil_tolerances !== null && filters.soil_tolerances.length > 0) ||
    (filters.growth_rate !== null && filters.growth_rate.length > 0) ||
    (filters.life_cycle !== null && filters.life_cycle.length > 0) ||
    filters.edible !== null ||
    filters.edibility_min !== null ||
    filters.nitrogen_fixer !== null ||
    (filters.climate_zones !== null && filters.climate_zones.length > 0) ||
    (filters.habit !== null && filters.habit.length > 0) ||
    filters.woody !== null ||
    filters.family !== null ||
    (filters.extra !== null && filters.extra.length > 0) ||
    extraFilters.value.length > 0
  )
})

export const hasExtraFilters = computed(() => extraFilters.value.length > 0)

export const activeFilterCount = computed(() => {
  const filters = activeFilters.value
  let count = 0
  if (filters.climate_zones !== null && filters.climate_zones.length > 0) count++
  if (filters.habit !== null && filters.habit.length > 0) count++
  if (filters.sun_tolerances !== null && filters.sun_tolerances.length > 0) count++
  if (filters.soil_tolerances !== null && filters.soil_tolerances.length > 0) count++
  if (filters.growth_rate !== null && filters.growth_rate.length > 0) count++
  if (filters.life_cycle !== null && filters.life_cycle.length > 0) count++
  if (filters.edibility_min !== null) count++
  if (filters.woody !== null) count++
  if (filters.nitrogen_fixer !== null) count++
  count += extraFilters.value.length
  return count
})

export type { DynamicFilter, FilterOp }
