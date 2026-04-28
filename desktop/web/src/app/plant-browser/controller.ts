import { getFavorites, getRecentlyViewed, toggleFavorite } from '../../ipc/favorites'
import { getFilterOptions } from '../../ipc/species'
import { locale } from '../settings/state'
import type { SpeciesFilter } from '../../types/species'
import {
  favoriteItems,
  favoriteItemsLoading,
  favoriteItemsRevision,
  favoriteNames,
  filterOptions,
  plantSearchSession,
  recentlyViewed,
  type FilterOp,
} from './state'

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
  plantSearchSession.retry()
}

/** Load the next page using the current cursor (infinite scroll). */
export async function loadNextPage(): Promise<void> {
  await plantSearchSession.loadNextPage()
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
  plantSearchSession.patchFilters(patch)
}

/** Toggle a favorite and keep search + favorites state in sync. */
export async function toggleFavoriteAction(canonicalName: string): Promise<void> {
  try {
    favoriteItemsGeneration += 1
    favoriteItemsLoading.value = false
    favoriteItemsRevision.value += 1
    const nowFavorite = await toggleFavorite(canonicalName)
    const currentItem = plantSearchSession.results.value.items.find((item) => (
      item.canonical_name === canonicalName
    ))

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

    plantSearchSession.updateResultItem(canonicalName, (item) => ({
      ...item,
      is_favorite: nowFavorite,
    }))
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
  plantSearchSession.addExtraFilter(field, op, values)
}

/** Remove a dynamic filter by field name. */
export function removeExtraFilter(field: string): void {
  plantSearchSession.removeExtraFilter(field)
}

/** Load dynamic filter options for a set of fields (with caching). */
export async function loadDynamicOptions(fields: string[]): Promise<void> {
  await plantSearchSession.loadDynamicOptions(fields)
}

/** Clear all active filters. */
export function clearFilters(): void {
  plantSearchSession.clearFilters()
}
