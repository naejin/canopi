import { describe, expect, it, vi } from 'vitest'
import {
  installRasterProtocol,
  resetRasterProtocolForTests,
  type RasterTileFetcher,
} from '../maplibre/raster-loader'
import type { MapLibreApi } from '../maplibre/loader'

type ProtocolHandler = (
  parameters: { url: string },
  abortController: AbortController,
) => Promise<{ data: ArrayBuffer }>

function harness() {
  resetRasterProtocolForTests()
  const handlers = new Map<string, ProtocolHandler>()
  const maplibre = {
    addProtocol: (id: string, handler: ProtocolHandler) => handlers.set(id, handler),
  } as unknown as Pick<MapLibreApi, 'addProtocol'>
  return { maplibre, handlers }
}

const TILE_URL = 'canopi-raster://tile/source/lyr-1/gen-1/elevation/14/8192/5461.png'

describe('raster protocol adapter', () => {
  it('forwards a parsed tile request and returns the encoded bytes', async () => {
    const { maplibre, handlers } = harness()
    const bytes = new Uint8Array([1, 2, 3]).buffer
    const fetchTile = vi.fn<RasterTileFetcher>(async () => bytes)
    installRasterProtocol(maplibre, fetchTile)

    const handler = handlers.get('canopi-raster')
    expect(handler).toBeDefined()
    const response = await handler!({ url: TILE_URL }, new AbortController())
    expect(response.data).toBe(bytes)
    expect(fetchTile).toHaveBeenCalledTimes(1)
    expect(fetchTile.mock.calls[0]?.[0]).toMatchObject({
      entityKind: 'source',
      entityId: 'lyr-1',
      generationId: 'gen-1',
      style: 'elevation',
      z: 14,
      x: 8192,
      y: 5461,
    })
  })

  it('installs once per loaded module', () => {
    const { maplibre, handlers } = harness()
    const fetchTile = vi.fn<RasterTileFetcher>(async () => new ArrayBuffer(0))
    installRasterProtocol(maplibre, fetchTile)
    const first = handlers.get('canopi-raster')
    installRasterProtocol(maplibre, fetchTile)
    expect(handlers.get('canopi-raster')).toBe(first)
  })

  it('refuses a URL that is not a raster tile request', async () => {
    const { maplibre, handlers } = harness()
    installRasterProtocol(maplibre, async () => new ArrayBuffer(0))
    await expect(
      handlers.get('canopi-raster')!(
        { url: 'canopi-raster://tile/plants/lyr-1/gen-1/elevation/1/2/3.png' },
        new AbortController(),
      ),
    ).rejects.toThrow(/Unsupported raster tile URL/)
  })

  it('surfaces an unavailable tile as a failed request, never as empty data', async () => {
    const { maplibre, handlers } = harness()
    installRasterProtocol(maplibre, async () => {
      throw new Error('generation is unreadable')
    })
    await expect(
      handlers.get('canopi-raster')!({ url: TILE_URL }, new AbortController()),
    ).rejects.toThrow('generation is unreadable')
  })

  it('discards an aborted request even when the answer arrives late', async () => {
    const { maplibre, handlers } = harness()
    let release: ((value: ArrayBuffer) => void) | undefined
    const fetchTile: RasterTileFetcher = (_request, signal) =>
      new Promise<ArrayBuffer>((resolve, reject) => {
        release = resolve
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
    installRasterProtocol(maplibre, fetchTile)

    const controller = new AbortController()
    const pending = handlers.get('canopi-raster')!({ url: TILE_URL }, controller)
    controller.abort()
    release?.(new Uint8Array([9]).buffer)
    await expect(pending).rejects.toThrow('aborted')
  })
})
