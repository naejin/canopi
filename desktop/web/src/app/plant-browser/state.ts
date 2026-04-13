import { computed, signal } from '@preact/signals'
import type {
  DynamicFilter,
  DynamicFilterOptions,
  FilterOp,
  FilterOptions,
  Sort,
  SpeciesFilter,
  SpeciesListItem,
} from '../../types/species'

export function createEmptySpeciesFilter(): SpeciesFilter {
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
}

// ── Search state ──────────────────────────────────────────────────────────────

export const searchText = signal('')
export const activeFilters = signal<SpeciesFilter>(createEmptySpeciesFilter())
export const sortField = signal<Sort>('Name')
export const searchResults = signal<SpeciesListItem[]>([])
export const searchResultsRevision = signal(0)
export const nextCursor = signal<string | null>(null)
export const totalEstimate = signal(0)
export const isSearching = signal(false)
export const searchError = signal<string | null>(null)

// ── Filter options (loaded once) ─────────────────────────────────────────────

export const filterOptions = signal<FilterOptions | null>(null)

// ── Dynamic "More Filters" state ────────────────────────────────────────────
export const extraFilters = signal<DynamicFilter[]>([])
export const dynamicOptionsCache = signal<Record<string, Record<string, DynamicFilterOptions>>>({})
export const dynamicOptionsPending = signal<Record<string, Record<string, boolean>>>({})
export const dynamicOptionsErrors = signal<Record<string, Record<string, string>>>({})

export const DYNAMIC_OPTIONS_BACKEND_MISMATCH_ERROR =
  'Filter not exposed by running desktop backend. Restart the app after rebuilding.'

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
