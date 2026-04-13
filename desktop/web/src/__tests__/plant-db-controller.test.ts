import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DynamicFilterOptions } from '../types/species'

const mocks = vi.hoisted(() => ({
  searchSpecies: vi.fn(async () => ({
    items: [],
    next_cursor: null,
    total_estimate: 0,
  })),
  getFilterOptions: vi.fn(async () => null),
  getDynamicFilterOptions: vi.fn(async () => []),
  toggleFavorite: vi.fn(),
  getFavorites: vi.fn(async () => []),
  getRecentlyViewed: vi.fn(async () => []),
}))

vi.mock('../ipc/species', () => ({
  searchSpecies: mocks.searchSpecies,
  getFilterOptions: mocks.getFilterOptions,
  getDynamicFilterOptions: mocks.getDynamicFilterOptions,
}))

vi.mock('../ipc/favorites', () => ({
  toggleFavorite: mocks.toggleFavorite,
  getFavorites: mocks.getFavorites,
  getRecentlyViewed: mocks.getRecentlyViewed,
}))

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.resetModules()
  mocks.searchSpecies.mockClear()
  mocks.getFilterOptions.mockClear()
  mocks.getDynamicFilterOptions.mockClear()
  mocks.toggleFavorite.mockClear()
  mocks.getFavorites.mockClear()
  mocks.getRecentlyViewed.mockClear()
  vi.restoreAllMocks()
})

describe('plant DB controller lifecycle', () => {
  it('does not execute searches on module import alone', async () => {
    await import('../app/plant-browser')
    expect(mocks.searchSpecies).not.toHaveBeenCalled()
  })

  it('starts searches on mount and stops after dispose', async () => {
    const plantDb = await import('../app/plant-browser')
    const dispose = plantDb.mountPlantDbController()

    await flushMicrotasks()
    expect(mocks.searchSpecies).toHaveBeenCalledTimes(1)

    mocks.searchSpecies.mockClear()
    dispose()
    plantDb.sortField.value = 'Family'
    await flushMicrotasks()

    expect(mocks.searchSpecies).not.toHaveBeenCalled()
  })

  it('surfaces explicit unavailable errors when search short-circuits in degraded mode', async () => {
    const plantDb = await import('../app/plant-browser')
    ;(mocks.searchSpecies as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('Plant database unavailable: bundled plant database is missing'))

    const dispose = plantDb.mountPlantDbController()
    await flushMicrotasks()

    expect(plantDb.searchError.value).toBe(
      'Plant database unavailable: bundled plant database is missing',
    )
    expect(plantDb.isSearching.value).toBe(false)
    dispose()
  })

  it('increments result-set revision on first-page searches but not pagination appends', async () => {
    const plantDb = await import('../app/plant-browser')
    const dispose = plantDb.mountPlantDbController()

    await flushMicrotasks()
    expect(plantDb.searchResultsRevision.value).toBe(1)

    plantDb.nextCursor.value = 'offset:50'
    ;(mocks.searchSpecies as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      items: [],
      next_cursor: null,
      total_estimate: 0,
    })

    await plantDb.loadNextPage()

    expect(plantDb.searchResultsRevision.value).toBe(1)
    dispose()
  })

  it('caches dynamic filter options per locale', async () => {
    const plantDb = await import('../app/plant-browser')
    const appState = await import('../app/settings/state')
    const englishOptions: DynamicFilterOptions[] = [
      {
        field: 'habit',
        field_type: 'categorical',
        values: [{ value: 'Shrub', label: 'Shrub' }],
        range: null,
      },
    ]
    const frenchOptions: DynamicFilterOptions[] = [
      {
        field: 'habit',
        field_type: 'categorical',
        values: [{ value: 'Shrub', label: 'Arbuste' }],
        range: null,
      },
    ]

    ;(mocks.getDynamicFilterOptions as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(englishOptions)
      .mockResolvedValueOnce(frenchOptions)

    appState.locale.value = 'en'
    await plantDb.loadDynamicOptions(['habit'])
    expect(mocks.getDynamicFilterOptions).toHaveBeenNthCalledWith(1, ['habit'], 'en')
    expect(plantDb.dynamicOptionsCache.value.en?.habit?.values?.[0]?.label).toBe('Shrub')

    appState.locale.value = 'fr'
    await plantDb.loadDynamicOptions(['habit'])
    expect(mocks.getDynamicFilterOptions).toHaveBeenNthCalledWith(2, ['habit'], 'fr')
    expect(plantDb.dynamicOptionsCache.value.fr?.habit?.values?.[0]?.label).toBe('Arbuste')

    appState.locale.value = 'en'
    await plantDb.loadDynamicOptions(['habit'])
    expect(mocks.getDynamicFilterOptions).toHaveBeenCalledTimes(2)
  })

  it('deduplicates concurrent dynamic option requests for the same locale and field', async () => {
    const plantDb = await import('../app/plant-browser')
    const appState = await import('../app/settings/state')
    let resolveRequest!: (value: DynamicFilterOptions[]) => void
    const request = new Promise<DynamicFilterOptions[]>((resolve) => {
      resolveRequest = resolve
    })

    ;(mocks.getDynamicFilterOptions as ReturnType<typeof vi.fn>).mockReturnValueOnce(request)

    appState.locale.value = 'fr'
    const first = plantDb.loadDynamicOptions(['habit'])
    const second = plantDb.loadDynamicOptions(['habit'])

    expect(mocks.getDynamicFilterOptions).toHaveBeenCalledTimes(1)
    expect(plantDb.dynamicOptionsPending.value.fr?.habit).toBe(true)

    resolveRequest([
      {
        field: 'habit',
        field_type: 'categorical',
        values: [{ value: 'Shrub', label: 'Arbuste' }],
        range: null,
      },
    ])

    await first
    await second

    expect(plantDb.dynamicOptionsPending.value.fr?.habit).toBeUndefined()
    expect(plantDb.dynamicOptionsCache.value.fr?.habit?.values?.[0]?.label).toBe('Arbuste')
  })

  it('records a field-level error when IPC returns no options for a requested field', async () => {
    const plantDb = await import('../app/plant-browser')
    const appState = await import('../app/settings/state')
    vi.spyOn(console, 'error').mockImplementation(() => {})

    appState.locale.value = 'en'
    ;(mocks.getDynamicFilterOptions as ReturnType<typeof vi.fn>).mockResolvedValueOnce([])

    await plantDb.loadDynamicOptions(['habit'])

    expect(plantDb.dynamicOptionsCache.value.en?.habit).toBeUndefined()
    expect(plantDb.dynamicOptionsErrors.value.en?.habit).toBe(
      plantDb.DYNAMIC_OPTIONS_BACKEND_MISMATCH_ERROR,
    )
  })

  it('clears field-level errors after a successful retry', async () => {
    const plantDb = await import('../app/plant-browser')
    const appState = await import('../app/settings/state')
    vi.spyOn(console, 'error').mockImplementation(() => {})

    appState.locale.value = 'en'
    ;(mocks.getDynamicFilterOptions as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          field: 'habit',
          field_type: 'categorical',
          values: [{ value: 'Shrub', label: 'Shrub' }],
          range: null,
        },
      ])

    await plantDb.loadDynamicOptions(['habit'])
    expect(plantDb.dynamicOptionsErrors.value.en?.habit).toBe(
      plantDb.DYNAMIC_OPTIONS_BACKEND_MISMATCH_ERROR,
    )

    await plantDb.loadDynamicOptions(['habit'])

    expect(plantDb.dynamicOptionsErrors.value.en?.habit).toBeUndefined()
    expect(plantDb.dynamicOptionsCache.value.en?.habit?.values?.[0]?.label).toBe('Shrub')
  })

  it('records thrown IPC errors per field', async () => {
    const plantDb = await import('../app/plant-browser')
    const appState = await import('../app/settings/state')
    vi.spyOn(console, 'error').mockImplementation(() => {})

    appState.locale.value = 'en'
    ;(mocks.getDynamicFilterOptions as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('backend exploded'))

    await plantDb.loadDynamicOptions(['habit'])

    expect(plantDb.dynamicOptionsErrors.value.en?.habit).toBe('backend exploded')
    expect(plantDb.dynamicOptionsPending.value.en?.habit).toBeUndefined()
  })

  it('preserves the first-page total estimate when loading more results', async () => {
    const plantDb = await import('../app/plant-browser')

    plantDb.totalEstimate.value = 42
    plantDb.nextCursor.value = 'offset:50'

    ;(mocks.searchSpecies as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      items: [],
      next_cursor: null,
      total_estimate: 0,
    })

    await plantDb.loadNextPage()

    expect(mocks.searchSpecies).toHaveBeenCalledWith(
      '',
      expect.any(Object),
      'offset:50',
      50,
      'Name',
      'en',
      false,
    )
    expect(plantDb.totalEstimate.value).toBe(42)
  })

  it('loads favorite items into both detail and badge state', async () => {
    const plantDb = await import('../app/plant-browser')

    ;(mocks.getFavorites as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        canonical_name: 'Malus domestica',
        common_name: 'Apple',
        family: 'Rosaceae',
        edible: true,
        sun: 'full',
        soil: 'loam',
        height_m: 4,
        width_m: 3,
        is_favorite: true,
        extra: null,
      } as any,
    ])

    await plantDb.loadFavoriteItems()

    expect(plantDb.favoriteNames.value).toEqual(['Malus domestica'])
    expect(plantDb.favoriteItems.value).toHaveLength(1)
    expect(plantDb.favoriteItems.value[0]?.canonical_name).toBe('Malus domestica')
    expect(plantDb.favoriteItemsLoading.value).toBe(false)
  })

  it('ignores stale favorite-item responses after a locale switch', async () => {
    const plantDb = await import('../app/plant-browser')
    const appState = await import('../app/settings/state')
    const english = deferred<any[]>()
    const french = deferred<any[]>()

    ;(mocks.getFavorites as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(english.promise)
      .mockReturnValueOnce(french.promise)

    appState.locale.value = 'en'
    const first = plantDb.loadFavoriteItems()

    appState.locale.value = 'fr'
    const second = plantDb.loadFavoriteItems()

    english.resolve([
      { canonical_name: 'English Favorite', is_favorite: true } as any,
    ])
    await first

    expect(plantDb.favoriteItems.value).toEqual([])

    french.resolve([
      { canonical_name: 'French Favorite', is_favorite: true } as any,
    ])
    await second

    expect(plantDb.favoriteItems.value).toEqual([
      { canonical_name: 'French Favorite', is_favorite: true },
    ])
    expect(plantDb.favoriteNames.value).toEqual(['French Favorite'])
  })

  it('does not let a stale favorites reload overwrite an optimistic toggle', async () => {
    const plantDb = await import('../app/plant-browser')
    const pendingFavorites = deferred<any[]>()

    plantDb.searchResults.value = [
      {
        canonical_name: 'Malus domestica',
        common_name: 'Apple',
        is_favorite: true,
      } as any,
    ]
    plantDb.favoriteItems.value = [{ canonical_name: 'Malus domestica', is_favorite: true } as any]
    plantDb.favoriteNames.value = ['Malus domestica']

    ;(mocks.getFavorites as ReturnType<typeof vi.fn>).mockReturnValueOnce(pendingFavorites.promise)
    mocks.toggleFavorite.mockResolvedValueOnce(false)

    const refresh = plantDb.loadFavoriteItems()
    await plantDb.toggleFavoriteAction('Malus domestica')

    pendingFavorites.resolve([{ canonical_name: 'Stale Favorite', is_favorite: true } as any])
    await refresh

    expect(plantDb.favoriteItems.value).toEqual([])
    expect(plantDb.favoriteNames.value).toEqual([])
    expect(plantDb.searchResults.value[0]?.is_favorite).toBe(false)
    expect(plantDb.favoriteItemsLoading.value).toBe(false)
  })

  it('ignores stale sidebar list responses after a locale switch', async () => {
    const plantDb = await import('../app/plant-browser')
    const appState = await import('../app/settings/state')
    const englishFavorites = deferred<any[]>()
    const englishRecent = deferred<any[]>()
    const frenchFavorites = deferred<any[]>()
    const frenchRecent = deferred<any[]>()

    ;(mocks.getFavorites as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(englishFavorites.promise)
      .mockReturnValueOnce(frenchFavorites.promise)
    ;(mocks.getRecentlyViewed as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(englishRecent.promise)
      .mockReturnValueOnce(frenchRecent.promise)

    appState.locale.value = 'en'
    const first = plantDb.loadSidebarLists()

    appState.locale.value = 'fr'
    const second = plantDb.loadSidebarLists()

    englishFavorites.resolve([{ canonical_name: 'English Favorite' } as any])
    englishRecent.resolve([{ canonical_name: 'English Recent' } as any])
    await first

    expect(plantDb.favoriteNames.value).toEqual([])
    expect(plantDb.recentlyViewed.value).toEqual([])

    frenchFavorites.resolve([{ canonical_name: 'French Favorite' } as any])
    frenchRecent.resolve([{ canonical_name: 'French Recent' } as any])
    await second

    expect(plantDb.favoriteNames.value).toEqual(['French Favorite'])
    expect(plantDb.recentlyViewed.value).toEqual([
      { canonical_name: 'French Recent' },
    ])
  })
})
