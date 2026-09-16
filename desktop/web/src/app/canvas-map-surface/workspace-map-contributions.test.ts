import { describe, expect, it, vi } from 'vitest'
import { createDefaultScenePersistedState } from '../../canvas/runtime/scene'
import type { MapLibreApi, MapLibreMapInstance } from '../../maplibre/loader'
import type { MapLibreCanvasSurfaceState } from '../../maplibre/canvas-surface-state'
import type { TerrainProtocolSupport } from '../../maplibre/terrain'
import { WorkspaceMapContributions } from './workspace-map-contributions'
import type { WorkspaceMapContributionSnapshot } from './workspace-map-contribution-adapter'
import type { LidarMapLayer } from './lidar-sync'

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

function layer(id = 'lidar-a', overrides: Partial<LidarMapLayer> = {}): LidarMapLayer {
  return { id, name: id, visible: true, opacity: 1, urlTemplate: `${id}/{z}/{x}/{y}`, minZoom: 1, maxZoom: 18, bounds: [1, 2, 3, 4], ...overrides }
}

function snapshot(identity: object, overrides: Partial<WorkspaceMapContributionSnapshot> = {}): WorkspaceMapContributionSnapshot {
  const scene = createDefaultScenePersistedState()
  scene.zones = [{ kind: 'zone', locked: false, name: 'plot', zoneType: 'polygon', rotationDeg: 0, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], fillColor: null, notes: null }]
  return {
    sessionIdentity: identity,
    lidar: [layer()],
    terrain: { contourIntervalMeters: 1, contoursVisible: false, contoursOpacity: 1, hillshadeVisible: false, hillshadeOpacity: 1, isDark: false },
    overlays: { runtime: { getSceneSnapshot: () => scene }, location: { lat: 48, lon: 2 }, northBearingDeg: 0, hoveredTargets: [{ kind: 'zone', zone_name: 'plot' }], selectedTargets: [] },
    frame: null,
    designExtentMeters: 100,
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
  const manager = new WorkspaceMapContributions({ sessionIdentity: identity, onFailure: failure, loadTerrainSupport, onStateChange: (state) => states.push(state), publishViewBounds: bounds, publishDiagnostics: diagnostics, logError })
  manager.attach({ key: 'test', map, maplibre: {} as MapLibreApi, preservedViewState: null, lifetime: { on() {}, addCleanup() {}, clear() {} }, isCurrent: () => active })
  return { identity, map, states, failure, bounds, diagnostics, manager, loadTerrainSupport, logError, expire: () => { active = false } }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function flush() { await Promise.resolve(); await Promise.resolve() }

describe('WorkspaceMapContributions', () => {
  it.each(['removeLayer', 'removeSource'] as const)('fails hard when partial LiDAR add rollback cannot %s', (removeMethod) => {
    const f = fixture()
    f.manager.update(snapshot(f.identity))
    const add = f.map.addLayer.getMockImplementation()!
    f.map.addLayer.mockImplementation((candidate) => {
      add(candidate)
      if (candidate.id === 'lidar-a') throw new Error('partial LiDAR add')
    })
    const cleanup = new Error(`${removeMethod} failed`)
    f.map[removeMethod].mockImplementation(() => { throw cleanup })
    f.manager.restoreStyle()
    expect(f.failure).toHaveBeenCalledExactlyOnceWith(cleanup)
    expect(f.states.at(-1)).toMatchObject({ status: 'error', errorMessage: cleanup.message })
    const mutations = f.map.addSource.mock.calls.length
    f.manager.update(snapshot(f.identity))
    f.manager.restoreStyle()
    expect(f.map.addSource).toHaveBeenCalledTimes(mutations)
    expect(f.failure).toHaveBeenCalledOnce()
  })

  it.each(['source error', 'obsolete'] as const)('fails hard when %s LiDAR removal fails', (reason) => {
    const f = fixture()
    f.manager.update(snapshot(f.identity))
    f.manager.restoreStyle()
    const cleanup = new Error('LiDAR removal failed')
    f.map.removeSource.mockImplementation(() => { throw cleanup })
    if (reason === 'source error') f.manager.handleSourceError({ sourceId: 'lidar-a', error: new Error('tile failed') })
    else f.manager.update(snapshot(f.identity, { lidar: [] }))
    expect(f.failure).toHaveBeenCalledExactlyOnceWith(cleanup)
    expect(f.states.at(-1)).toMatchObject({ status: 'error', errorMessage: cleanup.message })
    const mutations = f.map.addSource.mock.calls.length
    f.manager.update(snapshot(f.identity))
    expect(f.map.addSource).toHaveBeenCalledTimes(mutations)
  })

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

  it('fences reentrant LiDAR rollback without reporting a hard failure', () => {
    const f = fixture()
    f.manager.update(snapshot(f.identity))
    const add = f.map.addLayer.getMockImplementation()!
    f.map.addLayer.mockImplementationOnce((candidate) => { add(candidate); throw new Error('partial add') })
    const remove = f.map.removeLayer.getMockImplementation()!
    f.map.removeLayer.mockImplementationOnce((id) => {
      remove(id)
      f.manager.update(snapshot(f.identity, { lidar: [] }))
    })
    f.manager.restoreStyle()
    expect(f.failure).not.toHaveBeenCalled()
    expect(f.map.getSource('lidar-a')).toBeUndefined()
    expect(f.states.at(-1)?.status).toBe('ready')
  })

  it.each([
    ['overlay', 'initial'], ['overlay', 'live'], ['overlay', 'reload'],
    ['order', 'initial'], ['order', 'live'], ['order', 'reload'],
  ] as const)('fails once for %s failure during %s work and fences subsequent updates', (kind, phase) => {
    const f = fixture()
    const input = snapshot(f.identity)
    f.manager.update(input)
    if (phase !== 'initial') f.manager.restoreStyle()
    if (phase === 'reload') {
      f.map.sources.clear()
      f.map.order.splice(0, f.map.order.length, 'canopi-shared-scene')
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

  it('admits latest immutable inputs on style readiness and reconstructs their semantic order', async () => {
    const f = fixture()
    const input = snapshot(f.identity, { lidar: [layer('lidar-b'), layer('lidar-a')] })
    f.manager.update(input)
    expect(f.map.addSource).not.toHaveBeenCalled()
    f.manager.restoreStyle()
    expect(f.map.order.indexOf('lidar-b')).toBeLessThan(f.map.order.indexOf('lidar-a'))
    expect(f.map.order.indexOf('lidar-a')).toBeLessThan(f.map.order.indexOf('canopi-shared-scene'))
    expect(f.map.order.indexOf('canopi-shared-scene')).toBeLessThan(f.map.order.indexOf('panel-target-hover-zones-fill'))
    expect(f.loadTerrainSupport).not.toHaveBeenCalled()
    f.map.sources.clear()
    f.map.order.splice(0, f.map.order.length, 'canopi-shared-scene')
    f.manager.restoreStyle()
    expect(f.map.getLayer('lidar-b')).toBeTruthy()
    expect(f.states.at(-1)?.status).toBe('ready')
    expect(f.bounds).toHaveBeenLastCalledWith([1, 2, 3, 4])
  })

  it('keeps opacity paint-only and rebuilds only the changed raster source', () => {
    const f = fixture()
    f.manager.update(snapshot(f.identity, { lidar: [layer(), layer('lidar-b')] }))
    f.manager.restoreStyle()
    f.map.addSource.mockClear(); f.map.removeSource.mockClear(); f.map.setPaintProperty.mockClear()
    f.manager.update(snapshot(f.identity, { lidar: [layer('lidar-b'), layer('lidar-a', { opacity: 0.2 })] }))
    expect(f.map.addSource).not.toHaveBeenCalled()
    expect(f.map.setPaintProperty).toHaveBeenCalledWith('lidar-a', 'raster-opacity', 0.2)
    f.manager.update(snapshot(f.identity, { lidar: [layer('lidar-a', { urlTemplate: 'new/{z}/{x}/{y}', opacity: 0.2 }), layer('lidar-b')] }))
    expect(f.map.addSource.mock.calls.map(([id]) => id)).toEqual(['lidar-a'])
    expect(f.map.removeSource.mock.calls.map(([id]) => id)).toEqual(['lidar-a'])
    expect(f.map.remove).not.toHaveBeenCalled()
  })

  it('coalesces reentrant updates and clears partially added obsolete sources', () => {
    const f = fixture()
    f.manager.update(snapshot(f.identity))
    f.map.addSource.mockImplementationOnce((id) => {
      f.map.sources.set(id, { setData: vi.fn() })
      f.manager.update(snapshot(f.identity, { lidar: [layer('lidar-new')] }))
    })
    f.manager.restoreStyle()
    expect(f.map.getSource('lidar-a')).toBeUndefined()
    expect(f.map.getLayer('lidar-new')).toBeTruthy()
    expect(f.states.at(-1)?.status).toBe('ready')
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

  it('omits only failed LiDAR, does not retry on opacity/target changes, and recovers on source replacement', () => {
    const f = fixture()
    f.manager.update(snapshot(f.identity, { lidar: [layer(), layer('lidar-b')] }))
    f.manager.restoreStyle()
    expect(f.manager.handleSourceError({ sourceId: 'lidar-a', error: new Error('tile') })).toBe(true)
    expect(f.map.getLayer('lidar-a')).toBeUndefined()
    expect(f.map.getLayer('lidar-b')).toBeTruthy()
    f.manager.update(snapshot(f.identity, { lidar: [layer('lidar-a', { opacity: 0.2 }), layer('lidar-b')] }))
    expect(f.map.getLayer('lidar-a')).toBeUndefined()
    expect(f.states.at(-1)?.status).toBe('ready')
    f.manager.update(snapshot(f.identity, { lidar: [layer('lidar-a', { urlTemplate: 'repaired' })] }))
    expect(f.map.getLayer('lidar-a')).toBeTruthy()
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

  it('omits a synchronously failing LiDAR source and retains the remaining band', () => {
    const f = fixture()
    f.manager.update(snapshot(f.identity, { lidar: [layer(), layer('lidar-b')] }))
    f.map.addSource.mockImplementationOnce(() => { throw new Error('invalid tile URL') })
    f.manager.restoreStyle()
    expect(f.map.getLayer('lidar-a')).toBeUndefined()
    expect(f.map.getLayer('lidar-b')).toBeTruthy()
    expect(f.states.at(-1)?.status).toBe('ready')
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
    expect(f.map.getLayer('lidar-a')).toBeTruthy()
    expect(f.map.getLayer('panel-target-hover-zones-fill')).toBeTruthy()
  })

  it('ignores delayed source errors after contributions are disconnected', () => {
    const f = fixture()
    f.manager.update(snapshot(f.identity))
    f.manager.restoreStyle()
    f.manager.update(null)
    const published = f.states.length
    expect(f.manager.handleSourceError({ sourceId: 'lidar-a' })).toBe(true)
    expect(f.manager.handleSourceError({ sourceId: 'terrain-dem' })).toBe(true)
    expect(f.states).toHaveLength(published)
    expect(f.states.at(-1)?.status).toBe('idle')
  })

  it('disposes overlays, terrain, rasters, listeners, bounds and diagnostics once with non-ready precision state', async () => {
    const f = fixture()
    f.manager.update(snapshot(f.identity, { designExtentMeters: 10001, terrain: { ...snapshot(f.identity).terrain, hillshadeVisible: true } }))
    f.manager.restoreStyle()
    await flush()
    expect(f.states.at(-1)?.precisionWarning).toBe(true)
    f.manager.dispose()
    const mutations = f.map.removeSource.mock.calls.length
    f.manager.dispose()
    f.manager.restoreStyle()
    f.manager.update(snapshot(f.identity))
    expect(f.map.removeSource).toHaveBeenCalledTimes(mutations)
    expect(f.map.sources.size).toBe(0)
    expect([...f.map.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true)
    expect(f.bounds).toHaveBeenLastCalledWith(null)
    expect(f.diagnostics).toHaveBeenLastCalledWith(null, null)
    expect(f.states.at(-1)).toMatchObject({ status: 'idle', terrainStatus: 'idle', precisionWarning: false, designExtentMeters: null })
  })
})
