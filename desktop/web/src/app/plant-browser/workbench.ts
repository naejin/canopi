import { computed, type ReadonlySignal } from '@preact/signals'
import type {
  DynamicFilterOptions,
  FilterOp,
  FilterOptions,
  Sort,
  SpeciesFilter,
  SpeciesListItem,
} from '../../types/species'
import {
  activeFilterCount,
  dynamicOptionsCache,
  dynamicOptionsErrors,
  dynamicOptionsPending,
  favoriteItems,
  favoriteItemsLoading,
  favoriteItemsRevision,
  favoriteNames,
  filterOptions,
  hasActiveFilters,
  plantSearchSession,
  selectedCanonicalName,
  viewMode,
  type ViewMode,
} from './state'
import {
  addExtraFilter,
  clearFilters,
  loadDynamicOptions,
  loadFavoriteItems,
  loadFilterOptions,
  loadNextPage,
  loadSidebarLists,
  mountPlantDbController,
  patchFilters,
  removeExtraFilter,
  retrySearch,
  toggleFavoriteAction,
} from './controller'
import { plantFilterCatalog, type StripControlField } from './plant-filter-model'
import {
  isActiveSpeciesSearchText,
  isPlantSearchLoading,
  type PlantSearchIntent,
  type PlantSearchResultState,
  type PlantSearchStatus,
} from './search-session'

export interface SpeciesCatalogFilterStripView {
  readonly options: FilterOptions | null
  readonly filters: SpeciesFilter
  readonly hasActive: boolean
  readonly activeCount: number
  readonly controls: readonly StripControlField[]
}

export interface SpeciesCatalogFavoritesView {
  readonly items: readonly SpeciesListItem[]
  readonly loading: boolean
  readonly revision: number
}

export interface SpeciesCatalogDynamicOptionsView {
  readonly cache: Record<string, Record<string, DynamicFilterOptions>>
  readonly pending: Record<string, Record<string, boolean>>
  readonly errors: Record<string, Record<string, string>>
}

export interface SpeciesCatalogWorkbench {
  readonly intent: ReadonlySignal<PlantSearchIntent>
  readonly results: ReadonlySignal<PlantSearchResultState>
  readonly selectedCanonicalName: ReadonlySignal<string | null>
  readonly viewMode: ReadonlySignal<ViewMode>
  readonly hasActiveFilters: ReadonlySignal<boolean>
  readonly filterStrip: ReadonlySignal<SpeciesCatalogFilterStripView>
  readonly favorites: ReadonlySignal<SpeciesCatalogFavoritesView>
  readonly dynamicOptions: ReadonlySignal<SpeciesCatalogDynamicOptionsView>
  mount(): () => void
  ensureInitialSearch(): void
  reloadSidebarLists(): Promise<void>
  loadFavorites(): Promise<void>
  loadFilterOptions(): Promise<void>
  setSearchText(text: string): void
  clearSearchText(): void
  retrySearch(): void
  loadNextPage(): Promise<void>
  setSort(sort: Sort): void
  setViewMode(mode: ViewMode): void
  patchFilters(patch: Partial<SpeciesFilter>): void
  clearFilters(): void
  addExtraFilter(field: string, op: FilterOp, values: string[]): void
  removeExtraFilter(field: string): void
  loadDynamicOptions(fields: string[]): Promise<void>
  selectSpecies(canonicalName: string): void
  closeSpeciesDetail(): void
  toggleFavorite(canonicalName: string): Promise<void>
  isFavorite(canonicalName: string): boolean
  isSearchLoading(status: PlantSearchStatus): boolean
  isActiveSearchText(text: string): boolean
}

const selectedCanonical = computed(() => selectedCanonicalName.value)
const currentViewMode = computed(() => viewMode.value)

const filterStrip = computed<SpeciesCatalogFilterStripView>(() => ({
  options: filterOptions.value,
  filters: plantSearchSession.intent.value.filters,
  hasActive: hasActiveFilters.value,
  activeCount: activeFilterCount.value,
  controls: plantFilterCatalog.stripControls(),
}))

const favorites = computed<SpeciesCatalogFavoritesView>(() => ({
  items: favoriteItems.value,
  loading: favoriteItemsLoading.value,
  revision: favoriteItemsRevision.value,
}))

const dynamicOptions = computed<SpeciesCatalogDynamicOptionsView>(() => ({
  cache: dynamicOptionsCache.value,
  pending: dynamicOptionsPending.value,
  errors: dynamicOptionsErrors.value,
}))

export const speciesCatalogWorkbench: SpeciesCatalogWorkbench = {
  intent: plantSearchSession.intent,
  results: plantSearchSession.results,
  selectedCanonicalName: selectedCanonical,
  viewMode: currentViewMode,
  hasActiveFilters,
  filterStrip,
  favorites,
  dynamicOptions,

  mount: mountPlantDbController,

  ensureInitialSearch() {
    const results = plantSearchSession.results.value
    if (results.items.length === 0 && !isPlantSearchLoading(results.status)) {
      retrySearch()
    }
  },

  reloadSidebarLists: loadSidebarLists,
  loadFavorites: loadFavoriteItems,
  loadFilterOptions,

  setSearchText(text) {
    plantSearchSession.setText(text)
  },

  clearSearchText() {
    plantSearchSession.setText('')
  },

  retrySearch,
  loadNextPage,

  setSort(sort) {
    plantSearchSession.setSort(sort)
  },

  setViewMode(mode) {
    viewMode.value = mode
  },

  patchFilters,
  clearFilters,
  addExtraFilter,
  removeExtraFilter,
  loadDynamicOptions,

  selectSpecies(canonicalName) {
    selectedCanonicalName.value = canonicalName
  },

  closeSpeciesDetail() {
    selectedCanonicalName.value = null
  },

  toggleFavorite: toggleFavoriteAction,

  isFavorite(canonicalName) {
    return favoriteNames.value.includes(canonicalName)
  },

  isSearchLoading: isPlantSearchLoading,

  isActiveSearchText: isActiveSpeciesSearchText,
}
