import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPlantMediaController } from '../app/plant-detail'

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

describe('plant media controller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('loads cached asset urls and prewarms adjacent images', async () => {
    const loadImages = vi.fn().mockResolvedValue([
      { url: 'https://example.com/a.jpg', source: 'Example A' },
      { url: 'https://example.com/b.jpg', source: 'Example B' },
    ])
    const loadCachedImagePath = vi.fn().mockImplementation(async (url: string) => `/cache/${url.split('/').pop()}`)
    const toAssetUrl = vi.fn((path: string) => `asset://${path}`)
    const controller = createPlantMediaController({ loadImages, loadCachedImagePath, toAssetUrl })

    controller.setCanonicalName('Lavandula angustifolia')
    await flushMicrotasks()

    expect(controller.loading.value).toBe(false)
    expect(controller.loadedSrc.value).toBe('asset:///cache/a.jpg')
    expect(loadCachedImagePath).toHaveBeenCalledWith('https://example.com/a.jpg')
    expect(loadCachedImagePath).toHaveBeenCalledWith('https://example.com/b.jpg')
  })

  it('falls back to the remote image url and ignores stale cache-path responses', async () => {
    const firstImage = createDeferred<string>()
    const loadImages = vi.fn()
      .mockResolvedValueOnce([{ url: 'https://example.com/a.jpg', source: 'Example A' }])
      .mockResolvedValueOnce([{ url: 'https://example.com/b.jpg', source: 'Example B' }])
    const loadCachedImagePath = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('a.jpg')) return firstImage.promise
      return Promise.reject(new Error('cache miss'))
    })
    const controller = createPlantMediaController({ loadImages, loadCachedImagePath, toAssetUrl: (path) => `asset://${path}` })

    controller.setCanonicalName('Lavandula angustifolia')
    await flushMicrotasks()

    controller.setCanonicalName('Thymus vulgaris')
    await flushMicrotasks()

    expect(controller.loadedSrc.value).toBe('https://example.com/b.jpg')

    firstImage.resolve('/cache/a.jpg')
    await flushMicrotasks()

    expect(controller.loadedSrc.value).toBe('https://example.com/b.jpg')
  })

  it('switches from cached asset to remote url and then to placeholder on image errors', async () => {
    const loadImages = vi.fn().mockResolvedValue([
      { url: 'https://example.com/a.jpg', source: 'Example A' },
    ])
    const loadCachedImagePath = vi.fn().mockResolvedValue('/cache/a.jpg')
    const controller = createPlantMediaController({
      loadImages,
      loadCachedImagePath,
      toAssetUrl: (path) => `asset://${path}`,
    })

    controller.setCanonicalName('Lavandula angustifolia')
    await flushMicrotasks()

    expect(controller.loadedSrc.value).toBe('asset:///cache/a.jpg')

    controller.handleImageError()
    expect(controller.loadedSrc.value).toBe('https://example.com/a.jpg')
    expect(controller.loadFailed.value).toBe(false)

    controller.handleImageError()
    expect(controller.loadedSrc.value).toBe(null)
    expect(controller.loadFailed.value).toBe(true)
  })
})
