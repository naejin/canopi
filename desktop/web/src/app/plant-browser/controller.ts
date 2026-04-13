import { batch, effect } from '@preact/signals'
import { getFavorites, getRecentlyViewed, toggleFavorite } from '../../ipc/favorites'
import { getDynamicFilterOptions, getFilterOptions, searchSpecies } from '../../ipc/species'
import { locale } from '../settings/state'
import type { SpeciesFilter } from '../../types/species'
import {
  activeFilters,
  createEmptySpeciesFilter,
  DYNAMIC_OPTIONS_BACKEND_MISMATCH_ERROR,
  dynamicOptionsCache,
  dynamicOptionsErrors,
  dynamicOptionsPending,
  extraFilters,
  favoriteItems,
  favoriteItemsLoading,
  favoriteItemsRevision,
  favoriteNames,
  filterOptions,
  isSearching,
  nextCursor,
  recentlyViewed,
  searchError,
  searchResults,
  searchResultsRevision,
  searchText,
  sortField,
  totalEstimate,
  type FilterOp,
} from './state'

let searchGeneration = 0
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let favoriteItemsGeneration = 0
let sidebarListsGeneration = 0

function mergedFilters(): SpeciesFilter {
  const filters = activeFilters.value
  const extras = extraFilters.value
  if (extras.length === 0) return filters
  const existing = filters.extra ?? []
  return { ...filters, extra: [...existing, ...extras] }
}

async function executeSearch(generation: number): Promise<void> {
  try {
    const result = await searchSpecies(
      searchText.value,
      mergedFilters(),
      null,
      50,
      sortField.value,
      locale.value,
      true,
    )

    if (generation !== searchGeneration) return

    batch(() => {
      searchResults.value = result.items
      searchResultsRevision.value += 1
      nextCursor.value = result.next_cursor
      totalEstimate.value = result.total_estimate
      isSearching.value = false
      searchError.value = null
    })
  } catch (error) {
    if (generation !== searchGeneration) return
    batch(() => {
      isSearching.value = false
      searchError.value = error instanceof Error ? error.message : String(error)
    })
  }
}

function scheduleSearch(debounceMs: number): void {
  searchGeneration += 1
  const generation = searchGeneration

  batch(() => {
    nextCursor.value = null
    searchError.value = null
    isSearching.value = true
  })

  if (debounceTimer !== null) {
    clearTimeout(debounceTimer)
  }

  if (debounceMs <= 0) {
    debounceTimer = null
    void executeSearch(generation)
  } else {
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      void executeSearch(generation)
    }, debounceMs)
  }
}

let controllerUsers = 0
let disposeSearchEffect: (() => void) | null = null
let lastText = searchText.peek()

function startPlantDbController(): void {
  if (disposeSearchEffect) return

  lastText = searchText.peek()
  disposeSearchEffect = effect(() => {
    const text = searchText.value
    void activeFilters.value
    void extraFilters.value
    void sortField.value
    void locale.value

    const textChanged = text !== lastText
    lastText = text
    scheduleSearch(textChanged ? 150 : 0)
  })
}

function stopPlantDbController(): void {
  disposeSearchEffect?.()
  disposeSearchEffect = null
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
}

export function mountPlantDbController(): () => void {
  controllerUsers += 1
  startPlantDbController()

  return () => {
    controllerUsers = Math.max(0, controllerUsers - 1)
    if (controllerUsers === 0) {
      stopPlantDbController()
    }
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    controllerUsers = 0
    stopPlantDbController()
  })
}

/** Force a fresh search — used when the initial search may have failed due to IPC not being ready. */
export function retrySearch(): void {
  scheduleSearch(0)
}

/** Load the next page using the current cursor (infinite scroll). */
export async function loadNextPage(): Promise<void> {
  const cursor = nextCursor.value
  if (cursor === null || isSearching.value) return

  const generation = searchGeneration
  isSearching.value = true

  try {
    const result = await searchSpecies(
      searchText.value,
      mergedFilters(),
      cursor,
      50,
      sortField.value,
      locale.value,
      false,
    )

    if (generation !== searchGeneration) return

    batch(() => {
      searchResults.value = [...searchResults.value, ...result.items]
      nextCursor.value = result.next_cursor
      isSearching.value = false
    })
  } catch (error) {
    if (generation !== searchGeneration) return
    batch(() => {
      isSearching.value = false
      searchError.value = error instanceof Error ? error.message : String(error)
    })
  }
}

/** Load filter options once on first panel mount. */
export async function loadFilterOptions(): Promise<void> {
  if (filterOptions.value !== null) return
  try {
    filterOptions.value = await getFilterOptions()
  } catch {
    // Non-fatal — filters will just be empty
  }
}

/** Patch active filters — shared by FilterStrip and ActiveChips. */
export function patchFilters(patch: Partial<SpeciesFilter>): void {
  activeFilters.value = { ...activeFilters.value, ...patch }
}

/** Toggle a favorite and keep search + favorites state in sync. */
export async function toggleFavoriteAction(canonicalName: string): Promise<void> {
  try {
    favoriteItemsGeneration += 1
    favoriteItemsLoading.value = false
    favoriteItemsRevision.value += 1
    const nowFavorite = await toggleFavorite(canonicalName)
    const currentItem = searchResults.value.find((item) => item.canonical_name === canonicalName)

    if (nowFavorite) {
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
    } else {
      favoriteNames.value = favoriteNames.value.filter((name) => name !== canonicalName)
      favoriteItems.value = favoriteItems.value.filter((item) => item.canonical_name !== canonicalName)
    }

    searchResults.value = searchResults.value.map((item) =>
      item.canonical_name === canonicalName
        ? { ...item, is_favorite: nowFavorite }
        : item,
    )
  } catch {
    // Non-fatal — UI stays as-is
  }
}

/** Load favorites and recently viewed for the current locale. */
export async function loadSidebarLists(): Promise<void> {
  const generation = ++sidebarListsGeneration
  const currentLocale = locale.value
  try {
    const [favorites, recent] = await Promise.all([
      getFavorites(currentLocale),
      getRecentlyViewed(currentLocale, 50),
    ])
    if (generation !== sidebarListsGeneration || currentLocale !== locale.value) return
    favoriteNames.value = favorites.map((item) => item.canonical_name)
    recentlyViewed.value = recent
  } catch {
    // Non-fatal
  }
}

/** Load the full favorite list for the favorites panel. */
export async function loadFavoriteItems(): Promise<void> {
  const generation = ++favoriteItemsGeneration
  const requestedLocale = locale.value
  favoriteItemsLoading.value = true
  try {
    const items = await getFavorites(requestedLocale)
    if (generation !== favoriteItemsGeneration || requestedLocale !== locale.value) return
    favoriteItems.value = items
    favoriteNames.value = items.map((item) => item.canonical_name)
  } catch {
    // Non-fatal
  } finally {
    if (generation === favoriteItemsGeneration) {
      favoriteItemsLoading.value = false
    }
  }
}

/** Add or update a dynamic filter. */
export function addExtraFilter(field: string, op: FilterOp, values: string[]): void {
  const current = extraFilters.value
  const without = current.filter((filter) => filter.field !== field)
  extraFilters.value = [...without, { field, op, values }]
}

/** Remove a dynamic filter by field name. */
export function removeExtraFilter(field: string): void {
  extraFilters.value = extraFilters.value.filter((filter) => filter.field !== field)
}

/** Load dynamic filter options for a set of fields (with caching). */
export async function loadDynamicOptions(fields: string[]): Promise<void> {
  const currentLocale = locale.value
  const cacheForLocale = dynamicOptionsCache.value[currentLocale] ?? {}
  const pendingForLocale = dynamicOptionsPending.value[currentLocale] ?? {}
  const uncached = fields.filter((field) => !cacheForLocale[field] && !pendingForLocale[field])
  if (uncached.length === 0) return

  const errorsForLocale = { ...(dynamicOptionsErrors.value[currentLocale] ?? {}) }
  for (const field of uncached) {
    delete errorsForLocale[field]
  }
  dynamicOptionsErrors.value = {
    ...dynamicOptionsErrors.value,
    [currentLocale]: errorsForLocale,
  }

  dynamicOptionsPending.value = {
    ...dynamicOptionsPending.value,
    [currentLocale]: {
      ...pendingForLocale,
      ...Object.fromEntries(uncached.map((field) => [field, true])),
    },
  }

  try {
    const options = await getDynamicFilterOptions(uncached, currentLocale)
    const updatedLocale = { ...(dynamicOptionsCache.value[currentLocale] ?? {}) }
    const updatedErrors = { ...(dynamicOptionsErrors.value[currentLocale] ?? {}) }
    for (const option of options) {
      updatedLocale[option.field] = option
      delete updatedErrors[option.field]
    }

    const returnedFields = new Set(options.map((option) => option.field))
    const missingFields = uncached.filter((field) => !returnedFields.has(field))
    if (missingFields.length > 0) {
      console.error('Dynamic filter options missing from IPC response', {
        locale: currentLocale,
        requested: uncached,
        returned: [...returnedFields],
        missing: missingFields,
      })
      for (const field of missingFields) {
        updatedErrors[field] = DYNAMIC_OPTIONS_BACKEND_MISMATCH_ERROR
      }
    }

    dynamicOptionsCache.value = { ...dynamicOptionsCache.value, [currentLocale]: updatedLocale }
    dynamicOptionsErrors.value = { ...dynamicOptionsErrors.value, [currentLocale]: updatedErrors }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Failed to load dynamic filter options', {
      locale: currentLocale,
      fields: uncached,
      error: message,
    })
    dynamicOptionsErrors.value = {
      ...dynamicOptionsErrors.value,
      [currentLocale]: {
        ...(dynamicOptionsErrors.value[currentLocale] ?? {}),
        ...Object.fromEntries(uncached.map((field) => [field, message])),
      },
    }
  } finally {
    const localePending = { ...(dynamicOptionsPending.value[currentLocale] ?? {}) }
    for (const field of uncached) {
      delete localePending[field]
    }
    dynamicOptionsPending.value = { ...dynamicOptionsPending.value, [currentLocale]: localePending }
  }
}

/** Clear all active filters. */
export function clearFilters(): void {
  activeFilters.value = createEmptySpeciesFilter()
  extraFilters.value = []
}
