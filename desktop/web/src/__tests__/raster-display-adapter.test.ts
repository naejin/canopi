import { describe, expect, it } from 'vitest'
import { createRasterDisplay, tileIsRelevant, type RasterDisplayLayer } from '../maplibre/raster-display/adapter'
import { RasterWorkerPool, type RasterWorkerLike } from '../maplibre/raster-display/pool'

/** Records the public LayerManager calls the adapter makes. */
class FakeLayerManager {
  static instances: FakeLayerManager[] = []
  readonly calls: string[] = []
  readonly layers: { id: string; loading: boolean; error: Error | null }[] = []
  destroyed = false
  constructor(readonly map: unknown, readonly options: unknown, readonly deps: Record<string, (...args: unknown[]) => Promise<unknown>>) {
    FakeLayerManager.instances.push(this)
  }
  on() {}
  getLayers() { return this.layers }
  getLayer(id: string) { return this.layers.find((layer) => layer.id === id) }
  async addRaster(url: string, options: { id: string }) {
    this.calls.push(`add ${options.id} ${url}`)
    this.layers.push({ id: options.id, loading: true, error: null })
    return options.id
  }
  removeRaster(id: string) {
    this.calls.push(`remove ${id}`)
    this.layers.splice(this.layers.findIndex((layer) => layer.id === id), 1)
  }
  setState(id: string, patch: Record<string, unknown>) { this.calls.push(`state ${id} ${Object.keys(patch).join(',')}`) }
  setBeforeId() {}
  reorder(id: string, index: number) { this.calls.push(`reorder ${id} ${index}`) }
  destroy() { this.destroyed = true }
}

class IdleLane implements RasterWorkerLike {
  onmessage = null
  onerror = null
  terminated = false
  postMessage() {}
  terminate() { this.terminated = true }
}

function setup() {
  FakeLayerManager.instances = []
  const lanes: IdleLane[] = []
  const pool = new RasterWorkerPool({ lanes: 1, budgetBytes: 1024, maxInFlightPerLane: 1, createWorker: () => { const lane = new IdleLane(); lanes.push(lane); return lane } })
  let release!: () => void
  const loaded = new Promise<void>((resolve) => { release = resolve })
  const display = createRasterDisplay({}, {
    pool,
    loadRasterModule: async () => { await loaded; return { LayerManager: FakeLayerManager } as never },
  })
  return { display, pool, lanes, release: async () => { release(); await loaded; await new Promise((r) => setTimeout(r, 0)) } }
}

function layer(id: string, overrides: Partial<RasterDisplayLayer> = {}): RasterDisplayLayer {
  return {
    id,
    name: id,
    assets: [{ url: `asset://localhost/${id}.tif`, bbox: [0, 0, 1, 1] }],
    bounds: [0, 0, 1, 1],
    opacity: 1,
    rescale: [0, 30],
    colormap: 'terrain',
    reversed: false,
    ...overrides,
  }
}

describe('Canopi raster display adapter', () => {
  it('selects the WASM engine and injects Canopi collaborators through the public deps', async () => {
    const { display, release } = setup()
    display.sync([layer('lidar-a-gen1')], 'scene')
    await release()
    const manager = FakeLayerManager.instances[0]!
    expect(manager.options).toEqual({ engine: 'cog-tiler-wasm' })
    await expect(manager.deps.computeAutoStats!()).rejects.toThrow('statistics come from the library')
    expect(manager.calls).toEqual(['add lidar-a-gen1 asset://localhost/lidar-a-gen1.tif'])
  })

  it('keeps opacity paint-only and replaces a layer whose generation changed', async () => {
    const { display, release } = setup()
    await release()
    display.sync([layer('lidar-a-gen1')], undefined)
    display.sync([layer('lidar-a-gen1', { opacity: 0.4 })], undefined)
    display.sync([layer('lidar-a-gen2', { opacity: 0.4 })], undefined)
    expect(FakeLayerManager.instances[0]!.calls).toEqual([
      'add lidar-a-gen1 asset://localhost/lidar-a-gen1.tif',
      'state lidar-a-gen1 opacity',
      'remove lidar-a-gen1',
      'add lidar-a-gen2 asset://localhost/lidar-a-gen2.tif',
    ])
  })

  it('renders a multi-source item as one ordered mosaic resolved in memory', async () => {
    const { display, release } = setup()
    await release()
    const item = layer('lidar-b-gen1', {
      assets: [
        { url: 'asset://localhost/top.tif', bbox: [0, 0, 1, 1] },
        { url: 'asset://localhost/bottom.tif', bbox: [0.5, 0, 1.5, 1] },
      ],
    })
    display.sync([item], undefined)
    const manager = FakeLayerManager.instances[0]!
    const url = manager.calls[0]!.split(' ')[2]!
    expect(url).toMatch(/\.json$/)
    const mosaic = await manager.deps.loadMosaic!(url) as { assets: { url: string }[] }
    expect(mosaic.assets.map((asset) => asset.url)).toEqual(['asset://localhost/top.tif', 'asset://localhost/bottom.tif'])
  })

  it('never builds a manager after disposal and releases its worker lanes', async () => {
    const { display, lanes, pool, release } = setup()
    display.sync([layer('lidar-a-gen1')], undefined)
    display.dispose()
    await release()
    expect(FakeLayerManager.instances).toHaveLength(0)
    expect(pool.laneCount).toBe(0)
    expect(lanes[0]!.terminated).toBe(true)
  })

  it('destroys the manager on disposal', async () => {
    const { display, release } = setup()
    await release()
    display.sync([layer('lidar-a-gen1')], undefined)
    display.dispose()
    expect(FakeLayerManager.instances[0]!.destroyed).toBe(true)
  })
})

describe('style readiness', () => {
  it('re-applies layers the engine deferred while basemap sources were still loading', async () => {
    FakeLayerManager.instances = []
    const listeners = new Map<string, Set<() => void>>()
    let loaded = false
    const present = new Set<string>()
    const map = {
      on: (type: string, listener: () => void) => { const set = listeners.get(type) ?? new Set(); set.add(listener); listeners.set(type, set) },
      off: (type: string, listener: () => void) => { listeners.get(type)?.delete(listener) },
      isStyleLoaded: () => loaded,
      getLayer: (id: string) => (present.has(id) ? { id } : undefined),
    }
    const emit = (type: string) => { for (const listener of [...(listeners.get(type) ?? [])]) listener() }
    const pool = new RasterWorkerPool({ lanes: 1, budgetBytes: 1024, maxInFlightPerLane: 1, createWorker: () => new IdleLane() })
    const display = createRasterDisplay(map, { pool, loadRasterModule: async () => ({ LayerManager: FakeLayerManager }) as never })
    await new Promise((resolve) => setTimeout(resolve, 0))
    display.sync([layer('lidar-a-gen1')], undefined)
    const manager = FakeLayerManager.instances[0]!
    // The engine gates its first map mutation on isStyleLoaded(), which stays
    // false while basemap tiles load, and then waits for a style event that
    // never comes. The adapter nudges it once the map settles.
    emit('sourcedata')
    expect(manager.calls.filter((call) => call.startsWith('state'))).toEqual([])
    loaded = true
    emit('idle')
    expect(manager.calls.filter((call) => call.startsWith('state'))).toEqual(['state lidar-a-gen1 '])
    present.add('lidar-a-gen1')
    emit('idle')
    expect(manager.calls.filter((call) => call.startsWith('state'))).toHaveLength(1)
    expect([...listeners.values()].every((set) => set.size === 0)).toBe(true)
    display.dispose()
  })
})

describe('tile relevance', () => {
  const map = {
    getZoom: () => 14.3,
    getBounds: () => ({ getWest: () => -0.44, getSouth: () => 48.29, getEast: () => -0.42, getNorth: () => 48.31 }),
  }
  it('keeps tiles over the viewport and drops tiles far away or at abandoned zooms', () => {
    // z14 tile containing (-0.43, 48.30)
    expect(tileIsRelevant(map, { z: 14, x: 8172, y: 5674 })).toBe(true)
    expect(tileIsRelevant(map, { z: 14, x: 8300, y: 5674 })).toBe(false)
    expect(tileIsRelevant(map, { z: 18, x: 130760, y: 90790 })).toBe(false)
  })
})
