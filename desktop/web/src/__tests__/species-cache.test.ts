import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSpeciesBatch: vi.fn(async () => []),
  getFlowerColorBatch: vi.fn(async () => []),
}))

vi.mock('../ipc/species', () => ({
  getSpeciesBatch: mocks.getSpeciesBatch,
  getFlowerColorBatch: mocks.getFlowerColorBatch,
}))

import { CanvasSpeciesCache } from '../canvas/runtime/species-cache'

describe('CanvasSpeciesCache', () => {
  beforeEach(() => {
    mocks.getSpeciesBatch.mockReset()
    mocks.getFlowerColorBatch.mockReset()
    mocks.getSpeciesBatch.mockResolvedValue([] as any)
    mocks.getFlowerColorBatch.mockResolvedValue([] as any)
  })

  it('loads missing entries once and stores resolved flower color fields', async () => {
    mocks.getSpeciesBatch.mockResolvedValueOnce([
      {
        canonical_name: 'Malus domestica',
        flower_color: 'White',
        family: 'Rosaceae',
      },
    ] as any)
    mocks.getFlowerColorBatch.mockResolvedValueOnce([
      {
        canonical_name: 'Malus domestica',
        flower_color: 'Pink',
        source: 'genus',
      },
    ] as any)

    const cache = new CanvasSpeciesCache()
    const loaded = await cache.ensureEntries(['Malus domestica'], 'en')

    expect(loaded).toBe(true)
    expect(mocks.getSpeciesBatch).toHaveBeenCalledWith(['Malus domestica'], 'en')
    expect(mocks.getFlowerColorBatch).toHaveBeenCalledWith(['Malus domestica'])
    expect(cache.getCache().get('Malus domestica')).toMatchObject({
      canonical_name: 'Malus domestica',
      flower_color: 'White',
      resolved_flower_color: 'Pink',
      resolved_flower_color_source: 'genus',
    })
    expect(cache.getSuggestedPlantColor('Malus domestica')).toBe('#C25B82')
  })

  it('skips fetches when all requested entries are already cached', async () => {
    const cache = new CanvasSpeciesCache()
    mocks.getSpeciesBatch.mockResolvedValueOnce([{ canonical_name: 'Malus domestica' }] as any)

    await cache.ensureEntries(['Malus domestica'], 'en')
    const loaded = await cache.ensureEntries(['Malus domestica', 'Malus domestica'], 'en')

    expect(loaded).toBe(false)
    expect(mocks.getSpeciesBatch).toHaveBeenCalledTimes(1)
    expect(mocks.getFlowerColorBatch).toHaveBeenCalledTimes(1)
  })

  it('loads only uncached visible plant entries from the layer', async () => {
    const cache = new CanvasSpeciesCache()
    await cache.ensureEntries(['Malus domestica'], 'en')

    mocks.getSpeciesBatch.mockResolvedValueOnce([{ canonical_name: 'Pyrus communis' }] as any)

    const plantsLayer = {
      find: vi.fn(() => [
        { getAttr: vi.fn(() => 'Malus domestica') },
        { getAttr: vi.fn(() => 'Pyrus communis') },
        { getAttr: vi.fn(() => 'Pyrus communis') },
      ]),
    } as any

    const loaded = await cache.loadVisiblePlantEntries(plantsLayer, 'fr')

    expect(loaded).toBe(true)
    expect(mocks.getSpeciesBatch).toHaveBeenLastCalledWith(['Pyrus communis'], 'fr')
    expect(mocks.getFlowerColorBatch).toHaveBeenLastCalledWith(['Pyrus communis'])
  })
})
