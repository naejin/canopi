import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPlantDetailController } from '../app/plant-detail'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function createDetail(canonicalName: string, commonName: string | null = null) {
  return {
    canonical_name: canonicalName,
    common_name: commonName,
    uses: [],
    relationships: [],
  } as unknown as import('../types/species').SpeciesDetail
}

describe('plant detail controller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('loads detail and locale common names for the current target', async () => {
    const loadDetail = vi.fn().mockResolvedValue(createDetail('Lavandula angustifolia', 'Lavender'))
    const loadLocaleCommonNames = vi.fn().mockResolvedValue([{ name: 'Lavande', locale: 'fr' }])
    const controller = createPlantDetailController({ loadDetail, loadLocaleCommonNames })

    controller.setTarget('Lavandula angustifolia', 'fr')
    await flushMicrotasks()

    expect(loadDetail).toHaveBeenCalledWith('Lavandula angustifolia', 'fr')
    expect(loadLocaleCommonNames).toHaveBeenCalledWith('Lavandula angustifolia', 'fr')
    expect(controller.loadState.value).toBe('loaded')
    expect(controller.detail.value?.canonical_name).toBe('Lavandula angustifolia')
    expect(controller.secondaryNames.value).toEqual([{ name: 'Lavande', locale: 'fr' }])
  })

  it('ignores stale detail responses after the target changes', async () => {
    const firstDetail = createDeferred<import('../types/species').SpeciesDetail>()
    const secondDetail = createDeferred<import('../types/species').SpeciesDetail>()
    const loadDetail = vi.fn()
      .mockReturnValueOnce(firstDetail.promise)
      .mockReturnValueOnce(secondDetail.promise)
    const loadLocaleCommonNames = vi.fn().mockResolvedValue([])
    const controller = createPlantDetailController({ loadDetail, loadLocaleCommonNames })

    controller.setTarget('Lavandula angustifolia', 'en')
    controller.setTarget('Thymus vulgaris', 'en')

    secondDetail.resolve(createDetail('Thymus vulgaris', 'Thyme'))
    await flushMicrotasks()
    expect(controller.detail.value?.canonical_name).toBe('Thymus vulgaris')

    firstDetail.resolve(createDetail('Lavandula angustifolia', 'Lavender'))
    await flushMicrotasks()
    expect(controller.detail.value?.canonical_name).toBe('Thymus vulgaris')
  })

  it('allows retry after an error and treats locale-common-name failure as optional', async () => {
    const loadDetail = vi.fn()
      .mockRejectedValueOnce(new Error('detail failed'))
      .mockResolvedValueOnce(createDetail('Lavandula angustifolia', 'Lavender'))
    const loadLocaleCommonNames = vi.fn()
      .mockRejectedValueOnce(new Error('names failed'))
      .mockResolvedValueOnce([{ name: 'Lavande', locale: 'fr' }])
    const controller = createPlantDetailController({ loadDetail, loadLocaleCommonNames })

    controller.setTarget('Lavandula angustifolia', 'fr')
    await flushMicrotasks()

    expect(controller.loadState.value).toBe('error')
    expect(controller.errorMessage.value).toContain('detail failed')

    controller.retry()
    await flushMicrotasks()

    expect(controller.loadState.value).toBe('loaded')
    expect(controller.detail.value?.canonical_name).toBe('Lavandula angustifolia')
    expect(controller.secondaryNames.value).toEqual([{ name: 'Lavande', locale: 'fr' }])
  })
})
