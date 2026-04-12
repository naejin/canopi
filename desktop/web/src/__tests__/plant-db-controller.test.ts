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
    await import('../state/plant-db')
    expect(mocks.searchSpecies).not.toHaveBeenCalled()
  })

  it('starts searches on mount and stops after dispose', async () => {
    const plantDb = await import('../state/plant-db')
    const dispose = plantDb.mountPlantDbController()

    await flushMicrotasks()
    expect(mocks.searchSpecies).toHaveBeenCalledTimes(1)

    mocks.searchSpecies.mockClear()
    dispose()
    plantDb.sortField.value = 'Family'
    await flushMicrotasks()

    expect(mocks.searchSpecies).not.toHaveBeenCalled()
  })

  it('increments result-set revision on first-page searches but not pagination appends', async () => {
    const plantDb = await import('../state/plant-db')
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
    const plantDb = await import('../state/plant-db')
    const appState = await import('../state/app')
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
    const plantDb = await import('../state/plant-db')
    const appState = await import('../state/app')
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
    const plantDb = await import('../state/plant-db')
    const appState = await import('../state/app')
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
    const plantDb = await import('../state/plant-db')
    const appState = await import('../state/app')
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
    const plantDb = await import('../state/plant-db')
    const appState = await import('../state/app')
    vi.spyOn(console, 'error').mockImplementation(() => {})

    appState.locale.value = 'en'
    ;(mocks.getDynamicFilterOptions as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('backend exploded'))

    await plantDb.loadDynamicOptions(['habit'])

    expect(plantDb.dynamicOptionsErrors.value.en?.habit).toBe('backend exploded')
    expect(plantDb.dynamicOptionsPending.value.en?.habit).toBeUndefined()
  })

  it('preserves the first-page total estimate when loading more results', async () => {
    const plantDb = await import('../state/plant-db')

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
})
