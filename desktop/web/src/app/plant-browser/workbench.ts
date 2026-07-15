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
  type PlantSearchSupersedeAdapter,
  type PlantSearchStatus,
} from './search-session'
import { plantFilterCatalog, plantFilterModel, type StripControlField } from './plant-filter-model'

export { DYNAMIC_OPTIONS_BACKEND_MISMATCH_ERROR }

export type ViewMode = 'list' | 'card'

type FilterOptionsAdapter = () => Promise<FilterOptions | null>
type SupportedFilterFieldsAdapter = () => Promise<readonly string[] | null>
type FavoriteItemsAdapter = (locale: string) => Promise<SpeciesListItem[]>
type RecentlyViewedAdapter = (locale: string, limit: number) => Promise<SpeciesListItem[]>
type ToggleFavoriteAdapter = (canonicalName: string) => Promise<boolean>
type SpeciesSelectedAdapter = (canonicalName: string) => void | Promise<void>
type SpeciesDetailAdapter = (canonicalName: string, locale: string) => Promise<SpeciesCatalogDetail | null>

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

export interface SpeciesCatalogDetailImage {
  readonly url: string
  readonly source: string | null
  readonly source_page_url: string | null
  readonly credit: string | null
  readonly license: string | null
}

export interface SpeciesCatalogDetail {
  readonly canonical_name: string
  readonly common_name: string | null
  readonly common_names: readonly string[]
  readonly climate_zones: readonly string[]
  readonly habit: string | null
  readonly growth_form: string | null
  readonly life_cycles: readonly string[]
  readonly image: SpeciesCatalogDetailImage | null
}

export interface SpeciesCatalogDetailView {
  readonly canonicalName: string | null
  readonly detail: SpeciesCatalogDetail | null
  readonly loading: boolean
  readonly error: string | null
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
  readonly detail: ReadonlySignal<SpeciesCatalogDetailView>
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
  readonly supersedeSearch?: PlantSearchSupersedeAdapter
  readonly loadDynamicFilterOptions?: DynamicFilterOptionsAdapter
  readonly getFilterOptions?: FilterOptionsAdapter
  readonly getSupportedFilterFields?: SupportedFilterFieldsAdapter
  readonly getFavorites?: FavoriteItemsAdapter
  readonly getRecentlyViewed?: RecentlyViewedAdapter
  readonly toggleFavorite?: ToggleFavoriteAdapter
  readonly getSpeciesDetail?: SpeciesDetailAdapter
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
const emptySpeciesDetailAdapter: SpeciesDetailAdapter = async () => null

export function createSpeciesCatalogWorkbench({
  search = missingSearchAdapter,
  supersedeSearch,
  loadDynamicFilterOptions = emptyDynamicFilterOptionsAdapter,
  getFilterOptions: getFilterOptionsAdapter = emptyFilterOptionsAdapter,
  getSupportedFilterFields: getSupportedFilterFieldsAdapter,
  getFavorites: getFavoritesAdapterOption,
  getRecentlyViewed: getRecentlyViewedAdapter = emptyRecentlyViewedAdapter,
  toggleFavorite: toggleFavoriteAdapter = emptyToggleFavoriteAdapter,
  getSpeciesDetail: getSpeciesDetailAdapter = emptySpeciesDetailAdapter,
  onSpeciesSelected,
  locale: localeSignal = locale,
  pageSize,
  textDebounceMs,
}: SpeciesCatalogWorkbenchOptions = {}): SpeciesCatalogWorkbench {
  const getFavoritesAdapter = getFavoritesAdapterOption ?? emptyFavoriteItemsAdapter
  const hasAuthoritativeFavoritesAdapter = getFavoritesAdapterOption !== undefined
  const favoriteStateOverrides = new Map<string, boolean>()
  const favoriteMutationItems = new Map<string, SpeciesListItem>()
  const favoriteOverridesRevision = signal(0)

  function projectFavoriteState(item: SpeciesListItem): SpeciesListItem {
    const override = favoriteStateOverrides.get(item.canonical_name)
    return override === undefined || override === item.is_favorite
      ? item
      : { ...item, is_favorite: override }
  }

  function reconcileFavoriteSnapshot(items: readonly SpeciesListItem[]): SpeciesListItem[] {
    const reconciled = items
      .filter((item) => favoriteStateOverrides.get(item.canonical_name) !== false)
      .map((item) => (item.is_favorite ? item : { ...item, is_favorite: true }))
    const presentNames = new Set(reconciled.map((item) => item.canonical_name))
    for (const [canonicalName, nowFavorite] of favoriteStateOverrides) {
      if (!nowFavorite || presentNames.has(canonicalName)) continue
      const mutationItem = favoriteMutationItems.get(canonicalName)
      if (!mutationItem) continue
      reconciled.push({ ...mutationItem, is_favorite: true })
      presentNames.add(canonicalName)
    }
    return reconciled
  }

  const plantSearchSession = createPlantSearchSession({
    search,
    supersedeSearch,
    loadDynamicFilterOptions,
    locale: localeSignal,
    pageSize,
    textDebounceMs,
  })
  const filterOptions = signal<FilterOptions | null>(null)
  const supportedFilterFields = signal<ReadonlySet<string> | null>(
    getSupportedFilterFieldsAdapter ? new Set() : null,
  )
  const viewMode = signal<ViewMode>('list')
  const selectedCanonicalName = signal<string | null>(null)
  const detail = signal<SpeciesCatalogDetailView>({
    canonicalName: null,
    detail: null,
    loading: false,
    error: null,
  })
  const favoriteNames = signal<string[]>([])
  const favoriteItems = signal<SpeciesListItem[]>([])
  const favoriteItemsLoading = signal(false)
  const favoriteItemsRevision = signal(0)
  const recentlyViewed = signal<SpeciesListItem[]>([])
  const projectedResults = computed<PlantSearchResultState>(() => {
    void favoriteOverridesRevision.value
    const result = plantSearchSession.results.value
    return {
      ...result,
      items: result.items.map(projectFavoriteState),
    }
  })
  const allStripControls = plantFilterCatalog.stripControls()
  const stripControls = computed(() => {
    const supported = supportedFilterFields.value
    return supported === null
      ? allStripControls
      : allStripControls.filter((control) => supported.has(control.filterKey))
  })

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
    controls: stripControls.value,
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
  let favoriteNamesGeneration = 0
  let sidebarListsGeneration = 0
  let detailGeneration = 0
  let filterMetadataGeneration = 0
  let filterOptionsLoaded = false
  let supportedFilterFieldsLoaded = getSupportedFilterFieldsAdapter === undefined
  let filterMetadataPromise: Promise<void> | null = null
  let favoriteItemsActivePromise: Promise<void> | null = null
  let favoriteItemsQueuedReload: { promise: Promise<void>; resolve: () => void } | null = null
  const favoriteToggleTails = new Map<string, Promise<void>>()
  let controllerUsers = 0
  let disposeSearchSession: (() => void) | null = null
  let disposed = false

  function startPlantDbController(): void {
    if (disposed || disposeSearchSession) return
    disposeSearchSession = plantSearchSession.start()
  }

  function stopPlantDbController(): void {
    disposeSearchSession?.()
    disposeSearchSession = null
  }

  async function loadFilterOptions(): Promise<void> {
    if (disposed) return
    if (filterOptionsLoaded && supportedFilterFieldsLoaded) return
    const generation = filterMetadataGeneration
    filterMetadataPromise ??= Promise.all([
      loadFilterOptionsProjection(),
      loadSupportedFilterFieldProjection(),
    ]).then(([nextOptions, nextSupportedFields]) => {
      if (disposed || generation !== filterMetadataGeneration) return
      batch(() => {
        filterOptions.value = nextOptions
        if (nextSupportedFields !== null) {
          supportedFilterFields.value = new Set(nextSupportedFields)
        }
      })
    }).finally(() => {
      filterMetadataPromise = null
    })
    return filterMetadataPromise
  }

  async function loadFilterOptionsProjection(): Promise<FilterOptions | null> {
    try {
      const nextOptions = await getFilterOptionsAdapter()
      filterOptionsLoaded = true
      return nextOptions
    } catch {
      // Non-fatal: the filter strip can still render without option rows.
      return null
    }
  }

  async function loadSupportedFilterFieldProjection(): Promise<readonly string[] | null> {
    if (!getSupportedFilterFieldsAdapter) return null
    try {
      const nextSupportedFields = await getSupportedFilterFieldsAdapter()
      supportedFilterFieldsLoaded = true
      return nextSupportedFields
    } catch {
      // Non-fatal for desktop; Web keeps the initially empty supported set.
      return []
    }
  }

  async function toggleFavoriteAction(canonicalName: string): Promise<void> {
    if (disposed) return
    const previous = favoriteToggleTails.get(canonicalName) ?? Promise.resolve()
    const current = previous.then(() => performFavoriteToggle(canonicalName))
    favoriteToggleTails.set(canonicalName, current)
    try {
      await current
    } finally {
      if (favoriteToggleTails.get(canonicalName) === current) {
        favoriteToggleTails.delete(canonicalName)
      }
    }
  }

  async function performFavoriteToggle(canonicalName: string): Promise<void> {
    if (disposed) return
    try {
      const nowFavorite = await toggleFavoriteAdapter(canonicalName)
      if (disposed) return
      favoriteStateOverrides.set(canonicalName, nowFavorite)
      favoriteOverridesRevision.value += 1
      favoriteItemsGeneration += 1
      favoriteNamesGeneration += 1
      const localMutationItem = plantSearchSession.results.value.items.find((item) => (
        item.canonical_name === canonicalName
      )) ?? favoriteItems.value.find((item) => (
        item.canonical_name === canonicalName
      )) ?? recentlyViewed.value.find((item) => (
        item.canonical_name === canonicalName
      ))
      if (localMutationItem) favoriteMutationItems.set(canonicalName, localMutationItem)

      batch(() => {
        favoriteNames.value = reconcileFavoriteNames(
          favoriteNames.value,
          canonicalName,
          nowFavorite,
        )
        favoriteItems.value = reconcileFavoriteItems(
          favoriteItems.value,
          localMutationItem,
          canonicalName,
          nowFavorite,
        )
        recentlyViewed.value = recentlyViewed.value.map(projectFavoriteState)
      })

      plantSearchSession.updateResultItem(canonicalName, (item) => ({
        ...item,
        is_favorite: nowFavorite,
      }))
      if (favoriteItemsActivePromise) void queueFavoriteItemsReload()
      favoriteItemsRevision.value += 1
    } catch {
      // Non-fatal: UI state remains as it was before the attempted toggle.
    }
  }

  async function loadSidebarLists(): Promise<void> {
    if (disposed) return
    const generation = ++sidebarListsGeneration
    const favoriteGeneration = ++favoriteNamesGeneration
    const currentLocale = localeSignal.value
    try {
      const [favorites, recent] = await Promise.all([
        hasAuthoritativeFavoritesAdapter
          ? getFavoritesAdapter(currentLocale).then(reconcileFavoriteSnapshot)
          : Promise.resolve(null),
        getRecentlyViewedAdapter(currentLocale, 50),
      ])
      if (disposed || generation !== sidebarListsGeneration || currentLocale !== localeSignal.value) return
      batch(() => {
        if (favorites && favoriteGeneration === favoriteNamesGeneration) {
          favoriteNames.value = favorites.map((item) => item.canonical_name)
        }
        recentlyViewed.value = recent.map(projectFavoriteState)
      })
    } catch {
      // Non-fatal: sidebar affordances stay stale rather than blocking search.
    }
  }

  function loadFavoriteItems(): Promise<void> {
    if (disposed || !hasAuthoritativeFavoritesAdapter) return Promise.resolve()
    return favoriteItemsActivePromise ? queueFavoriteItemsReload() : startFavoriteItemsLoad()
  }

  function startFavoriteItemsLoad(): Promise<void> {
    favoriteItemsLoading.value = true
    const attempt = runFavoriteItemsLoadAttempt()
    let ownedPromise: Promise<void>
    ownedPromise = attempt.finally(() => finishFavoriteItemsLoad(ownedPromise))
    favoriteItemsActivePromise = ownedPromise
    return ownedPromise
  }

  function queueFavoriteItemsReload(): Promise<void> {
    if (disposed) return Promise.resolve()
    if (!favoriteItemsQueuedReload) {
      let resolve!: () => void
      const promise = new Promise<void>((next) => {
        resolve = next
      })
      favoriteItemsQueuedReload = { promise, resolve }
    }
    return favoriteItemsQueuedReload.promise
  }

  function finishFavoriteItemsLoad(ownedPromise: Promise<void>): void {
    if (favoriteItemsActivePromise !== ownedPromise) return
    favoriteItemsActivePromise = null
    const queuedReload = favoriteItemsQueuedReload
    favoriteItemsQueuedReload = null
    if (disposed || !queuedReload) {
      if (!disposed) favoriteItemsLoading.value = false
      queuedReload?.resolve()
      return
    }
    const trailing = startFavoriteItemsLoad()
    void trailing.then(queuedReload.resolve, queuedReload.resolve)
  }

  async function runFavoriteItemsLoadAttempt(): Promise<void> {
    const generation = ++favoriteItemsGeneration
    const favoriteGeneration = ++favoriteNamesGeneration
    const requestedLocale = localeSignal.value
    try {
      const items = reconcileFavoriteSnapshot(await getFavoritesAdapter(requestedLocale))
      if (
        disposed
        || generation !== favoriteItemsGeneration
        || requestedLocale !== localeSignal.value
      ) return
      batch(() => {
        favoriteItems.value = items
        if (favoriteGeneration === favoriteNamesGeneration) {
          favoriteNames.value = items.map((item) => item.canonical_name)
        }
      })
    } catch {
      // Non-fatal: the favorites panel keeps its previous content.
    }
  }

  async function loadSpeciesDetail(canonicalName: string): Promise<void> {
    if (disposed) return
    const generation = ++detailGeneration
    const requestedLocale = localeSignal.value
    detail.value = {
      canonicalName,
      detail: null,
      loading: true,
      error: null,
    }

    try {
      const nextDetail = await getSpeciesDetailAdapter(canonicalName, requestedLocale)
      if (disposed || generation !== detailGeneration || selectedCanonicalName.value !== canonicalName) return
      detail.value = {
        canonicalName,
        detail: nextDetail,
        loading: false,
        error: null,
      }
    } catch (error) {
      if (disposed || generation !== detailGeneration || selectedCanonicalName.value !== canonicalName) return
      detail.value = {
        canonicalName,
        detail: null,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  return {
    intent: plantSearchSession.intent,
    results: projectedResults,
    selectedCanonicalName: selectedCanonical,
    viewMode: currentViewMode,
    hasActiveFilters,
    filterStrip,
    favorites,
    dynamicOptions,
    sidebar,
    detail,

    mount() {
      if (disposed) return () => {}
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
      if (disposed) return
      disposed = true
      controllerUsers = 0
      stopPlantDbController()
      plantSearchSession.dispose()
      favoriteItemsGeneration += 1
      favoriteNamesGeneration += 1
      sidebarListsGeneration += 1
      detailGeneration += 1
      filterMetadataGeneration += 1
      favoriteItemsQueuedReload?.resolve()
      favoriteItemsQueuedReload = null
    },

    ensureInitialSearch() {
      if (disposed) return
      const results = plantSearchSession.results.value
      if (results.items.length === 0 && !isPlantSearchLoading(results.status)) {
        plantSearchSession.retry()
      }
    },

    reloadSidebarLists: loadSidebarLists,
    loadFavorites: loadFavoriteItems,
    loadFilterOptions,

    setSearchText(text) {
      if (disposed) return
      plantSearchSession.setText(text)
    },

    clearSearchText() {
      if (disposed) return
      plantSearchSession.setText('')
    },

    retrySearch() {
      if (disposed) return
      plantSearchSession.retry()
      void loadFilterOptions()
      void loadSidebarLists()
    },

    loadNextPage() {
      if (disposed) return Promise.resolve()
      return plantSearchSession.loadNextPage()
    },

    setViewMode(mode) {
      if (disposed) return
      viewMode.value = mode
    },

    patchFilters(patch) {
      if (disposed) return
      plantSearchSession.patchFilters(patch)
    },

    clearFilters() {
      if (disposed) return
      plantSearchSession.clearFilters()
    },

    addExtraFilter(field, op, values) {
      if (disposed) return
      plantSearchSession.addExtraFilter(field, op, values)
    },

    removeExtraFilter(field) {
      if (disposed) return
      plantSearchSession.removeExtraFilter(field)
    },

    loadDynamicOptions(fields) {
      if (disposed) return Promise.resolve()
      return plantSearchSession.loadDynamicOptions(fields)
    },

    selectSpecies(canonicalName) {
      if (disposed) return
      selectedCanonicalName.value = canonicalName
      void loadSpeciesDetail(canonicalName)
      try {
        void Promise.resolve(onSpeciesSelected?.(canonicalName)).catch(() => {
          // Non-fatal: selection should still open even if recents persistence fails.
        })
      } catch {
        // Non-fatal: selection should still open even if recents persistence fails.
      }
    },

    closeSpeciesDetail() {
      if (disposed) return
      detailGeneration += 1
      selectedCanonicalName.value = null
      detail.value = {
        canonicalName: null,
        detail: null,
        loading: false,
        error: null,
      }
    },

    toggleFavorite: toggleFavoriteAction,

    isFavorite(canonicalName) {
      return favoriteNames.value.includes(canonicalName)
    },

    isSearchLoading: isPlantSearchLoading,

    isActiveSearchText: isActiveSpeciesSearchText,
  }
}

function reconcileFavoriteNames(
  names: readonly string[],
  canonicalName: string,
  nowFavorite: boolean,
): string[] {
  if (!nowFavorite) return names.filter((name) => name !== canonicalName)
  return names.includes(canonicalName) ? [...names] : [...names, canonicalName]
}

function reconcileFavoriteItems(
  items: readonly SpeciesListItem[],
  mutationItem: SpeciesListItem | undefined,
  canonicalName: string,
  nowFavorite: boolean,
): SpeciesListItem[] {
  if (!nowFavorite) return items.filter((item) => item.canonical_name !== canonicalName)
  const existing = items.find((item) => item.canonical_name === canonicalName)
  if (existing) {
    return items.map((item) => (
      item.canonical_name === canonicalName ? { ...item, is_favorite: true } : item
    ))
  }
  return mutationItem
    ? [{ ...mutationItem, is_favorite: true }, ...items]
    : [...items]
}
