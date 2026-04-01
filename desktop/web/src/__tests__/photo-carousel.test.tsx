import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSpeciesImages: vi.fn(),
  getCachedImagePath: vi.fn(),
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
}))

vi.mock('../ipc/species', () => ({
  getSpeciesImages: mocks.getSpeciesImages,
  getCachedImagePath: mocks.getCachedImagePath,
}))

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: mocks.convertFileSrc,
}))

import { PhotoCarousel } from '../components/plant-detail/PhotoCarousel'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function flushEffects() {
  await Promise.resolve()
  await Promise.resolve()
}

async function settleCarousel() {
  await flushEffects()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await flushEffects()
}

describe('PhotoCarousel', () => {
  let container: HTMLDivElement

  async function renderCarousel(canonicalName: string) {
    await act(async () => {
      render(<PhotoCarousel canonicalName={canonicalName} />, container)
    })
    await act(async () => {
      await settleCarousel()
    })
    await act(async () => {
      await settleCarousel()
    })
  }

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    mocks.getSpeciesImages.mockReset()
    mocks.getCachedImagePath.mockReset()
    mocks.convertFileSrc.mockClear()
    mocks.convertFileSrc.mockImplementation((path: string) => `asset://${path}`)
  })

  afterEach(() => {
    render(null, container)
    container.remove()
  })

  it('loads the current image through the cached file path and preloads the next image', async () => {
    mocks.getSpeciesImages.mockResolvedValue([
      { url: 'https://example.com/a.jpg', source: 'Example A' },
      { url: 'https://example.com/b.jpg', source: 'Example B' },
      { url: 'https://example.com/c.jpg', source: 'Example C' },
    ])
    mocks.getCachedImagePath.mockImplementation(async (url: string) => `/cache/${url.split('/').pop()}`)

    await renderCarousel('Lavandula angustifolia')

    const img = container.querySelector('img')
    expect(img?.getAttribute('src')).toBe('asset:///cache/a.jpg')
    expect(mocks.getCachedImagePath).toHaveBeenCalledWith('https://example.com/a.jpg')
    expect(mocks.getCachedImagePath).toHaveBeenCalledWith('https://example.com/b.jpg')
    expect(mocks.getCachedImagePath).toHaveBeenCalledTimes(2)
  })

  it('falls back to the remote image URL when cached path lookup fails', async () => {
    mocks.getSpeciesImages.mockResolvedValue([
      { url: 'https://example.com/fallback.jpg', source: 'Example' },
    ])
    mocks.getCachedImagePath.mockRejectedValue(new Error('cache failed'))

    await renderCarousel('Rosa canina')

    const img = container.querySelector('img')
    expect(img?.getAttribute('src')).toBe('https://example.com/fallback.jpg')
  })

  it('falls back to the remote image URL when the cached asset path fails to load', async () => {
    mocks.getSpeciesImages.mockResolvedValue([
      { url: 'https://example.com/asset-fallback.jpg', source: 'Example' },
    ])
    mocks.getCachedImagePath.mockResolvedValue('/cache/asset-fallback.jpg')

    await renderCarousel('Rosa canina')

    const img = container.querySelector<HTMLImageElement>('img')
    expect(img?.getAttribute('src')).toBe('asset:///cache/asset-fallback.jpg')

    await act(async () => {
      img?.dispatchEvent(new Event('error'))
      await settleCarousel()
    })

    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://example.com/asset-fallback.jpg')
  })

  it('shows the photo placeholder when both the asset and remote image loads fail', async () => {
    mocks.getSpeciesImages.mockResolvedValue([
      { url: 'https://example.com/missing.jpg', source: 'Example' },
    ])
    mocks.getCachedImagePath.mockResolvedValue('/cache/missing.jpg')

    await renderCarousel('Rosa canina')

    const assetImg = container.querySelector<HTMLImageElement>('img')
    expect(assetImg?.getAttribute('src')).toBe('asset:///cache/missing.jpg')

    await act(async () => {
      assetImg?.dispatchEvent(new Event('error'))
      await settleCarousel()
    })

    const remoteImg = container.querySelector<HTMLImageElement>('img')
    expect(remoteImg?.getAttribute('src')).toBe('https://example.com/missing.jpg')

    await act(async () => {
      remoteImg?.dispatchEvent(new Event('error'))
      await settleCarousel()
    })

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('ignores stale cached-path responses from the previously selected species', async () => {
    const firstImage = deferred<string>()
    mocks.getSpeciesImages.mockImplementation(async (canonicalName: string) => {
      if (canonicalName === 'Lavandula angustifolia') {
        return [{ url: 'https://example.com/lavender.jpg', source: 'Lavender' }]
      }
      return [{ url: 'https://example.com/thyme.jpg', source: 'Thyme' }]
    })
    mocks.getCachedImagePath.mockImplementation((url: string) => {
      if (url.endsWith('lavender.jpg')) {
        return firstImage.promise
      }
      return Promise.resolve('/cache/thyme.jpg')
    })

    await renderCarousel('Lavandula angustifolia')

    await renderCarousel('Thymus vulgaris')

    expect(container.querySelector('img')?.getAttribute('src')).toBe('asset:///cache/thyme.jpg')

    await act(async () => {
      firstImage.resolve('/cache/lavender.jpg')
      await settleCarousel()
    })

    expect(container.querySelector('img')?.getAttribute('src')).toBe('asset:///cache/thyme.jpg')
  })

  it('ignores stale cached-path responses from a previously requested slide in the same species', async () => {
    const firstImage = deferred<string>()
    mocks.getSpeciesImages.mockResolvedValue([
      { url: 'https://example.com/a.jpg', source: 'Example A' },
      { url: 'https://example.com/b.jpg', source: 'Example B' },
    ])
    let bCalls = 0
    mocks.getCachedImagePath.mockImplementation((url: string) => {
      if (url.endsWith('a.jpg')) {
        return firstImage.promise
      }
      bCalls += 1
      return Promise.resolve('/cache/b.jpg')
    })

    await renderCarousel('Lavandula angustifolia')

    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    await act(async () => {
      tabs[1]?.click()
      await settleCarousel()
    })
    await act(async () => {
      await settleCarousel()
    })

    expect(bCalls).toBeGreaterThan(0)
    expect(container.querySelector('img')?.getAttribute('src')).toBe('asset:///cache/b.jpg')

    await act(async () => {
      firstImage.resolve('/cache/a.jpg')
      await settleCarousel()
    })

    expect(container.querySelector('img')?.getAttribute('src')).toBe('asset:///cache/b.jpg')
  })
})
