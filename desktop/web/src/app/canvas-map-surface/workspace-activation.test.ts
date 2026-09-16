import { describe, expect, it, vi } from 'vitest'
import {
  WorkspaceActivationCoordinator,
  type WorkspaceActivationMap,
  type WorkspaceActivationMapControls,
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
} = {}) {
  let phase: SharedMapSceneLayer['diagnostics']['phase'] = 'new'
  const dispose = vi.fn(async () => {
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
  createMap?: (signal: AbortSignal) => Promise<WorkspaceActivationMap>
  composition?: SharedMapSceneRendererComposition
  runtime?: WorkspaceActivationRuntime
  context?: WebGL2RenderingContext | null
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
    getWebGL2Context: () => input.context === undefined ? map.context : input.context,
    installStyleRestorer: input.installStyleRestorer ?? vi.fn(() => () => {}),
    watchFailure: input.watchFailure
      ?? (input.unwatchFailure ? () => input.unwatchFailure! : undefined),
  }
  const coordinator = new WorkspaceActivationCoordinator({
    container: document.createElement('div'), runtime, camera, composition,
    map: mapControls,
    layer: { anchor: { lat: 0, lon: 0 }, northBearingDeg: 0 },
  })
  return { coordinator, camera, composition, runtime, map, mapControls }
}

describe('WorkspaceActivationCoordinator', () => {
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
    const createMap = vi.fn(async (signal: AbortSignal) => {
      signals.push(signal)
      return maps[signals.length - 1] as unknown as WorkspaceActivationMap
    })
    const { coordinator, mapControls } = createCoordinator({ createMap, composition })
    await expect(coordinator.activate()).resolves.toBe('shared-ready')

    const superseded = coordinator.activate()
    await vi.waitFor(() => expect(first.dispose).toHaveBeenCalledOnce())
    const latest = coordinator.activate()

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
        installStyleRestorer: () => () => {},
      },
      layer: {
        anchor: { lat: 0, lon: 0 }, northBearingDeg: 0,
        createRenderer: () => renderer,
        createStage: () => ({ destroy: vi.fn() }) as never,
        createPresentation: () => ({ dispose() {}, resize() {}, setViewport() {}, renderScene() {} }),
      },
    })

    await expect(coordinator.activate()).resolves.toBe('shared-ready')
    expect(map.addLayer).toHaveBeenCalledOnce()
    expect(container.querySelector('[data-canopi-renderer]')).toBeNull()

    await coordinator.teardown()
  })
})
