import { batch, computed, signal, type ReadonlySignal } from '@preact/signals'
import type {
  DynamicFilterOptions,
  FilterOp,
  FilterOptions,
  PaginatedResult,
  SpeciesFilter,
  SpeciesListItem,
  SpeciesSearchRequest,
} from '../../types/species'
import { locale } from '../settings/state'
import {
  createPlantSearchSession,
  DYNAMIC_OPTIONS_BACKEND_MISMATCH_ERROR,
  isActiveSpeciesSearchText,
  isPlantSearchLoading,
  type DynamicFilterOptionsAdapter,
  type PlantSearchAdapter,
  type PlantSearchIntent,
  type PlantSearchResultState,
  type PlantSearchStatus,
} from './search-session'
import { plantFilterCatalog, plantFilterModel, type StripControlField } from './plant-filter-model'

export { DYNAMIC_OPTIONS_BACKEND_MISMATCH_ERROR }

export type ViewMode = 'list' | 'card'

type FilterOptionsAdapter = () => Promise<FilterOptions | null>
type FavoriteItemsAdapter = (locale: string) => Promise<SpeciesListItem[]>
type RecentlyViewedAdapter = (locale: string, limit: number) => Promise<SpeciesListItem[]>
type ToggleFavoriteAdapter = (canonicalName: string) => Promise<boolean>
type SpeciesSelectedAdapter = (canonicalName: string) => void | Promise<void>

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
  readonly cache: Readonly<Record<string, Readonly<Record<string, DynamicFilterOptions>>>>
  readonly pending: Readonly<Record<string, Readonly<Record<string, boolean>>>>
  readonly errors: Readonly<Record<string, Readonly<Record<string, string>>>>
}

export interface SpeciesCatalogSidebarView {
  readonly favoriteNames: readonly string[]
  readonly recentlyViewed: readonly SpeciesListItem[]
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
  readonly sidebar: ReadonlySignal<SpeciesCatalogSidebarView>
  mount(): () => void
  dispose(): void
  ensureInitialSearch(): void
  reloadSidebarLists(): Promise<void>
  loadFavorites(): Promise<void>
  loadFilterOptions(): Promise<void>
  setSearchText(text: string): void
  clearSearchText(): void
  retrySearch(): void
  loadNextPage(): Promise<void>
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

export interface SpeciesCatalogWorkbenchOptions {
  readonly search?: PlantSearchAdapter
  readonly loadDynamicFilterOptions?: DynamicFilterOptionsAdapter
  readonly getFilterOptions?: FilterOptionsAdapter
  readonly getFavorites?: FavoriteItemsAdapter
  readonly getRecentlyViewed?: RecentlyViewedAdapter
  readonly toggleFavorite?: ToggleFavoriteAdapter
  readonly onSpeciesSelected?: SpeciesSelectedAdapter
  readonly locale?: ReadonlySignal<string>
  readonly pageSize?: number
  readonly textDebounceMs?: number
}

export type SpeciesCatalogSearchAdapter = (
  request: SpeciesSearchRequest,
) => Promise<PaginatedResult<SpeciesListItem>>

const missingSearchAdapter: PlantSearchAdapter = async () => {
  throw new Error('Species Catalog Workbench search adapter is not configured.')
}

const emptyDynamicFilterOptionsAdapter: DynamicFilterOptionsAdapter = async () => []
const emptyFilterOptionsAdapter: FilterOptionsAdapter = async () => null
const emptyFavoriteItemsAdapter: FavoriteItemsAdapter = async () => []
const emptyRecentlyViewedAdapter: RecentlyViewedAdapter = async () => []
const emptyToggleFavoriteAdapter: ToggleFavoriteAdapter = async () => false

export function createSpeciesCatalogWorkbench({
  search = missingSearchAdapter,
  loadDynamicFilterOptions = emptyDynamicFilterOptionsAdapter,
  getFilterOptions: getFilterOptionsAdapter = emptyFilterOptionsAdapter,
  getFavorites: getFavoritesAdapter = emptyFavoriteItemsAdapter,
  getRecentlyViewed: getRecentlyViewedAdapter = emptyRecentlyViewedAdapter,
  toggleFavorite: toggleFavoriteAdapter = emptyToggleFavoriteAdapter,
  onSpeciesSelected,
  locale: localeSignal = locale,
  pageSize,
  textDebounceMs,
}: SpeciesCatalogWorkbenchOptions = {}): SpeciesCatalogWorkbench {
  const plantSearchSession = createPlantSearchSession({
    search,
    loadDynamicFilterOptions,
    locale: localeSignal,
    pageSize,
    textDebounceMs,
  })
  const filterOptions = signal<FilterOptions | null>(null)
  const viewMode = signal<ViewMode>('list')
  const selectedCanonicalName = signal<string | null>(null)
  const favoriteNames = signal<string[]>([])
  const favoriteItems = signal<SpeciesListItem[]>([])
  const favoriteItemsLoading = signal(false)
  const favoriteItemsRevision = signal(0)
  const recentlyViewed = signal<SpeciesListItem[]>([])
  const stripControls = plantFilterCatalog.stripControls()

  const hasActiveFilters = computed(() => {
    const intent = plantSearchSession.intent.value
    return plantFilterModel.hasActive(intent.filters, intent.extraFilters)
  })

  const activeFilterCount = computed(() => {
    const intent = plantSearchSession.intent.value
    return plantFilterModel.activeCount(intent.filters, intent.extraFilters)
  })

  const selectedCanonical = computed(() => selectedCanonicalName.value)
  const currentViewMode = computed(() => viewMode.value)

  const filterStrip = computed<SpeciesCatalogFilterStripView>(() => ({
    options: filterOptions.value,
    filters: plantSearchSession.intent.value.filters,
    hasActive: hasActiveFilters.value,
    activeCount: activeFilterCount.value,
    controls: stripControls,
  }))

  const favorites = computed<SpeciesCatalogFavoritesView>(() => ({
    items: favoriteItems.value,
    loading: favoriteItemsLoading.value,
    revision: favoriteItemsRevision.value,
  }))

  const dynamicOptions = computed<SpeciesCatalogDynamicOptionsView>(() => ({
    cache: plantSearchSession.signals.dynamicOptionsCache.value,
    pending: plantSearchSession.signals.dynamicOptionsPending.value,
    errors: plantSearchSession.signals.dynamicOptionsErrors.value,
  }))

  const sidebar = computed<SpeciesCatalogSidebarView>(() => ({
    favoriteNames: favoriteNames.value,
    recentlyViewed: recentlyViewed.value,
  }))

  let favoriteItemsGeneration = 0
  let sidebarListsGeneration = 0
  let controllerUsers = 0
  let disposeSearchSession: (() => void) | null = null

  function startPlantDbController(): void {
    if (disposeSearchSession) return
    disposeSearchSession = plantSearchSession.start()
  }

  function stopPlantDbController(): void {
    disposeSearchSession?.()
    disposeSearchSession = null
  }

  async function loadFilterOptions(): Promise<void> {
    if (filterOptions.value !== null) return
    try {
      filterOptions.value = await getFilterOptionsAdapter()
    } catch {
      // Non-fatal: the filter strip can still render without option rows.
    }
  }

  async function toggleFavoriteAction(canonicalName: string): Promise<void> {
    try {
      favoriteItemsGeneration += 1
      favoriteItemsLoading.value = false
      favoriteItemsRevision.value += 1
      const nowFavorite = await toggleFavoriteAdapter(canonicalName)
      const currentItem = plantSearchSession.results.value.items.find((item) => (
        item.canonical_name === canonicalName
      ))

      if (nowFavorite) {
        batch(() => {
          if (!favoriteNames.value.includes(canonicalName)) {
            favoriteNames.value = [...favoriteNames.value, canonicalName]
          }
          favoriteItems.value = currentItem
            ? [
                { ...currentItem, is_favorite: true },
                ...favoriteItems.value.filter((item) => item.canonical_name !== canonicalName),
              ]
            : favoriteItems.value.map((item) =>
                item.canonical_name === canonicalName
                  ? { ...item, is_favorite: true }
                  : item,
              )
        })
      } else {
        batch(() => {
          favoriteNames.value = favoriteNames.value.filter((name) => name !== canonicalName)
          favoriteItems.value = favoriteItems.value.filter((item) => item.canonical_name !== canonicalName)
        })
      }

      plantSearchSession.updateResultItem(canonicalName, (item) => ({
        ...item,
        is_favorite: nowFavorite,
      }))
    } catch {
      // Non-fatal: UI state remains as it was before the attempted toggle.
    }
  }

  async function loadSidebarLists(): Promise<void> {
    const generation = ++sidebarListsGeneration
    const currentLocale = localeSignal.value
    try {
      const [favorites, recent] = await Promise.all([
        getFavoritesAdapter(currentLocale),
        getRecentlyViewedAdapter(currentLocale, 50),
      ])
      if (generation !== sidebarListsGeneration || currentLocale !== localeSignal.value) return
      batch(() => {
        favoriteNames.value = favorites.map((item) => item.canonical_name)
        recentlyViewed.value = recent
      })
    } catch {
      // Non-fatal: sidebar affordances stay stale rather than blocking search.
    }
  }

  async function loadFavoriteItems(): Promise<void> {
    const generation = ++favoriteItemsGeneration
    const requestedLocale = localeSignal.value
    favoriteItemsLoading.value = true
    try {
      const items = await getFavoritesAdapter(requestedLocale)
      if (generation !== favoriteItemsGeneration || requestedLocale !== localeSignal.value) return
      batch(() => {
        favoriteItems.value = items
        favoriteNames.value = items.map((item) => item.canonical_name)
      })
    } catch {
      // Non-fatal: the favorites panel keeps its previous content.
    } finally {
      if (generation === favoriteItemsGeneration) {
        favoriteItemsLoading.value = false
      }
    }
  }

  return {
    intent: plantSearchSession.intent,
    results: plantSearchSession.results,
    selectedCanonicalName: selectedCanonical,
    viewMode: currentViewMode,
    hasActiveFilters,
    filterStrip,
    favorites,
    dynamicOptions,
    sidebar,

    mount() {
      controllerUsers += 1
      startPlantDbController()

      return () => {
        controllerUsers = Math.max(0, controllerUsers - 1)
        if (controllerUsers === 0) {
          stopPlantDbController()
        }
      }
    },

    dispose() {
      controllerUsers = 0
      stopPlantDbController()
    },

    ensureInitialSearch() {
      const results = plantSearchSession.results.value
      if (results.items.length === 0 && !isPlantSearchLoading(results.status)) {
        plantSearchSession.retry()
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

    retrySearch() {
      plantSearchSession.retry()
    },

    loadNextPage() {
      return plantSearchSession.loadNextPage()
    },

    setViewMode(mode) {
      viewMode.value = mode
    },

    patchFilters(patch) {
      plantSearchSession.patchFilters(patch)
    },

    clearFilters() {
      plantSearchSession.clearFilters()
    },

    addExtraFilter(field, op, values) {
      plantSearchSession.addExtraFilter(field, op, values)
    },

    removeExtraFilter(field) {
      plantSearchSession.removeExtraFilter(field)
    },

    loadDynamicOptions(fields) {
      return plantSearchSession.loadDynamicOptions(fields)
    },

    selectSpecies(canonicalName) {
      selectedCanonicalName.value = canonicalName
      try {
        void onSpeciesSelected?.(canonicalName)
      } catch {
        // Non-fatal: selection should still open even if recents persistence fails.
      }
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
}
