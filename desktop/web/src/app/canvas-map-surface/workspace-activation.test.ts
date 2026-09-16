import type { WorkspaceMapContributionSnapshot } from './workspace-map-contribution-adapter'
import { describe, expect, it, vi } from 'vitest'
import {
  WorkspaceActivationCoordinator,
  type WorkspaceActivationOutcome,
  type WorkspaceActivationMap,
  type WorkspaceActivationMapControls,
  type WorkspaceActivationSnapshot,
  type WorkspaceActivationRuntime,
} from './workspace-activation'
import { MapLibreWorkspaceCameraOwner } from '../../maplibre/workspace-camera'
import { createCanvas2DSceneRenderer } from '../../canvas/runtime/renderers/canvas2d-scene'
import { SceneCanvasRuntime } from '../../canvas/runtime/scene-runtime'
import type { RendererCapabilities } from '../../canvas/runtime/renderers/types'
import {
  MAPLIBRE_SHARED_SCENE_LAYER_ID,
  type SharedMapSceneLayer,
  type SharedPixiRenderer,
} from '../../maplibre/shared-scene-layer'
import { createSharedMapSceneRendererComposition, type SharedMapSceneRendererComposition } from '../../maplibre/shared-scene-renderer'

const TEST_CAPABILITIES: RendererCapabilities = {
  domCanvas: true, canvas2d: true, offscreenCanvas: false, offscreenCanvas2d: false,
  webgl: true, webgl2: true, webgpu: false, imageBitmap: false, createImageBitmap: false,
  worker: false, devicePixelRatio: 2, prefersReducedMotion: false,
}

function createActivationSnapshot(
  overrides: Partial<WorkspaceActivationSnapshot['map']> = {},
  sessionIdentity: object = {},
): WorkspaceActivationSnapshot {
  return {
    sessionIdentity,
    map: {
      anchor: { lat: 0, lon: 0 },
      northBearingDeg: 0,
      placementStatus: 'confirmed',
      basemapStyle: 'street',
      basemapVisible: true,
      basemapOpacity: 1,
      ...overrides,
    },
  }
}

class TestWorkspaceActivationCoordinator extends WorkspaceActivationCoordinator {
  override activate(
    snapshot: WorkspaceActivationSnapshot = createActivationSnapshot(),
  ) {
    return super.activate(snapshot)
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

class FakeMap {
  readonly canvas = document.createElement('canvas')
  readonly context = {} as WebGL2RenderingContext
  readonly jumpTo = vi.fn()
  readonly resize = vi.fn()
  readonly remove = vi.fn()
  readonly listeners = new Map<string, Set<() => void>>()
  readonly on = vi.fn((type: string, listener: () => void) => {
    const listeners = this.listeners.get(type) ?? new Set<() => void>()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  })
  readonly off = vi.fn((type: string, listener: () => void) => this.listeners.get(type)?.delete(listener))
  readonly layers = new Map<string, { onAdd?: (map: unknown, context: WebGL2RenderingContext) => void; onRemove?: (map: unknown, context: WebGL2RenderingContext) => void }>()
  readonly layerOrder: string[] = []
  readonly addLayer = vi.fn((layer: { id?: string; onAdd?: (map: unknown, context: WebGL2RenderingContext) => void; onRemove?: (map: unknown, context: WebGL2RenderingContext) => void }) => {
    if (layer.id) {
      this.layers.set(layer.id, layer)
      if (!this.layerOrder.includes(layer.id)) this.layerOrder.push(layer.id)
    }
    layer.onAdd?.(this, this.context)
  })
  readonly getLayer = vi.fn((id: string) => this.layers.get(id))
  readonly getLayersOrder = vi.fn(() => [...this.layerOrder])
  readonly moveLayer = vi.fn((id: string, beforeId?: string) => {
    const index = this.layerOrder.indexOf(id)
    if (index < 0) return
    this.layerOrder.splice(index, 1)
    const beforeIndex = beforeId == null ? -1 : this.layerOrder.indexOf(beforeId)
    if (beforeIndex < 0) this.layerOrder.push(id)
    else this.layerOrder.splice(beforeIndex, 0, id)
  })
  readonly triggerRepaint = vi.fn()
  pitch = 0

  constructor() {
    Object.defineProperties(this.canvas, {
      clientWidth: { value: 400 }, clientHeight: { value: 300 },
      width: { value: 800, writable: true }, height: { value: 600, writable: true },
    })
  }

  getCanvas() { return this.canvas }
  getPitch() { return this.pitch }
  project([lon, lat]: [number, number]) { return { x: 200 + lon * 4, y: 150 - lat * 4 } }
  emit(type: string) { this.listeners.get(type)?.forEach((listener) => listener()) }
  clearStyleLayer(id: string) {
    const layer = this.layers.get(id)
    this.layers.delete(id)
    const index = this.layerOrder.indexOf(id)
    if (index >= 0) this.layerOrder.splice(index, 1)
    layer?.onRemove?.(this, this.context)
  }
}

function createRuntime(): WorkspaceActivationRuntime {
  return {
    init: vi.fn(async () => {}),
    reportRendererFailure: vi.fn(async () => {}),
    destroy: vi.fn(),
  }
}

function createComposition(options: {
  initialize?: () => Promise<void>
  onAdd?: () => void
  dispose?: () => Promise<void>
  directDispose?: () => Promise<void>
} = {}) {
  let phase: SharedMapSceneLayer['diagnostics']['phase'] = 'new'
  const dispose = options.directDispose
    ? vi.fn(options.directDispose)
    : vi.fn(async () => {
      await options.dispose?.()
      phase = 'disposed'
    })
  const layer: SharedMapSceneLayer = {
    layer: {
      id: MAPLIBRE_SHARED_SCENE_LAYER_ID, type: 'custom', renderingMode: '2d',
      onAdd: () => {
        phase = 'attached'
        options.onAdd?.()
      },
      render: () => {},
    },
    get diagnostics() {
      return {
        phase, initializeCount: 0, renderCount: 0, sceneSyncCount: 0,
        viewportSyncCount: 0, resizeCount: 0, repaintCount: 0, skippedRenderCount: 0,
        resetStateCount: 0, disposeCount: 0, disposeInRenderCount: 0,
        recentRenderDurationsMs: [], lastFailure: null,
      }
    },
    initialize: vi.fn(async () => {
      await options.initialize?.()
      phase = 'initialized'
    }),
    setSnapshot: vi.fn(), requestRender: vi.fn(), dispose,
  }
  const composition = {
    renderer: {} as never,
    createLayer: vi.fn(() => layer),
    failActiveLayer: vi.fn(),
  } satisfies SharedMapSceneRendererComposition
  return { composition, layer, dispose }
}

function createCoordinator(input: {
  map?: FakeMap
  createMap?: WorkspaceActivationMapControls['createMap']
  composition?: SharedMapSceneRendererComposition
  runtime?: WorkspaceActivationRuntime
  context?: WebGL2RenderingContext | null
  getWebGL2Context?: WorkspaceActivationMapControls['getWebGL2Context']
  unwatchFailure?: () => void
  watchFailure?: WorkspaceActivationMapControls['watchFailure']
  installStyleRestorer?: WorkspaceActivationMapControls['installStyleRestorer']
} = {}) {
  const map = input.map ?? new FakeMap()
  const camera = new MapLibreWorkspaceCameraOwner()
  camera.initialize({ width: 400, height: 300 })
  const runtime = input.runtime ?? createRuntime()
  const composition = input.composition ?? createComposition().composition
  const mapControls: WorkspaceActivationMapControls = {
    createMap: input.createMap ?? (async () => map as unknown as WorkspaceActivationMap),
    releaseMap: vi.fn((candidate) => (candidate as unknown as FakeMap).remove()),
    getWebGL2Context: input.getWebGL2Context
      ?? (() => input.context === undefined ? map.context : input.context),
    updateMapContributions: vi.fn(),
    updateBasemapPresentation: vi.fn(),
    installStyleRestorer: input.installStyleRestorer ?? vi.fn(() => () => {}),
    watchFailure: input.watchFailure
      ?? (input.unwatchFailure ? () => input.unwatchFailure! : undefined),
  }
  const coordinator = new TestWorkspaceActivationCoordinator({
    container: document.createElement('div'), runtime, camera, composition,
    map: mapControls,
    layer: {},
  })
  return { coordinator, camera, composition, runtime, map, mapControls }
}

describe('WorkspaceActivationCoordinator', () => {
  it.each([new Error('shared renderer failed'), new DOMException('renderer cancelled internally', 'AbortError')])('passes the original terminal renderer failure through map release: %s', async (error) => {
    const f = createCoordinator()
    await f.coordinator.activate(createActivationSnapshot())
    await expect(f.coordinator.reportFailure(error)).resolves.toBe('fallback-ready')
    expect(f.mapControls.releaseMap).toHaveBeenCalledExactlyOnceWith(f.map, error)
    await f.coordinator.teardown()
    expect(f.mapControls.releaseMap).toHaveBeenCalledOnce()
  })

  it('does not attach a stale pending failure to ordinary generation cancellation', async () => {
    const f = createCoordinator()
    await f.coordinator.activate(createActivationSnapshot())
    const failure = f.coordinator.reportFailure(new Error('stale failure'))
    await f.coordinator.requestGenerationDisconnect()
    await expect(failure).resolves.toBe('cancelled')
    expect(f.mapControls.releaseMap).toHaveBeenCalledExactlyOnceWith(f.map)
  })

  it('binds buffered contributions to the session and clears them synchronously before map removal', async () => {
    const f = createCoordinator()
    const activation = createActivationSnapshot()
    const contribution: WorkspaceMapContributionSnapshot = {
      sessionIdentity: activation.sessionIdentity, lidar: [],
      terrain: { contourIntervalMeters: 1, contoursVisible: false, contoursOpacity: 1, hillshadeVisible: false, hillshadeOpacity: 1, isDark: false },
      overlays: { runtime: null, location: null, northBearingDeg: 0, hoveredTargets: [], selectedTargets: [] },
      frame: null, designExtentMeters: 0,
    }
    f.coordinator.updateMapContributions(contribution)
    expect(f.mapControls.updateMapContributions).not.toHaveBeenCalled()
    await f.coordinator.activate(activation)
    expect(f.mapControls.updateMapContributions).toHaveBeenLastCalledWith(contribution)
    vi.mocked(f.mapControls.updateMapContributions).mockClear()
    f.coordinator.updateMapContributions({ ...contribution, sessionIdentity: {} })
    expect(f.mapControls.updateMapContributions).not.toHaveBeenCalled()
    const disconnect = f.coordinator.requestGenerationDisconnect()
    expect(f.mapControls.updateMapContributions).toHaveBeenLastCalledWith(null)
    expect(f.map.remove).not.toHaveBeenCalled()
    await disconnect
    expect(f.map.remove).toHaveBeenCalledOnce()
  })

  it('destroys its constructed runtime once when torn down before activation', async () => {
    const runtime = createRuntime()
    const { coordinator } = createCoordinator({ runtime })

    await coordinator.teardown()
    await coordinator.teardown()

    expect(runtime.destroy).toHaveBeenCalledOnce()
    expect(runtime.init).not.toHaveBeenCalled()
  })

  it('captures caller-owned activation values before asynchronous admission', async () => {
    const created = deferred<WorkspaceActivationMap>()
    let capturedMapSnapshot: WorkspaceActivationSnapshot['map'] | null = null
    const createMap = vi.fn((
      _signal: AbortSignal,
      snapshot: WorkspaceActivationSnapshot['map'],
    ) => {
      capturedMapSnapshot = snapshot
      return created.promise
    })
    const composed = createComposition()
    const { coordinator, camera, map } = createCoordinator({
      createMap,
      composition: composed.composition,
    })
    const attach = vi.spyOn(camera.attachment, 'attach')
    const snapshot: WorkspaceActivationSnapshot = {
      ...createActivationSnapshot({
        anchor: { lat: 10, lon: 20 },
        northBearingDeg: 30,
      }),
      maximumWorldExtentMeters: 4000,
    }

    const activation = coordinator.activate(snapshot)
    ;(snapshot.map.anchor as { lat: number; lon: number }).lat = 90
    await vi.waitFor(() => expect(createMap).toHaveBeenCalledOnce())
    expect(capturedMapSnapshot).toEqual(expect.objectContaining({
      anchor: { lat: 10, lon: 20 },
      northBearingDeg: 30,
    }))

    ;(snapshot.map.anchor as { lat: number; lon: number }).lon = 91
    ;(snapshot.map as { northBearingDeg: number }).northBearingDeg = 92
    ;(snapshot as { maximumWorldExtentMeters?: number }).maximumWorldExtentMeters = 9300
    created.resolve(map as unknown as WorkspaceActivationMap)

    await expect(activation).resolves.toBe('shared-ready')
    expect(composed.composition.createLayer).toHaveBeenCalledWith(expect.objectContaining({
      anchor: { lat: 10, lon: 20 },
      northBearingDeg: 30,
      maximumWorldExtentMeters: 4000,
    }))
    expect(attach).toHaveBeenCalledWith(expect.objectContaining({
      map,
      anchor: { lat: 10, lon: 20 },
      northBearingDeg: 30,
      maximumWorldExtentMeters: 4000,
    }))
  })

  it('waits for connected shared-layer admission before initializing the runtime', async () => {
    const initialized = deferred<void>()
    const composed = createComposition({ initialize: () => initialized.promise })
    const { coordinator, runtime, map } = createCoordinator({ composition: composed.composition })

    const activation = coordinator.activate()
    await Promise.resolve()
    expect(runtime.init).not.toHaveBeenCalled()

    initialized.resolve()
    await expect(activation).resolves.toBe('shared-ready')
    expect(composed.composition.createLayer).toHaveBeenCalledWith(expect.objectContaining({
      id: MAPLIBRE_SHARED_SCENE_LAYER_ID,
    }))
    expect(map.addLayer).toHaveBeenCalledOnce()
    expect(runtime.init).toHaveBeenCalledOnce()
  })

  it('forwards only current-generation basemap presentation without recreating workspace resources', async () => {
    const { coordinator, map, runtime, mapControls } = createCoordinator()
    const updateBasemapPresentation = vi.fn()
    mapControls.updateBasemapPresentation = updateBasemapPresentation
    await expect(coordinator.activate()).resolves.toBe('shared-ready')
    const addLayerCount = map.addLayer.mock.calls.length

    coordinator.updateBasemapPresentation({
      basemapStyle: 'street', basemapVisible: true, basemapOpacity: 1.5,
    })

    expect(updateBasemapPresentation).toHaveBeenCalledWith({
      basemapStyle: 'street', basemapVisible: true, basemapOpacity: 1,
    })
    expect(map.addLayer).toHaveBeenCalledTimes(addLayerCount)
    expect(runtime.init).toHaveBeenCalledOnce()
    await coordinator.teardown()
    coordinator.updateBasemapPresentation({
      basemapStyle: 'street', basemapVisible: false, basemapOpacity: 0,
    })
    expect(updateBasemapPresentation).toHaveBeenCalledOnce()
  })

  it('forwards a presentation posted immediately after initial activation once map acquisition starts', async () => {
    const created = deferred<WorkspaceActivationMap>()
    const createMap = vi.fn(() => created.promise)
    const { coordinator, map, mapControls } = createCoordinator({ createMap })
    const updateBasemapPresentation = vi.fn()
    mapControls.updateBasemapPresentation = updateBasemapPresentation

    const activation = coordinator.activate()
    coordinator.updateBasemapPresentation({
      basemapStyle: 'street', basemapVisible: false, basemapOpacity: 0.4,
    })

    await vi.waitFor(() => expect(createMap).toHaveBeenCalledOnce())
    expect(updateBasemapPresentation).toHaveBeenCalledOnce()
    expect(updateBasemapPresentation).toHaveBeenCalledWith({
      basemapStyle: 'street', basemapVisible: false, basemapOpacity: 0.4,
    })
    created.resolve(map as unknown as WorkspaceActivationMap)

    await expect(activation).resolves.toBe('shared-ready')
    await coordinator.teardown()
  })

  it('fences presentation updates as soon as an owned callback requests teardown', async () => {
    let coordinator!: WorkspaceActivationCoordinator
    let teardown: Promise<void> | null = null
    const composition = createComposition({
      onAdd: () => {
        teardown = coordinator.teardown()
        coordinator.updateBasemapPresentation({
          basemapStyle: 'street', basemapVisible: false, basemapOpacity: 0.2,
        })
      },
    })
    const created = createCoordinator({ composition: composition.composition })
    coordinator = created.coordinator
    const updateBasemapPresentation = vi.fn()
    created.mapControls.updateBasemapPresentation = updateBasemapPresentation

    await expect(coordinator.activate(createActivationSnapshot())).resolves.toBe('cancelled')
    await expect(teardown).resolves.toBeUndefined()
    expect(updateBasemapPresentation).not.toHaveBeenCalled()
  })

  it('drops a buffered presentation when synchronous disconnect cancels activation', async () => {
    const { coordinator, mapControls } = createCoordinator()
    const updateBasemapPresentation = vi.fn()
    mapControls.updateBasemapPresentation = updateBasemapPresentation

    const activation = coordinator.activate()
    coordinator.updateBasemapPresentation({
      basemapStyle: 'street', basemapVisible: false, basemapOpacity: 0.2,
    })
    await coordinator.requestGenerationDisconnect()

    await expect(activation).resolves.toBe('cancelled')
    expect(updateBasemapPresentation).not.toHaveBeenCalled()
  })

  it('fences presentation updates after shared-backend fallback becomes terminal', async () => {
    const { coordinator, mapControls } = createCoordinator()
    const updateBasemapPresentation = vi.fn()
    mapControls.updateBasemapPresentation = updateBasemapPresentation
    await expect(coordinator.activate()).resolves.toBe('shared-ready')

    await expect(coordinator.reportFailure(new Error('shared layer failed'))).resolves.toBe('fallback-ready')
    coordinator.updateBasemapPresentation({
      basemapStyle: 'street', basemapVisible: false, basemapOpacity: 0.2,
    })

    expect(updateBasemapPresentation).not.toHaveBeenCalled()
    await coordinator.teardown()
  })

  it('buffers the latest presentation for a replacement while prior cleanup is pending', async () => {
    const firstDisposal = deferred<void>()
    const first = createComposition({ dispose: () => firstDisposal.promise })
    const second = createComposition()
    const composition: SharedMapSceneRendererComposition = {
      renderer: {} as never,
      createLayer: vi.fn()
        .mockReturnValueOnce(first.layer)
        .mockReturnValue(second.layer),
      failActiveLayer: vi.fn(),
    }
    const firstMap = new FakeMap()
    const secondMap = new FakeMap()
    const createMap = vi.fn()
      .mockResolvedValueOnce(firstMap as unknown as WorkspaceActivationMap)
      .mockResolvedValueOnce(secondMap as unknown as WorkspaceActivationMap)
    const { coordinator, mapControls } = createCoordinator({ createMap, composition })
    const updateBasemapPresentation = vi.fn()
    mapControls.updateBasemapPresentation = updateBasemapPresentation
    await expect(coordinator.activate()).resolves.toBe('shared-ready')

    const replacement = coordinator.activate()
    coordinator.updateBasemapPresentation({
      basemapStyle: 'street', basemapVisible: false, basemapOpacity: 0.3,
    })
    coordinator.updateBasemapPresentation({
      basemapStyle: 'street', basemapVisible: true, basemapOpacity: 0.7,
    })
    await vi.waitFor(() => expect(first.dispose).toHaveBeenCalledOnce())

    expect(updateBasemapPresentation).not.toHaveBeenCalled()
    expect(createMap).toHaveBeenCalledOnce()
    firstDisposal.resolve()

    await expect(replacement).resolves.toBe('shared-ready')
    expect(createMap).toHaveBeenCalledTimes(2)
    expect(updateBasemapPresentation).toHaveBeenCalledOnce()
    expect(updateBasemapPresentation).toHaveBeenCalledWith({
      basemapStyle: 'street', basemapVisible: true, basemapOpacity: 0.7,
    })

    await coordinator.teardown()
  })

  it('reuses one initialized layer, map, camera, and runtime after a style reload', async () => {
    let restore: (() => void) | null = null
    const disposeRestorer = vi.fn()
    const installStyleRestorer = vi.fn((_map, nextRestore) => {
      restore = nextRestore
      return disposeRestorer
    })
    const composed = createComposition()
    const { coordinator, camera, map, runtime } = createCoordinator({
      composition: composed.composition,
      installStyleRestorer,
    })
    const attach = vi.spyOn(camera.attachment, 'attach')

    await expect(coordinator.activate()).resolves.toBe('shared-ready')
    expect(restore).not.toBeNull()
    map.clearStyleLayer(MAPLIBRE_SHARED_SCENE_LAYER_ID)
    restore!()

    expect(map.addLayer).toHaveBeenCalledTimes(2)
    expect(map.addLayer.mock.calls[1]?.[0]).toBe(map.addLayer.mock.calls[0]?.[0])
    expect(composed.layer.initialize).toHaveBeenCalledOnce()
    expect(runtime.init).toHaveBeenCalledOnce()
    expect(attach).toHaveBeenCalledOnce()
    expect(installStyleRestorer).toHaveBeenCalledOnce()

    restore!()
    expect(map.addLayer).toHaveBeenCalledTimes(2)
  })

  it('does not reattach or reinitialize a custom layer preserved by a diff reload', async () => {
    let restore: (() => void) | null = null
    const onAdd = vi.fn()
    const composed = createComposition({ onAdd })
    const { coordinator, map } = createCoordinator({
      composition: composed.composition,
      installStyleRestorer: vi.fn((_map, nextRestore) => {
        restore = nextRestore
        return () => {}
      }),
    })

    await expect(coordinator.activate()).resolves.toBe('shared-ready')
    restore!()

    expect(map.addLayer).toHaveBeenCalledOnce()
    expect(onAdd).toHaveBeenCalledOnce()
    expect(composed.layer.initialize).toHaveBeenCalledOnce()
  })

  it('replays a pending reload only after layer initialization and avoids a duplicate attach', async () => {
    const initialized = deferred<void>()
    const composed = createComposition({ initialize: () => initialized.promise })
    const installStyleRestorer = vi.fn((_map, restore) => {
      restore()
      return () => {}
    })
    const { coordinator, map, runtime } = createCoordinator({
      composition: composed.composition,
      installStyleRestorer,
    })

    const activation = coordinator.activate()
    await vi.waitFor(() => expect(composed.layer.initialize).toHaveBeenCalledOnce())
    expect(map.addLayer).not.toHaveBeenCalled()

    initialized.resolve()
    await expect(activation).resolves.toBe('shared-ready')

    expect(installStyleRestorer).toHaveBeenCalledOnce()
    expect(map.addLayer).toHaveBeenCalledOnce()
    expect(composed.layer.initialize).toHaveBeenCalledOnce()
    expect(runtime.init).toHaveBeenCalledOnce()
  })

  it('falls back when reattaching the shared scene layer fails', async () => {
    let restore: (() => void) | null = null
    let reportFailure: ((error: unknown) => void) | null = null
    const installStyleRestorer = vi.fn((_map, nextRestore) => {
      restore = () => {
        try {
          nextRestore()
        } catch (error) {
          reportFailure?.(error)
        }
      }
      return () => {}
    })
    const watchFailure = vi.fn((_map, nextReportFailure) => {
      reportFailure = nextReportFailure
      return () => {}
    })
    const map = new FakeMap()
    const { coordinator, runtime } = createCoordinator({ map, installStyleRestorer, watchFailure })

    await expect(coordinator.activate()).resolves.toBe('shared-ready')
    map.clearStyleLayer(MAPLIBRE_SHARED_SCENE_LAYER_ID)
    const failure = new Error('style reload layer attach failed')
    map.addLayer.mockImplementation(() => { throw failure })
    restore!()

    await vi.waitFor(() => expect(runtime.reportRendererFailure).toHaveBeenCalledWith(
      'maplibre-pixi',
      failure,
    ))
    expect(map.remove).toHaveBeenCalledOnce()
  })

  it('disposes style restoration before disposing the layer and releasing the map', async () => {
    const disposeRestorer = vi.fn()
    const installStyleRestorer = vi.fn(() => disposeRestorer)
    const composed = createComposition()
    const { coordinator, map } = createCoordinator({
      composition: composed.composition,
      installStyleRestorer,
    })
    await coordinator.activate()

    await coordinator.teardown()

    expect(disposeRestorer).toHaveBeenCalledOnce()
    expect(disposeRestorer.mock.invocationCallOrder[0]).toBeLessThan(composed.dispose.mock.invocationCallOrder[0]!)
    expect(composed.dispose.mock.invocationCallOrder[0]).toBeLessThan(map.remove.mock.invocationCallOrder[0]!)
  })

  it('ignores a stale style restoration callback after teardown or replacement', async () => {
    const restorers: Array<() => void> = []
    const installStyleRestorer = vi.fn((_map, restore) => {
      restorers.push(restore)
      return () => {}
    })
    const firstMap = new FakeMap()
    const secondMap = new FakeMap()
    const maps = [firstMap, secondMap]
    let index = 0
    const { coordinator } = createCoordinator({
      createMap: async () => maps[index++] as unknown as WorkspaceActivationMap,
      installStyleRestorer,
    })
    await coordinator.activate()
    await expect(coordinator.activate()).resolves.toBe('shared-ready')
    firstMap.clearStyleLayer(MAPLIBRE_SHARED_SCENE_LAYER_ID)
    restorers[0]!()
    expect(firstMap.addLayer).toHaveBeenCalledOnce()

    await coordinator.teardown()
    restorers[1]!()
    expect(secondMap.addLayer).toHaveBeenCalledOnce()
  })

  it('replaces A with B from B snapshot after ordered A cleanup while retaining one runtime', async () => {
    const events: string[] = []
    const firstMap = new FakeMap()
    const secondMap = new FakeMap()
    firstMap.off.mockImplementation(() => {
      events.push('camera-detach')
      return undefined
    })
    firstMap.remove.mockImplementation(() => { events.push('map-release') })
    const first = createComposition({ dispose: async () => { events.push('layer-dispose') } })
    const second = createComposition()
    const composition: SharedMapSceneRendererComposition = {
      renderer: {} as never,
      createLayer: vi.fn()
        .mockReturnValueOnce(first.layer)
        .mockReturnValueOnce(second.layer),
      failActiveLayer: vi.fn(),
    }
    const snapshots: WorkspaceActivationSnapshot['map'][] = []
    const createMap = vi.fn(async (
      _signal: AbortSignal,
      snapshot: WorkspaceActivationSnapshot['map'],
    ) => {
      snapshots.push(snapshot)
      return snapshots.length === 1
        ? firstMap as unknown as WorkspaceActivationMap
        : secondMap as unknown as WorkspaceActivationMap
    })
    const disposeStyleRestorer = vi.fn(() => { events.push('style-restorer') })
    const unwatchFailure = vi.fn(() => { events.push('failure-watcher') })
    const { coordinator, camera, runtime } = createCoordinator({
      createMap,
      composition,
      installStyleRestorer: () => disposeStyleRestorer,
      watchFailure: () => unwatchFailure,
    })
    const attach = vi.spyOn(camera.attachment, 'attach')
    const snapshotA = createActivationSnapshot({
      anchor: { lat: 1, lon: 2 },
      northBearingDeg: 3,
      basemapOpacity: 0.2,
    })
    const snapshotB: WorkspaceActivationSnapshot = {
      ...createActivationSnapshot({
        anchor: { lat: 40, lon: -70 },
        northBearingDeg: 27,
        basemapOpacity: 0.8,
      }),
      maximumWorldExtentMeters: 4321,
    }

    await expect(coordinator.activate(snapshotA)).resolves.toBe('shared-ready')
    await expect(coordinator.activate(snapshotB)).resolves.toBe('shared-ready')

    expect(snapshots).toEqual([snapshotA.map, snapshotB.map])
    expect(composition.createLayer).toHaveBeenLastCalledWith(expect.objectContaining({
      anchor: snapshotB.map.anchor,
      northBearingDeg: snapshotB.map.northBearingDeg,
      maximumWorldExtentMeters: 4321,
    }))
    expect(attach).toHaveBeenLastCalledWith(expect.objectContaining({
      map: secondMap,
      anchor: snapshotB.map.anchor,
      northBearingDeg: snapshotB.map.northBearingDeg,
      maximumWorldExtentMeters: 4321,
    }))
    expect(events).toEqual([
      'style-restorer',
      'failure-watcher',
      'camera-detach',
      'camera-detach',
      'layer-dispose',
      'map-release',
    ])
    expect(runtime.init).toHaveBeenCalledOnce()
    expect(runtime.destroy).not.toHaveBeenCalled()

    await coordinator.teardown()
    expect(runtime.destroy).toHaveBeenCalledOnce()
  })

  it('replaces equal map values when session identity changes', async () => {
    const maps = [new FakeMap(), new FakeMap()]
    const first = createComposition()
    const second = createComposition()
    const composition: SharedMapSceneRendererComposition = {
      renderer: {} as never,
      createLayer: vi.fn()
        .mockReturnValueOnce(first.layer)
        .mockReturnValueOnce(second.layer),
      failActiveLayer: vi.fn(),
    }
    const createMap = vi.fn(async () => maps[createMap.mock.calls.length - 1] as unknown as WorkspaceActivationMap)
    const { coordinator, runtime } = createCoordinator({ createMap, composition })
    const mapSnapshot = createActivationSnapshot().map

    await coordinator.activate({ sessionIdentity: {}, map: mapSnapshot })
    await coordinator.activate({ sessionIdentity: {}, map: mapSnapshot })

    expect(createMap).toHaveBeenCalledTimes(2)
    expect(first.dispose).toHaveBeenCalledOnce()
    expect(maps[0]!.remove).toHaveBeenCalledOnce()
    expect(runtime.init).toHaveBeenCalledOnce()
  })

  it('fences stale failure callbacks from a replaced generation', async () => {
    const reports: Array<(error: unknown) => void> = []
    const maps = [new FakeMap(), new FakeMap()]
    const first = createComposition()
    const second = createComposition()
    const composition: SharedMapSceneRendererComposition = {
      renderer: {} as never,
      createLayer: vi.fn()
        .mockReturnValueOnce(first.layer)
        .mockReturnValueOnce(second.layer),
      failActiveLayer: vi.fn(),
    }
    const createMap = vi.fn(async () => maps[createMap.mock.calls.length - 1] as unknown as WorkspaceActivationMap)
    const { coordinator, runtime } = createCoordinator({
      createMap,
      composition,
      watchFailure: (_map, report) => {
        reports.push(report)
        return () => {}
      },
    })

    await coordinator.activate(createActivationSnapshot())
    await coordinator.activate(createActivationSnapshot())
    reports[0]!(new Error('stale A failure'))
    await Promise.resolve()

    expect(composition.failActiveLayer).not.toHaveBeenCalled()
    expect(runtime.reportRendererFailure).not.toHaveBeenCalled()
    expect(maps[1]!.remove).not.toHaveBeenCalled()
  })

  it('waits for a pending runtime initialization before publishing fallback-ready', async () => {
    const initialized = deferred<void>()
    const runtime = createRuntime()
    runtime.init = vi.fn(() => initialized.promise)
    const { coordinator, map } = createCoordinator({ runtime })
    const activation = coordinator.activate()
    await vi.waitFor(() => expect(runtime.init).toHaveBeenCalledOnce())

    const failure = coordinator.reportFailure(new Error('map context lost during initialization'))
    await Promise.resolve()
    expect(runtime.reportRendererFailure).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(map.remove).toHaveBeenCalledOnce())

    initialized.resolve()
    await expect(failure).resolves.toBe('fallback-ready')
    await expect(activation).resolves.toBe('fallback-ready')
    expect(runtime.reportRendererFailure).toHaveBeenCalledOnce()
  })

  it('installs failure and cleanup fences before a watcher can report synchronously', async () => {
    const unwatchFailure = vi.fn()
    const watchFailure = vi.fn((_map, reportFailure) => {
      reportFailure(new Error('map failed during watcher installation'))
      return () => {
        unwatchFailure()
        reportFailure(new Error('map failed again during watcher cleanup'))
      }
    })
    const composed = createComposition()
    const { coordinator, runtime, map } = createCoordinator({
      composition: composed.composition,
      watchFailure,
    })

    await expect(coordinator.activate()).resolves.toBe('fallback-ready')

    expect(watchFailure).toHaveBeenCalledOnce()
    expect(unwatchFailure).toHaveBeenCalledOnce()
    expect(composed.dispose).not.toHaveBeenCalled()
    expect(map.remove).toHaveBeenCalledOnce()
    expect(runtime.init).toHaveBeenCalledOnce()
  })

  it('propagates a concurrent runtime initialization rejection instead of masking it as fallback-ready', async () => {
    const initialized = deferred<void>()
    const runtime = createRuntime()
    runtime.init = vi.fn(() => initialized.promise)
    const failure = new Error('runtime initialization rejected')
    const { coordinator, map } = createCoordinator({ runtime })
    const activation = coordinator.activate()
    await vi.waitFor(() => expect(runtime.init).toHaveBeenCalledOnce())
    const reportedFailure = coordinator.reportFailure(new Error('map context lost during initialization'))

    initialized.reject(failure)

    await expect(reportedFailure).rejects.toBe(failure)
    await expect(activation).rejects.toBe(failure)
    expect(runtime.reportRendererFailure).not.toHaveBeenCalled()
    expect(map.remove).toHaveBeenCalledOnce()
  })

  it('removes the failed map and initializes the visible fallback before resolving', async () => {
    const map = new FakeMap()
    map.addLayer.mockImplementation(() => { throw new Error('add layer failed') })
    const composed = createComposition()
    const { coordinator, runtime, composition } = createCoordinator({ map, composition: composed.composition })

    await expect(coordinator.activate()).resolves.toBe('fallback-ready')

    expect(composition.failActiveLayer).toHaveBeenCalledWith(expect.any(Error))
    expect(composed.dispose).toHaveBeenCalledWith({ mapWillBeRemoved: true })
    expect(map.remove).toHaveBeenCalledOnce()
    expect(runtime.init).toHaveBeenCalledOnce()
  })

  it.each([
    ['WebGL2 is unavailable', () => ({ context: null })],
    ['shared layer initialization rejects', () => ({
      composition: createComposition({ initialize: async () => { throw new Error('Pixi init failed') } }).composition,
    })],
    ['camera attachment is rejected', () => {
      const map = new FakeMap()
      vi.spyOn(map, 'getPitch').mockReturnValue(1)
      return { map }
    }],
  ])('falls back when %s', async (_reason, setup) => {
    const configured = setup()
    const { coordinator, runtime, map } = createCoordinator(configured)

    await expect(coordinator.activate()).resolves.toBe('fallback-ready')

    expect(map.remove).toHaveBeenCalledOnce()
    expect(runtime.init).toHaveBeenCalledOnce()
  })

  it('falls back when map acquisition rejects before a map is admitted', async () => {
    const failure = new Error('MapLibre loader failed')
    const { coordinator, runtime, composition } = createCoordinator({
      createMap: async () => { throw failure },
    })

    await expect(coordinator.activate()).resolves.toBe('fallback-ready')
    expect(composition.failActiveLayer).toHaveBeenCalledWith(failure)
    expect(runtime.init).toHaveBeenCalledOnce()
  })

  it('fails over once when replacement admission fails and never restarts the shared backend', async () => {
    const map = new FakeMap()
    const replacementFailure = new Error('replacement map failed')
    const createMap = vi.fn()
      .mockResolvedValueOnce(map as unknown as WorkspaceActivationMap)
      .mockRejectedValueOnce(replacementFailure)
    const { coordinator, runtime, composition } = createCoordinator({ createMap })

    await expect(coordinator.activate(createActivationSnapshot())).resolves.toBe('shared-ready')
    await expect(coordinator.activate(createActivationSnapshot())).resolves.toBe('fallback-ready')
    await expect(coordinator.activate(createActivationSnapshot())).resolves.toBe('fallback-ready')

    expect(createMap).toHaveBeenCalledTimes(2)
    expect(composition.failActiveLayer).toHaveBeenCalledOnce()
    expect(composition.failActiveLayer).toHaveBeenCalledWith(replacementFailure)
    expect(runtime.init).toHaveBeenCalledOnce()
    expect(runtime.reportRendererFailure).toHaveBeenCalledOnce()
    expect(runtime.destroy).not.toHaveBeenCalled()
  })

  it('eagerly fails only the active shared backend and retains the last camera frame', async () => {
    const { coordinator, runtime, camera, map } = createCoordinator()
    await expect(coordinator.activate()).resolves.toBe('shared-ready')
    const attachedFrame = camera.snapshot.value

    await expect(coordinator.reportFailure(new Error('context lost'))).resolves.toBe('fallback-ready')

    expect(runtime.reportRendererFailure).toHaveBeenCalledWith('maplibre-pixi', expect.any(Error))
    expect(camera.snapshot.value).toBe(attachedFrame)
    expect(map.off).toHaveBeenCalledTimes(2)
    expect(map.remove).toHaveBeenCalledOnce()
  })

  it('observes a later camera projection failure and falls back eagerly', async () => {
    const { coordinator, runtime, map } = createCoordinator()
    await expect(coordinator.activate()).resolves.toBe('shared-ready')

    map.pitch = 1
    map.emit('move')

    await vi.waitFor(() => expect(runtime.reportRendererFailure).toHaveBeenCalledOnce())
    expect(runtime.reportRendererFailure).toHaveBeenCalledWith('maplibre-pixi', expect.any(Error))
    expect(map.remove).toHaveBeenCalledOnce()
  })

  it('synchronously fences an active generation while deferring map release until layer disposal settles', async () => {
    const layerDisposal = deferred<void>()
    const events: string[] = []
    const map = new FakeMap()
    map.off.mockImplementation(() => {
      events.push('camera-detach')
      return undefined
    })
    map.remove.mockImplementation(() => { events.push('map-release') })
    const composed = createComposition({ dispose: () => {
      events.push('layer-dispose')
      return layerDisposal.promise
    } })
    let restore: (() => void) | null = null
    let reportFailure: ((error: unknown) => void) | null = null
    const { coordinator, runtime } = createCoordinator({
      map,
      composition: composed.composition,
      installStyleRestorer: vi.fn((_map, callback) => {
        restore = callback
        return () => { events.push('style-restorer-disposed') }
      }),
      watchFailure: vi.fn((_map, callback) => {
        reportFailure = callback
        return () => { events.push('failure-watcher-disposed') }
      }),
    })
    await coordinator.activate()

    const disconnected = coordinator.requestGenerationDisconnect()

    expect(map.off).toHaveBeenCalledTimes(2)
    expect(composed.dispose).toHaveBeenCalledOnce()
    expect(events).toContain('camera-detach')
    expect(events).toContain('layer-dispose')
    expect(events).not.toContain('map-release')
    expect(runtime.destroy).not.toHaveBeenCalled()
    expect(runtime.reportRendererFailure).not.toHaveBeenCalled()
    restore!()
    reportFailure!(new Error('stale callback'))
    expect(map.addLayer).toHaveBeenCalledOnce()
    expect(runtime.reportRendererFailure).not.toHaveBeenCalled()

    layerDisposal.resolve()
    await expect(disconnected).resolves.toBeUndefined()
    expect(events).toEqual(expect.arrayContaining(['layer-dispose', 'map-release']))
    expect(events.indexOf('layer-dispose')).toBeLessThan(events.indexOf('map-release'))
  })

  it.each([
    'WebGL2 context acquisition',
    'layer creation',
    'failure watcher installation',
    'style restorer installation',
    'camera failure subscription',
    'camera attachment',
    'shared layer attachment',
  ] as const)('rolls back a generation when replacement reenters from %s', async (boundary) => {
    let coordinator!: TestWorkspaceActivationCoordinator
    const layer = createComposition({
      onAdd: boundary === 'shared layer attachment'
        ? () => { coordinator.requestGenerationDisconnect() }
        : undefined,
    })
    const watcherDisposer = vi.fn()
    const restorerDisposer = vi.fn()
    const subscriptionDisposer = vi.fn()
    const composition: SharedMapSceneRendererComposition = boundary === 'layer creation'
      ? {
        ...layer.composition,
        createLayer: vi.fn(() => {
          coordinator.requestGenerationDisconnect()
          return layer.layer
        }),
      }
      : layer.composition
    const { camera, map, runtime, coordinator: created } = createCoordinator({
      composition,
      getWebGL2Context: boundary === 'WebGL2 context acquisition'
        ? vi.fn(() => {
          coordinator.requestGenerationDisconnect()
          return new FakeMap().context
        })
        : undefined,
      watchFailure: boundary === 'failure watcher installation'
        ? vi.fn(() => {
          coordinator.requestGenerationDisconnect()
          return watcherDisposer
        })
        : undefined,
      installStyleRestorer: boundary === 'style restorer installation'
        ? vi.fn(() => {
          coordinator.requestGenerationDisconnect()
          return restorerDisposer
        })
        : undefined,
    })
    coordinator = created
    const subscribeFailure = vi.spyOn(camera.attachment, 'subscribeFailure')
    if (boundary === 'camera failure subscription') {
      subscribeFailure.mockImplementation(() => {
        coordinator.requestGenerationDisconnect()
        return subscriptionDisposer
      })
    }
    const detach = vi.spyOn(camera.attachment, 'detach')
    if (boundary === 'camera attachment') {
      vi.spyOn(camera.attachment, 'attach').mockImplementation(() => {
        coordinator.requestGenerationDisconnect()
        return true
      })
    }

    await expect(coordinator.activate()).resolves.toBe('cancelled')
    await vi.waitFor(() => expect(map.remove).toHaveBeenCalledOnce())

    if (boundary === 'failure watcher installation' || boundary === 'WebGL2 context acquisition') {
      expect(layer.dispose).not.toHaveBeenCalled()
    } else {
      expect(layer.dispose).toHaveBeenCalledOnce()
    }
    expect(runtime.init).not.toHaveBeenCalled()
    if (boundary === 'failure watcher installation') expect(watcherDisposer).toHaveBeenCalledOnce()
    if (boundary === 'style restorer installation') expect(restorerDisposer).toHaveBeenCalledOnce()
    if (boundary === 'camera failure subscription') expect(subscriptionDisposer).toHaveBeenCalledOnce()
    if (boundary === 'camera attachment') expect(detach).toHaveBeenCalledOnce()
    if (boundary === 'shared layer attachment') expect(subscribeFailure).not.toHaveBeenCalled()
  })

  it('waits for a requested disconnect before creating a successor map', async () => {
    const layerDisposal = deferred<void>()
    const first = createComposition({ dispose: () => layerDisposal.promise })
    const successor = createComposition()
    const composition: SharedMapSceneRendererComposition = {
      renderer: {} as never,
      createLayer: vi.fn().mockReturnValueOnce(first.layer).mockReturnValueOnce(successor.layer),
      failActiveLayer: vi.fn(),
    }
    const maps = [new FakeMap(), new FakeMap()]
    const createMap = vi.fn(async () => maps[createMap.mock.calls.length - 1] as unknown as WorkspaceActivationMap)
    const { coordinator } = createCoordinator({ createMap, composition })
    await coordinator.activate(createActivationSnapshot({ northBearingDeg: 1 }))

    coordinator.requestGenerationDisconnect()
    const activation = coordinator.activate(createActivationSnapshot({ northBearingDeg: 2 }))
    await Promise.resolve()

    expect(createMap).toHaveBeenCalledOnce()
    layerDisposal.resolve()
    await expect(activation).resolves.toBe('shared-ready')
    expect(createMap).toHaveBeenCalledTimes(2)
  })

  it('blocks one successor after a requested disconnect rejects, then permits recovery', async () => {
    const firstMap = new FakeMap()
    const recoveredMap = new FakeMap()
    const cleanupFailure = new Error('map release failed')
    firstMap.remove.mockImplementation(() => { throw cleanupFailure })
    const maps = [firstMap, recoveredMap]
    const createMap = vi.fn(async () => maps[createMap.mock.calls.length - 1] as unknown as WorkspaceActivationMap)
    const { coordinator } = createCoordinator({ createMap })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    await coordinator.activate()

    await expect(coordinator.requestGenerationDisconnect()).rejects.toBe(cleanupFailure)
    await expect(coordinator.activate()).rejects.toBe(cleanupFailure)
    expect(createMap).toHaveBeenCalledOnce()

    await expect(coordinator.activate()).resolves.toBe('shared-ready')
    expect(createMap).toHaveBeenCalledTimes(2)
    consoleError.mockRestore()
  })

  it('shares one requested disconnect and does not dispose the generation twice', async () => {
    const layerDisposal = deferred<void>()
    const composed = createComposition({ dispose: () => layerDisposal.promise })
    const { coordinator, map } = createCoordinator({ composition: composed.composition })
    await coordinator.activate()

    const first = coordinator.requestGenerationDisconnect()
    const repeated = coordinator.requestGenerationDisconnect()

    expect(repeated).toBe(first)
    expect(composed.dispose).toHaveBeenCalledOnce()
    layerDisposal.resolve()
    await expect(first).resolves.toBeUndefined()
    expect(map.remove).toHaveBeenCalledOnce()
  })

  it('joins a requested disconnect during terminal teardown and destroys the runtime once', async () => {
    const layerDisposal = deferred<void>()
    const composed = createComposition({ dispose: () => layerDisposal.promise })
    const { coordinator, runtime, map } = createCoordinator({ composition: composed.composition })
    await coordinator.activate()

    coordinator.requestGenerationDisconnect()
    const teardown = coordinator.teardown()
    await Promise.resolve()
    expect(runtime.destroy).not.toHaveBeenCalled()

    layerDisposal.resolve()
    await expect(teardown).resolves.toBeUndefined()
    expect(map.remove).toHaveBeenCalledOnce()
    expect(runtime.destroy).toHaveBeenCalledOnce()
  })

  it('joins an already-started renderer failover before disconnect and terminal teardown settle', async () => {
    const rendererReplacement = deferred<void>()
    const runtime = createRuntime()
    runtime.reportRendererFailure = vi.fn(() => rendererReplacement.promise)
    const { coordinator } = createCoordinator({ runtime })
    await coordinator.activate()

    const failure = coordinator.reportFailure(new Error('context lost'))
    await vi.waitFor(() => expect(runtime.reportRendererFailure).toHaveBeenCalledOnce())
    const disconnected = coordinator.requestGenerationDisconnect()
    const teardown = coordinator.teardown()
    await Promise.resolve()

    expect(runtime.destroy).not.toHaveBeenCalled()
    rendererReplacement.resolve()

    await expect(failure).resolves.toBe('cancelled')
    await expect(disconnected).resolves.toBeUndefined()
    await expect(teardown).resolves.toBeUndefined()
    expect(runtime.destroy).toHaveBeenCalledOnce()
  })

  it('rejects a child cleanup that returns an owner operation without creating a cycle', async () => {
    let coordinator!: TestWorkspaceActivationCoordinator
    let nestedActivation!: Promise<WorkspaceActivationOutcome>
    let nestedDisconnect!: Promise<void>
    let nestedTeardown!: Promise<void>
    const composed = createComposition({ directDispose: () => {
      nestedActivation = coordinator.activate()
      nestedDisconnect = coordinator.requestGenerationDisconnect()
      expect(coordinator.requestGenerationDisconnect()).toBe(nestedDisconnect)
      nestedTeardown = coordinator.teardown()
      return nestedTeardown
    } })
    const { coordinator: created, map, runtime } = createCoordinator({
      composition: composed.composition,
    })
    coordinator = created
    await coordinator.activate()

    const teardown = coordinator.teardown()

    expect(nestedTeardown).toBe(teardown)
    await expect(teardown).rejects.toThrow(
      'Shared workspace shared scene layer disposal must not return a coordinator lifecycle operation.',
    )
    await expect(nestedActivation).resolves.toBe('cancelled')
    await expect(nestedDisconnect).rejects.toThrow(
      'Shared workspace shared scene layer disposal must not return a coordinator lifecycle operation.',
    )
    expect(map.remove).toHaveBeenCalledOnce()
    expect(runtime.destroy).toHaveBeenCalledOnce()
  })

  it('keeps a void-disposer teardown pending until requested disconnect cleanup completes', async () => {
    let coordinator!: TestWorkspaceActivationCoordinator
    let nestedTeardown!: Promise<void>
    let nestedSettled = false
    const layerDisposal = deferred<void>()
    const disposeStyleRestorer = vi.fn(() => {
      nestedTeardown = coordinator.teardown()
      void nestedTeardown.then(
        () => { nestedSettled = true },
        () => { nestedSettled = true },
      )
    })
    const composed = createComposition({ dispose: () => layerDisposal.promise })
    const { coordinator: created, runtime } = createCoordinator({
      composition: composed.composition,
      installStyleRestorer: () => disposeStyleRestorer,
    })
    coordinator = created
    await coordinator.activate()

    const disconnected = coordinator.requestGenerationDisconnect()
    expect(coordinator.teardown()).toBe(nestedTeardown)
    await Promise.resolve()

    expect(nestedSettled).toBe(false)
    expect(runtime.destroy).not.toHaveBeenCalled()

    layerDisposal.resolve()
    await expect(disconnected).resolves.toBeUndefined()
    await expect(nestedTeardown).resolves.toBeUndefined()
    expect(runtime.destroy).toHaveBeenCalledOnce()
    expect(disposeStyleRestorer).toHaveBeenCalledOnce()
  })

  it('propagates requested-disconnect cleanup failure to a void-disposer teardown caller', async () => {
    let coordinator!: TestWorkspaceActivationCoordinator
    let nestedTeardown!: Promise<void>
    const cleanupFailure = new Error('map release failed after teardown request')
    const map = new FakeMap()
    map.remove.mockImplementation(() => { throw cleanupFailure })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { coordinator: created, runtime } = createCoordinator({
      map,
      installStyleRestorer: () => () => {
        nestedTeardown = coordinator.teardown()
      },
    })
    coordinator = created
    await coordinator.activate()

    const disconnected = coordinator.requestGenerationDisconnect()

    await expect(disconnected).rejects.toBe(cleanupFailure)
    await expect(nestedTeardown).rejects.toBe(cleanupFailure)
    expect(runtime.destroy).toHaveBeenCalledOnce()
    consoleError.mockRestore()
  })

  it('observes a rejected teardown intentionally ignored by a void disposer', async () => {
    let coordinator!: TestWorkspaceActivationCoordinator
    const cleanupFailure = new Error('ignored teardown cleanup failed')
    const map = new FakeMap()
    map.remove.mockImplementation(() => { throw cleanupFailure })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { coordinator: created, runtime } = createCoordinator({
      map,
      installStyleRestorer: () => () => {
        void coordinator.teardown()
      },
    })
    coordinator = created
    await coordinator.activate()

    await expect(coordinator.requestGenerationDisconnect()).rejects.toBe(cleanupFailure)
    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        'Reentrant shared workspace lifecycle operation failed:',
        cleanupFailure,
      )
    })
    expect(runtime.destroy).toHaveBeenCalledOnce()
    consoleError.mockRestore()
  })

  it('rejects runtime initialization that directly returns terminal teardown', async () => {
    let coordinator!: TestWorkspaceActivationCoordinator
    let nestedTeardown!: Promise<void>
    const runtime = createRuntime()
    runtime.init = vi.fn(() => {
      nestedTeardown = coordinator.teardown()
      return nestedTeardown
    })
    const { coordinator: created, map } = createCoordinator({ runtime })
    coordinator = created

    await expect(coordinator.activate()).resolves.toBe('cancelled')
    await expect(nestedTeardown).rejects.toThrow(
      'Shared workspace runtime initialization must not return a coordinator lifecycle operation.',
    )
    expect(map.remove).toHaveBeenCalledOnce()
    expect(runtime.destroy).toHaveBeenCalledOnce()
  })

  it('rejects renderer failover that directly returns terminal teardown', async () => {
    let coordinator!: TestWorkspaceActivationCoordinator
    let nestedTeardown!: Promise<void>
    const runtime = createRuntime()
    runtime.reportRendererFailure = vi.fn(() => {
      nestedTeardown = coordinator.teardown()
      return nestedTeardown
    })
    const { coordinator: created, map } = createCoordinator({ runtime })
    coordinator = created
    await coordinator.activate()

    const failure = coordinator.reportFailure(new Error('context lost'))

    await expect(failure).rejects.toThrow(
      'Shared workspace renderer failover must not return a coordinator lifecycle operation.',
    )
    await expect(nestedTeardown).rejects.toThrow(
      'Shared workspace renderer failover must not return a coordinator lifecycle operation.',
    )
    expect(map.remove).toHaveBeenCalledOnce()
    expect(runtime.destroy).toHaveBeenCalledOnce()
  })

  it('fences a stale asynchronous map creation after cancellation and tears down once', async () => {
    const created = deferred<WorkspaceActivationMap>()
    const captured = { signal: null as AbortSignal | null }
    const { coordinator, runtime, mapControls } = createCoordinator({
      createMap: (nextSignal) => {
        captured.signal = nextSignal
        return created.promise
      },
    })
    const activation = coordinator.activate()

    await vi.waitFor(() => expect(captured.signal).not.toBeNull())
    await coordinator.teardown()
    expect(captured.signal?.aborted).toBe(true)
    const staleMap = new FakeMap()
    created.resolve(staleMap as unknown as WorkspaceActivationMap)

    await expect(activation).resolves.toBe('cancelled')
    await coordinator.teardown()
    expect(staleMap.remove).toHaveBeenCalledOnce()
    expect(mapControls.releaseMap).toHaveBeenCalledWith(staleMap)
    expect(runtime.init).not.toHaveBeenCalled()
  })

  it('keeps the newest activation when an older replacement is still cleaning up', async () => {
    const firstDisposal = deferred<void>()
    const first = createComposition({ dispose: () => firstDisposal.promise })
    const newest = createComposition()
    const composition: SharedMapSceneRendererComposition = {
      renderer: {} as never,
      createLayer: vi.fn()
        .mockReturnValueOnce(first.layer)
        .mockReturnValue(newest.layer),
      failActiveLayer: vi.fn(),
    }
    const firstMap = new FakeMap()
    const newestMap = new FakeMap()
    const maps = [firstMap, newestMap]
    const signals: AbortSignal[] = []
    const snapshots: WorkspaceActivationSnapshot['map'][] = []
    const createMap = vi.fn(async (
      signal: AbortSignal,
      snapshot: WorkspaceActivationSnapshot['map'],
    ) => {
      signals.push(signal)
      snapshots.push(snapshot)
      return maps[signals.length - 1] as unknown as WorkspaceActivationMap
    })
    const { coordinator, mapControls } = createCoordinator({ createMap, composition })
    const snapshotA = createActivationSnapshot({ northBearingDeg: 1 })
    const snapshotB = createActivationSnapshot({ northBearingDeg: 2 })
    const snapshotC = createActivationSnapshot({ northBearingDeg: 3 })
    await expect(coordinator.activate(snapshotA)).resolves.toBe('shared-ready')

    const superseded = coordinator.activate(snapshotB)
    await vi.waitFor(() => expect(first.dispose).toHaveBeenCalledOnce())
    const latest = coordinator.activate(snapshotC)

    await Promise.resolve()
    expect(signals).toHaveLength(1)
    expect(signals[0]?.aborted).toBe(true)
    expect(firstMap.remove).not.toHaveBeenCalled()
    expect(newestMap.remove).not.toHaveBeenCalled()

    firstDisposal.resolve()
    await expect(superseded).resolves.toBe('cancelled')
    await expect(latest).resolves.toBe('shared-ready')
    expect(signals).toHaveLength(2)
    expect(signals[1]?.aborted).toBe(false)
    expect(snapshots).toEqual([snapshotA.map, snapshotC.map])
    expect(firstMap.remove).toHaveBeenCalledOnce()
    expect(mapControls.releaseMap).toHaveBeenCalledWith(firstMap)

    await coordinator.teardown()
    expect(newest.dispose).toHaveBeenCalledOnce()
    expect(newestMap.remove).toHaveBeenCalledOnce()
  })

  it('lets public teardown cancel a replacement waiting on prior cleanup', async () => {
    const firstDisposal = deferred<void>()
    const composed = createComposition({ dispose: () => firstDisposal.promise })
    const map = new FakeMap()
    const signals: AbortSignal[] = []
    const createMap = vi.fn(async (signal: AbortSignal) => {
      signals.push(signal)
      return map as unknown as WorkspaceActivationMap
    })
    const { coordinator, runtime } = createCoordinator({
      createMap,
      composition: composed.composition,
    })
    await expect(coordinator.activate()).resolves.toBe('shared-ready')

    const replacement = coordinator.activate()
    await vi.waitFor(() => expect(composed.dispose).toHaveBeenCalledOnce())
    const teardown = coordinator.teardown()

    await Promise.resolve()
    expect(createMap).toHaveBeenCalledOnce()
    expect(map.remove).not.toHaveBeenCalled()

    firstDisposal.resolve()
    await expect(replacement).resolves.toBe('cancelled')
    await expect(teardown).resolves.toBeUndefined()
    expect(map.remove).toHaveBeenCalledOnce()
    expect(runtime.init).toHaveBeenCalledOnce()
    expect(runtime.destroy).toHaveBeenCalledOnce()
    expect(signals[0]?.aborted).toBe(true)
  })

  it('waits for initialization before final teardown destroys the runtime once', async () => {
    const initialized = deferred<void>()
    const runtime = createRuntime()
    runtime.init = vi.fn(() => initialized.promise)
    const { coordinator, map } = createCoordinator({ runtime })
    const activation = coordinator.activate(createActivationSnapshot())
    await vi.waitFor(() => expect(runtime.init).toHaveBeenCalledOnce())

    const teardown = coordinator.teardown()
    await vi.waitFor(() => expect(map.remove).toHaveBeenCalledOnce())
    expect(runtime.destroy).not.toHaveBeenCalled()

    initialized.resolve()
    await expect(activation).resolves.toBe('cancelled')
    await expect(teardown).resolves.toBeUndefined()
    expect(runtime.destroy).toHaveBeenCalledOnce()
  })

  it('recovers on a later request after replacement cleanup rejects', async () => {
    const firstMap = new FakeMap()
    const recoveredMap = new FakeMap()
    const cleanupFailure = new Error('A map release failed')
    firstMap.remove.mockImplementation(() => { throw cleanupFailure })
    const maps = [firstMap, recoveredMap]
    const first = createComposition()
    const recovered = createComposition()
    const composition: SharedMapSceneRendererComposition = {
      renderer: {} as never,
      createLayer: vi.fn()
        .mockReturnValueOnce(first.layer)
        .mockReturnValueOnce(recovered.layer),
      failActiveLayer: vi.fn(),
    }
    const createMap = vi.fn(async () => maps[createMap.mock.calls.length - 1] as unknown as WorkspaceActivationMap)
    const { coordinator, runtime } = createCoordinator({ createMap, composition })

    await coordinator.activate(createActivationSnapshot())
    await expect(coordinator.activate(createActivationSnapshot())).rejects.toBe(cleanupFailure)
    await expect(coordinator.activate(createActivationSnapshot())).resolves.toBe('shared-ready')

    expect(createMap).toHaveBeenCalledTimes(2)
    expect(recoveredMap.remove).not.toHaveBeenCalled()
    expect(runtime.init).toHaveBeenCalledOnce()
  })

  it('reports a stale map release failure without rejecting cancelled activation', async () => {
    const created = deferred<WorkspaceActivationMap>()
    let capturedSignal: AbortSignal | null = null
    const { coordinator } = createCoordinator({
      createMap: (signal) => {
        capturedSignal = signal
        return created.promise
      },
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const activation = coordinator.activate()
    await vi.waitFor(() => expect(capturedSignal).not.toBeNull())
    await coordinator.teardown()
    const staleMap = new FakeMap()
    staleMap.remove.mockImplementation(() => { throw new Error('stale remove failed') })

    created.resolve(staleMap as unknown as WorkspaceActivationMap)

    await expect(activation).resolves.toBe('cancelled')
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to release stale MapLibre workspace map:',
      expect.any(Error),
    )
    consoleError.mockRestore()
  })

  it('makes repeated active teardown idempotent', async () => {
    const { coordinator, runtime, map, mapControls } = createCoordinator()
    await coordinator.activate()

    await coordinator.teardown()
    await coordinator.teardown()

    expect(map.remove).toHaveBeenCalledOnce()
    expect(mapControls.releaseMap).toHaveBeenCalledOnce()
    expect(mapControls.releaseMap).toHaveBeenCalledWith(map)
    expect(runtime.destroy).toHaveBeenCalledOnce()
  })

  it('attempts every teardown cleanup even when each resource cleanup fails', async () => {
    const map = new FakeMap()
    map.remove.mockImplementation(() => { throw new Error('remove failed') })
    map.off.mockImplementation(() => { throw new Error('detach failed') })
    const composed = createComposition({ dispose: async () => { throw new Error('dispose failed') } })
    const runtime = createRuntime()
    runtime.destroy = vi.fn(() => { throw new Error('destroy failed') })
    const unwatchFailure = vi.fn(() => { throw new Error('unwatch failed') })
    const { coordinator } = createCoordinator({
      map, composition: composed.composition, runtime, unwatchFailure,
    })
    await coordinator.activate()

    await expect(coordinator.teardown()).rejects.toThrow('Shared workspace teardown failed')

    expect(unwatchFailure).toHaveBeenCalledOnce()
    expect(map.off).toHaveBeenCalledTimes(2)
    expect(composed.dispose).toHaveBeenCalledOnce()
    expect(map.remove).toHaveBeenCalledOnce()
    expect(runtime.destroy).toHaveBeenCalledOnce()
  })

  it('rejects shared activation when runtime initialization itself fails', async () => {
    const runtime = createRuntime()
    const failure = new Error('runtime init failed')
    runtime.init = vi.fn(async () => { throw failure })
    const { coordinator, map } = createCoordinator({ runtime })

    await expect(coordinator.activate()).rejects.toBe(failure)

    expect(runtime.reportRendererFailure).not.toHaveBeenCalled()
    expect(map.remove).toHaveBeenCalledOnce()
    expect(runtime.destroy).toHaveBeenCalledOnce()
  })

  it('records a synchronous runtime initialization throw without retrying it', async () => {
    const runtime = createRuntime()
    const failure = new Error('runtime init threw synchronously')
    runtime.init = vi.fn(() => { throw failure })
    const { coordinator, map } = createCoordinator({ runtime })

    await expect(coordinator.activate()).rejects.toBe(failure)

    expect(runtime.init).toHaveBeenCalledOnce()
    expect(runtime.destroy).toHaveBeenCalledOnce()
    expect(map.remove).toHaveBeenCalledOnce()
  })

  it('retains cleanup and destroy failures when fallback initialization rejects', async () => {
    const runtime = createRuntime()
    const initializationError = new Error('fallback init failed')
    runtime.init = vi.fn(async () => { throw initializationError })
    const destroyError = new Error('fallback destroy failed')
    runtime.destroy = vi.fn(() => { throw destroyError })
    const map = new FakeMap()
    const cleanupError = new Error('map removal failed')
    map.remove.mockImplementation(() => { throw cleanupError })
    const { coordinator } = createCoordinator({ map, runtime, context: null })

    await expect(coordinator.activate()).rejects.toMatchObject({
      name: 'CanvasRuntimeCleanupError',
      errors: expect.arrayContaining([cleanupError, initializationError, destroyError]),
    })
    expect(runtime.init).toHaveBeenCalledOnce()
    expect(runtime.destroy).toHaveBeenCalledOnce()
  })

  it('turns a renderer cancellation during teardown into a cancelled activation result', async () => {
    const rendererFailure = deferred<void>()
    const runtime = createRuntime()
    runtime.reportRendererFailure = vi.fn(() => rendererFailure.promise)
    const { coordinator } = createCoordinator({ runtime })
    await coordinator.activate()

    const failure = coordinator.reportFailure(new Error('context lost'))
    await Promise.resolve()
    const teardown = coordinator.teardown()
    rendererFailure.reject(new Error('renderer lifecycle cancelled'))

    await expect(failure).resolves.toBe('cancelled')
    await expect(teardown).resolves.toBeUndefined()
  })

  it('does not start a deferred renderer failover after same-turn teardown', async () => {
    const { coordinator, runtime } = createCoordinator()
    await coordinator.activate()

    const failure = coordinator.reportFailure(new Error('context lost'))
    const teardown = coordinator.teardown()

    await expect(failure).resolves.toBe('cancelled')
    await expect(teardown).resolves.toBeUndefined()
    expect(runtime.reportRendererFailure).not.toHaveBeenCalled()
    expect(runtime.destroy).toHaveBeenCalledOnce()
  })

  it('sinks a rejected camera callback failover while public failure reports still reject', async () => {
    const runtime = createRuntime()
    const failure = new Error('fallback renderer failed')
    runtime.reportRendererFailure = vi.fn(async () => { throw failure })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { coordinator, map } = createCoordinator({ runtime })
    await coordinator.activate()

    map.pitch = 1
    map.emit('move')
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledWith(
      'Shared workspace callback failover failed:', failure,
    ))
    await expect(coordinator.reportFailure(failure)).rejects.toBe(failure)
    consoleError.mockRestore()
  })

  it('uses a real SceneCanvasRuntime and shared composition without adding a runtime canvas', async () => {
    const map = new FakeMap()
    const camera = new MapLibreWorkspaceCameraOwner()
    camera.initialize({ width: 400, height: 300 })
    const composition = createSharedMapSceneRendererComposition()
    const runtime = new SceneCanvasRuntime({
      camera,
      renderer: {
        capabilities: TEST_CAPABILITIES,
        backends: [composition.renderer, createCanvas2DSceneRenderer()],
      },
    })
    const container = document.createElement('div')
    Object.defineProperties(container, { clientWidth: { value: 400 }, clientHeight: { value: 300 } })
    const renderer: SharedPixiRenderer = {
      init: vi.fn(async () => {}), render: vi.fn(), resize: vi.fn(), resetState: vi.fn(),
      destroy: vi.fn(), context: { extensions: {} },
    }
    const coordinator = new WorkspaceActivationCoordinator({
      container, runtime, camera, composition,
      map: {
        createMap: async () => map as unknown as WorkspaceActivationMap,
        releaseMap: () => map.remove(),
        getWebGL2Context: () => map.context,
        updateMapContributions: () => {},
        updateBasemapPresentation: () => {},
        installStyleRestorer: () => () => {},
      },
      layer: {
        createRenderer: () => renderer,
        createStage: () => ({ destroy: vi.fn() }) as never,
        createPresentation: () => ({ dispose() {}, resize() {}, setViewport() {}, renderScene() {} }),
      },
    })

    await expect(coordinator.activate(createActivationSnapshot())).resolves.toBe('shared-ready')
    expect(map.addLayer).toHaveBeenCalledOnce()
    expect(container.querySelector('[data-canopi-renderer]')).toBeNull()

    await coordinator.teardown()
  })
})
