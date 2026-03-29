import { beforeEach, describe, expect, it, vi } from 'vitest'

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
})
