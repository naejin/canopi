import { describe, expect, it, vi } from 'vitest'
import { createDefaultScenePersistedState } from '../../canvas/runtime/scene'
import type { MapLibreApi, MapLibreMapInstance } from '../../maplibre/loader'
import type { MapLibreCanvasSurfaceState } from '../../maplibre/canvas-surface-state'
import type { TerrainProtocolSupport } from '../../maplibre/terrain'
import { WorkspaceMapContributions } from './workspace-map-contributions'
import type { WorkspaceMapContributionSnapshot } from './workspace-map-contribution-adapter'
import type { RasterDisplay, RasterDisplayLayer } from '../../maplibre/raster-display/adapter'

class ContributionMap implements MapLibreMapInstance {
  readonly sources = new Map<string, { setData(data: unknown): void }>()
  readonly order: string[] = ['basemap-background', 'basemap-raster', 'canopi-shared-scene']
  readonly listeners = new Map<string, Set<() => void>>()
  readonly jumpTo = vi.fn()
  readonly resize = vi.fn()
  readonly remove = vi.fn()
  readonly addSource = vi.fn((id: string, _source: Record<string, unknown>) => { this.sources.set(id, { setData: vi.fn() }) })
  readonly getSource = vi.fn((id: string) => this.sources.get(id))
  readonly removeSource = vi.fn((id: string) => { this.sources.delete(id) })
  readonly addLayer = vi.fn((layer: Record<string, unknown>) => { this.order.push(String(layer.id)) })
  readonly getLayer = vi.fn((id: string) => this.order.includes(id) ? { id } : undefined)
  readonly removeLayer = vi.fn((id: string) => { const i = this.order.indexOf(id); if (i >= 0) this.order.splice(i, 1) })
  readonly getLayersOrder = vi.fn(() => [...this.order])
  readonly moveLayer = vi.fn((id: string, before?: string) => {
    const i = this.order.indexOf(id)
    if (i < 0) return
    this.order.splice(i, 1)
    const target = before ? this.order.indexOf(before) : -1
    this.order.splice(target < 0 ? this.order.length : target, 0, id)
  })
  readonly setPaintProperty = vi.fn()
  readonly getBounds = () => ({ getWest: () => 1, getSouth: () => 2, getEast: () => 3, getNorth: () => 4 })
  on(type: string, listener: () => void) { const listeners = this.listeners.get(type) ?? new Set(); listeners.add(listener); this.listeners.set(type, listeners) }
  off(type: string, listener: () => void) { this.listeners.get(type)?.delete(listener) }
}

const terrainSupport: TerrainProtocolSupport = {
  sharedDemProtocolUrl: 'dem://tiles', contourProtocolUrl: () => 'contour://tiles',
}

function layer(id = 'lidar-a', overrides: Partial<RasterDisplayLayer> = {}): RasterDisplayLayer {
  return { id, name: id, opacity: 1, assets: [{ url: `asset://localhost/${id}.tif`, bbox: [1, 2, 3, 4] }], bounds: [1, 2, 3, 4], rescale: [0, 10], colormap: 'terrain', reversed: false, ...overrides }
}

/** Records what the contributions ask of the renderer; adds map layers on demand like the engine. */
class FakeRasterDisplay implements RasterDisplay {
  readonly syncs: { ids: string[]; beforeId: string | undefined }[] = []
  disposed = false
  disposeCalls = 0
  added: string[] = []
  syncError: Error | null = null
  constructor(readonly map: ContributionMap, readonly onLayersChanged: () => void) {}
  sync(layers: readonly RasterDisplayLayer[], beforeId: string | undefined) {
    if (this.syncError) throw this.syncError
    this.syncs.push({ ids: layers.map((candidate) => candidate.id), beforeId })
  }
  /** Simulate the engine adding a layer after its header loaded (drawn on top). */
  arrive(id: string) {
    this.map.order.push(id)
    this.added.push(id)
    this.onLayersChanged()
  }
  layerIds() { return this.added.filter((id) => this.map.order.includes(id)) }
  state() { return undefined }
  dispose() { this.disposed = true; this.disposeCalls += 1 }
}

function snapshot(identity: object, overrides: Partial<WorkspaceMapContributionSnapshot> = {}): WorkspaceMapContributionSnapshot {
  const scene = createDefaultScenePersistedState()
  scene.zones = [{ kind: 'zone', locked: false, name: 'plot', zoneType: 'polygon', rotationDeg: 0, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], fillColor: null, notes: null }]
  return {
    sessionIdentity: identity,
    lidar: [layer()],
    terrain: { contourIntervalMeters: 1, contoursVisible: false, contoursOpacity: 1, hillshadeVisible: false, hillshadeOpacity: 1, isDark: false },
    overlays: { runtime: { getSceneSnapshot: () => scene }, location: { lat: 48, lon: 2 }, hoveredTargets: [{ kind: 'zone', zone_name: 'plot' }], selectedTargets: [] },
    frame: null,
    ...overrides,
  }
}

function fixture(loadTerrainSupport = vi.fn(async () => terrainSupport)) {
  const identity = {}
  const map = new ContributionMap()
  const states: MapLibreCanvasSurfaceState[] = []
  const bounds = vi.fn()
  const diagnostics = vi.fn()
  const logError = vi.fn()
  const failure = vi.fn()
  let active = true
  let raster!: FakeRasterDisplay
  const manager = new WorkspaceMapContributions({
    sessionIdentity: identity, onFailure: failure, loadTerrainSupport, onStateChange: (state) => states.push(state), publishViewBounds: bounds, publishDiagnostics: diagnostics, logError,
    createRasterDisplay: (_map, options) => { raster = new FakeRasterDisplay(map, options.onLayersChanged!); return raster },
  })
  manager.attach({ key: 'test', map, maplibre: {} as MapLibreApi, preservedViewState: null, lifetime: { on() {}, addCleanup() {}, clear() {} }, isCurrent: () => active })
  return { identity, map, states, failure, bounds, diagnostics, manager, loadTerrainSupport, logError, raster, expire: () => { active = false } }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function flush() { await Promise.resolve(); await Promise.resolve() }

describe('WorkspaceMapContributions', () => {
  it.each([
    ['rebuild', 'removeLayer'], ['rebuild', 'removeSource'],
    ['source error', 'removeLayer'], ['source error', 'removeSource'],
  ] as const)('fails hard when terrain %s rollback cannot %s', async (reason, removeMethod) => {
    const f = fixture()
    const input = snapshot(f.identity, { terrain: { ...snapshot(f.identity).terrain, hillshadeVisible: true } })
    f.manager.update(input)
    if (reason === 'source error') {
      f.manager.restoreStyle()
      await flush()
    } else {
      const add = f.map.addLayer.getMockImplementation()!
      f.map.addLayer.mockImplementation((candidate) => {
        add(candidate)
        if (candidate.id === 'hillshade-layer') throw new Error('partial terrain add')
      })
    }
    const cleanup = new Error(`terrain ${removeMethod} failed`)
    const remove = f.map[removeMethod].getMockImplementation()!
    f.map[removeMethod].mockImplementation((id) => {
      if (id === 'hillshade-layer' || id === 'terrain-dem') throw cleanup
      remove(id)
    })
    if (reason === 'rebuild') f.manager.restoreStyle()
    else f.manager.handleSourceError({ sourceId: 'terrain-dem', error: new Error('terrain tile failed') })
    await flush()
    expect(f.failure).toHaveBeenCalledExactlyOnceWith(cleanup)
    expect(f.states.at(-1)).toMatchObject({ status: 'error', errorMessage: cleanup.message, terrainStatus: 'idle' })
    const mutations = f.map.addSource.mock.calls.length
    f.manager.update(input)
    f.manager.restoreStyle()
    await flush()
    expect(f.map.addSource).toHaveBeenCalledTimes(mutations)
    expect(f.failure).toHaveBeenCalledOnce()
  })

  it.each([
    ['overlay', 'initial'], ['overlay', 'live'], ['overlay', 'reload'],
    ['order', 'initial'], ['order', 'live'], ['order', 'reload'],
  ] as const)('fails once for %s failure during %s work and fences subsequent updates', (kind, phase) => {
    const f = fixture()
    const input = snapshot(f.identity)
    // The renderer already drew its layer on top; the band must be reordered.
    f.raster.added.push('lidar-a')
    f.map.order.push('lidar-a')
    f.manager.update(input)
    if (phase !== 'initial') f.manager.restoreStyle()
    if (phase === 'reload') {
      f.map.sources.clear()
      f.map.order.splice(0, f.map.order.length, 'canopi-shared-scene', 'lidar-a')
    }
    const error = new Error(`${kind} failed`)
    if (kind === 'overlay') {
      const add = f.map.addLayer.getMockImplementation()!
      f.map.addLayer.mockImplementation((layer) => {
        if (String(layer.id).startsWith('panel-target-')) throw error
        add(layer)
      })
      const overlay = f.map.order.indexOf('panel-target-hover-zones-fill')
      if (overlay >= 0) f.map.order.splice(overlay, 1)
    } else {
      f.map.moveLayer.mockImplementation(() => { throw error })
      if (phase === 'live') f.map.order.reverse()
    }
    if (phase === 'live') f.manager.update(input)
    else f.manager.restoreStyle()
    expect(f.failure).toHaveBeenCalledExactlyOnceWith(error)
    expect(f.states.at(-1)).toMatchObject({ status: 'error', errorMessage: error.message, terrainStatus: 'idle' })
    expect(f.map.sources.size).toBe(0)
    const mutations = f.map.addSource.mock.calls.length
    f.manager.update(input)
    f.manager.restoreStyle()
    f.manager.dispose()
    expect(f.failure).toHaveBeenCalledOnce()
    expect(f.map.addSource).toHaveBeenCalledTimes(mutations)
    expect(f.states.at(-1)?.status).toBe('error')
  })

  it('treats ordering after an async terrain rebuild as a hard failure', async () => {
    const pending = deferred<TerrainProtocolSupport>()
    const f = fixture(vi.fn(() => pending.promise))
    f.manager.update(snapshot(f.identity, { terrain: { ...snapshot(f.identity).terrain, hillshadeVisible: true } }))
    f.manager.restoreStyle()
    const error = new Error('terrain ordering failed')
    f.map.moveLayer.mockImplementation(() => { throw error })
    pending.resolve(terrainSupport)
    await flush()
    expect(f.failure).toHaveBeenCalledExactlyOnceWith(error)
    expect(f.states.at(-1)).toMatchObject({ status: 'error', errorMessage: error.message, terrainStatus: 'idle' })
  })

  it('keeps terrain source construction failures passive', async () => {
    const f = fixture()
    const add = f.map.addSource.getMockImplementation()!
    f.map.addSource.mockImplementation((id, source) => {
      if (id === 'terrain-dem') throw new Error('terrain source failed')
      add(id, source)
    })
    f.manager.update(snapshot(f.identity, { terrain: { ...snapshot(f.identity).terrain, hillshadeVisible: true } }))
    f.manager.restoreStyle()
    await flush()
    expect(f.failure).not.toHaveBeenCalled()
    expect(f.states.at(-1)).toMatchObject({ status: 'ready', terrainStatus: 'error' })
  })

  it('hands the latest immutable band to the renderer only once the style is ready, beneath the scene', () => {
    const f = fixture()
    f.manager.update(snapshot(f.identity, { lidar: [layer('lidar-b'), layer('lidar-a')] }))
    expect(f.raster.syncs).toEqual([])
    f.manager.restoreStyle()
    expect(f.raster.syncs.at(-1)).toEqual({ ids: ['lidar-b', 'lidar-a'], beforeId: 'canopi-shared-scene' })
    expect(f.states.at(-1)?.status).toBe('ready')
    expect(f.bounds).toHaveBeenLastCalledWith([1, 2, 3, 4])
  })

  it('reorders renderer layers that arrive asynchronously into the band below the scene', () => {
    const f = fixture()
    f.manager.update(snapshot(f.identity, { lidar: [layer('lidar-b'), layer('lidar-a')] }))
    f.manager.restoreStyle()
    f.raster.arrive('lidar-a')
    f.raster.arrive('lidar-b')
    expect(f.map.order.indexOf('basemap-raster')).toBeLessThan(f.map.order.indexOf('lidar-b'))
    expect(f.map.order.indexOf('lidar-b')).toBeLessThan(f.map.order.indexOf('lidar-a'))
    expect(f.map.order.indexOf('lidar-a')).toBeLessThan(f.map.order.indexOf('canopi-shared-scene'))
    expect(f.map.order.indexOf('canopi-shared-scene')).toBeLessThan(f.map.order.indexOf('panel-target-hover-zones-fill'))
    // A style reload hands the same band over again and restores its order.
    f.map.order.splice(0, f.map.order.length, 'canopi-shared-scene', 'lidar-a', 'lidar-b')
    f.manager.restoreStyle()
    expect(f.map.order.indexOf('lidar-b')).toBeLessThan(f.map.order.indexOf('canopi-shared-scene'))
    expect(f.map.order.indexOf('lidar-a')).toBeLessThan(f.map.order.indexOf('canopi-shared-scene'))
    expect(f.failure).not.toHaveBeenCalled()
  })

  it('treats ordering failure after an asynchronous renderer change as a hard failure', () => {
    const f = fixture()
    f.manager.update(snapshot(f.identity))
    f.manager.restoreStyle()
    const error = new Error('raster ordering failed')
    f.map.moveLayer.mockImplementation(() => { throw error })
    f.raster.arrive('lidar-a')
    expect(f.failure).toHaveBeenCalledExactlyOnceWith(error)
    expect(f.raster.disposed).toBe(true)
  })

  it('keeps a renderer failure passive for editing and the other contributions', () => {
    const f = fixture()
    f.raster.syncError = new Error('renderer rejected the band')
    f.manager.update(snapshot(f.identity))
    f.manager.restoreStyle()
    expect(f.failure).not.toHaveBeenCalled()
    expect(f.states.at(-1)?.status).toBe('ready')
    expect(f.map.getLayer('panel-target-hover-zones-fill')).toBeTruthy()
    expect(f.logError).toHaveBeenCalled()
    expect(f.manager.handleSourceError({ sourceId: 'mlrcog0-src-lidar-a', error: new Error('tile') })).toBe(true)
    expect(f.failure).not.toHaveBeenCalled()
  })

  it('clears the band for a disconnected Design and ignores the renderer after disposal', () => {
    const f = fixture()
    f.manager.update(snapshot(f.identity))
    f.manager.restoreStyle()
    f.manager.update(null)
    expect(f.raster.syncs.at(-1)?.ids).toEqual([])
    f.manager.dispose()
    f.manager.dispose()
    expect(f.raster.disposeCalls).toBe(1)
    f.map.moveLayer.mockClear()
    f.raster.arrive('lidar-late')
    expect(f.map.moveLayer).not.toHaveBeenCalled()
  })

  it('latest terrain and style generation win when async loads settle out of order', async () => {
    const first = deferred<TerrainProtocolSupport>()
    const second = deferred<TerrainProtocolSupport>()
    const third = deferred<TerrainProtocolSupport>()
    const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise)
    const f = fixture(load)
    const enabled = { ...snapshot(f.identity).terrain, contoursVisible: true }
    f.manager.update(snapshot(f.identity, { terrain: enabled }))
    f.manager.restoreStyle()
    f.map.sources.clear(); f.map.order.length = 0
    f.manager.update(snapshot(f.identity, { terrain: { ...enabled, contourIntervalMeters: 10 } }))
    f.manager.restoreStyle()
    third.resolve(terrainSupport)
    await flush()
    const sourceCount = f.map.addSource.mock.calls.length
    first.resolve(terrainSupport)
    second.resolve(terrainSupport)
    await flush()
    expect(f.map.addSource).toHaveBeenCalledTimes(sourceCount)
    expect(f.states.at(-1)?.terrainStatus).toBe('ready')
  })

  it.each(['null', 'disposed', 'expired'] as const)('fences pending terrain after %s and rejects another session', async (reason) => {
    const pending = deferred<TerrainProtocolSupport>()
    const f = fixture(vi.fn(() => pending.promise))
    f.manager.update(snapshot(f.identity, { terrain: { ...snapshot(f.identity).terrain, hillshadeVisible: true } }))
    f.manager.restoreStyle()
    if (reason === 'null') f.manager.update(null)
    else if (reason === 'disposed') f.manager.dispose()
    else f.expire()
    f.map.addSource.mockClear()
    f.manager.update(snapshot({}))
    pending.resolve(terrainSupport)
    await flush()
    expect(f.map.addSource).not.toHaveBeenCalled()
  })

  it('fences reentrant disposal during a source mutation before another layer can be added', () => {
    const f = fixture()
    f.manager.update(snapshot(f.identity))
    f.map.addSource.mockImplementationOnce((id) => {
      f.map.sources.set(id, { setData: vi.fn() })
      f.manager.dispose()
    })
    f.manager.restoreStyle()
    expect(f.map.addLayer).not.toHaveBeenCalled()
    expect(f.map.sources.size).toBe(0)
    expect(f.states.at(-1)?.status).toBe('idle')
  })

  it('clears partial terrain if a source mutation synchronously disables terrain', async () => {
    const f = fixture()
    const original = f.map.addSource.getMockImplementation()!
    f.map.addSource.mockImplementation((id, source) => {
      original(id, source)
      if (id === 'terrain-dem') f.manager.update(snapshot(f.identity))
    })
    f.manager.update(snapshot(f.identity, { terrain: { ...snapshot(f.identity).terrain, hillshadeVisible: true } }))
    f.manager.restoreStyle()
    await flush()
    expect(f.map.getSource('terrain-dem')).toBeUndefined()
    expect(f.map.getLayer('hillshade-layer')).toBeUndefined()
    expect(f.states.at(-1)?.terrainStatus).toBe('idle')
  })

  it('publishes terrain failure without disabling editing or other contributions', async () => {
    const f = fixture(vi.fn(async () => { throw new Error('terrain offline') }))
    f.manager.update(snapshot(f.identity, { terrain: { ...snapshot(f.identity).terrain, hillshadeVisible: true } }))
    f.manager.restoreStyle()
    await flush()
    expect(f.states.at(-1)).toMatchObject({ status: 'ready', terrainStatus: 'error', terrainErrorMessage: 'terrain offline' })
    expect(f.raster.syncs.at(-1)?.ids).toEqual(['lidar-a'])
    expect(f.map.getLayer('panel-target-hover-zones-fill')).toBeTruthy()
  })

  it('ignores delayed source errors after contributions are disconnected', () => {
    const f = fixture()
    f.manager.update(snapshot(f.identity))
    f.manager.restoreStyle()
    f.manager.update(null)
    const published = f.states.length
    expect(f.manager.handleSourceError({ sourceId: 'mlrcog0-src-lidar-a' })).toBe(true)
    expect(f.manager.handleSourceError({ sourceId: 'terrain-dem' })).toBe(true)
    expect(f.states).toHaveLength(published)
    expect(f.states.at(-1)?.status).toBe('idle')
  })

  it('disposes overlays, terrain, rasters, listeners, bounds and diagnostics once with idle state', async () => {
    const f = fixture()
    f.manager.update(snapshot(f.identity, { terrain: { ...snapshot(f.identity).terrain, hillshadeVisible: true } }))
    f.manager.restoreStyle()
    await flush()
    expect(f.states.at(-1)?.status).toBe('ready')
    f.manager.dispose()
    const mutations = f.map.removeSource.mock.calls.length
    f.manager.dispose()
    f.manager.restoreStyle()
    f.manager.update(snapshot(f.identity))
    expect(f.map.removeSource).toHaveBeenCalledTimes(mutations)
    expect(f.map.sources.size).toBe(0)
    expect([...f.map.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true)
    expect(f.bounds).toHaveBeenLastCalledWith(null)
    expect(f.diagnostics).toHaveBeenLastCalledWith(null)
    expect(f.states.at(-1)).toEqual({ status: 'idle', errorMessage: null, terrainStatus: 'idle', terrainErrorMessage: null })
  })
})
