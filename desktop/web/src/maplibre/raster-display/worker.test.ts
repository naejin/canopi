import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RasterWorkerReply, RasterWorkerRequest } from './protocol'

const cogTiler = vi.hoisted(() => ({
  init: vi.fn(async () => undefined),
  openCog: vi.fn(),
  rgbaToPng: vi.fn(),
}))
vi.mock('cog-tiler-wasm', () => cogTiler)

function openedSource(mode: '3857' | 'warp') {
  return {
    boundsLonLat: [4.3, 51.9, 4.4, 52.0],
    levels: [{ width: 256, height: 256 }],
    mode,
    crsLabel: mode === '3857' ? 'EPSG:3857' : 'EPSG:28992',
    hasPalette: false,
    tileCache: new Map(),
  }
}

/** Loads the real worker module against a fake dedicated-worker scope and returns a request/reply function. */
async function lane() {
  const replies: RasterWorkerReply[] = []
  const scope: {
    onmessage: ((event: MessageEvent<RasterWorkerRequest>) => void) | null
    postMessage(message: RasterWorkerReply): void
  } = { onmessage: null, postMessage: (message) => replies.push(message) }
  vi.stubGlobal('self', scope)
  vi.resetModules()
  await import('./worker')
  let nextId = 0
  return async (request: Omit<Extract<RasterWorkerRequest, { op: 'open' }>, 'id'>) => {
    const id = ++nextId
    scope.onmessage?.({ data: { ...request, id } } as MessageEvent<RasterWorkerRequest>)
    await vi.waitFor(() => expect(replies.some((reply) => reply.id === id)).toBe(true))
    return replies.find((reply) => reply.id === id)!
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  cogTiler.openCog.mockReset()
})

describe('raster display worker', () => {
  it('refuses a source cog-tiler would warp, naming the mode and the one supported display CRS', async () => {
    cogTiler.openCog.mockResolvedValue(openedSource('warp'))
    const request = await lane()
    const reply = await request({ op: 'open', handle: 1, url: 'asset://display.tif' })
    expect(reply).toEqual({
      id: 1,
      ok: false,
      error: "raster display source opened in mode 'warp' (EPSG:28992); display tiles must be EPSG:3857",
    })
  })

  it('opens an EPSG:3857 source with its metadata', async () => {
    cogTiler.openCog.mockResolvedValue(openedSource('3857'))
    const request = await lane()
    const reply = await request({ op: 'open', handle: 1, url: 'asset://display.tif' })
    expect(reply).toEqual({
      id: 1,
      ok: true,
      value: { boundsLonLat: [4.3, 51.9, 4.4, 52.0] },
    })
  })
})
