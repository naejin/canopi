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
})
