import { describe, expect, it, vi } from 'vitest'
import {
  createReplacementSuggestionsController,
  createTemplateAdaptationController,
} from '../app/adaptation'

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

describe('adaptation controller', () => {
  it('loads compatibility results and ignores stale responses', async () => {
    const first = createDeferred<Array<import('../app/adaptation').CompatibilityResult>>()
    const second = createDeferred<Array<import('../app/adaptation').CompatibilityResult>>()
    const loadCompatibility = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const controller = createTemplateAdaptationController({ loadCompatibility })

    controller.setRequest(['Malus domestica'], 7, 'en')
    controller.setRequest(['Pyrus communis'], 7, 'en')

    second.resolve([{
      species_id: '2',
      canonical_name: 'Pyrus communis',
      common_name: 'Pear',
      hardiness_min: 5,
      hardiness_max: 8,
      is_compatible: true,
      zone_diff: 0,
    }])
    await flushMicrotasks()

    first.resolve([{
      species_id: '1',
      canonical_name: 'Malus domestica',
      common_name: 'Apple',
      hardiness_min: 3,
      hardiness_max: 5,
      is_compatible: false,
      zone_diff: 2,
    }])
    await flushMicrotasks()

    expect(controller.results.value).toHaveLength(1)
    expect(controller.results.value[0]?.canonical_name).toBe('Pyrus communis')
    expect(controller.loading.value).toBe(false)
  })

  it('loads and toggles replacement suggestions through the app controller', async () => {
    const loadSuggestions = vi.fn().mockResolvedValue([
      {
        canonical_name: 'Pyrus communis',
        common_name: 'Pear',
        hardiness_min: 5,
        hardiness_max: 8,
        stratum: null,
        height_max_m: null,
      },
    ])
    const controller = createReplacementSuggestionsController({ loadSuggestions })

    await controller.toggle('Malus domestica', 7, 'en')

    expect(controller.expanded.value).toBe(true)
    expect(controller.replacements.value).toHaveLength(1)

    await controller.toggle('Malus domestica', 7, 'en')

    expect(controller.expanded.value).toBe(false)
  })
})
