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
import { type SharedMapSceneLayer, type SharedPixiRenderer } from '../../maplibre/shared-scene-layer'
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
  readonly addLayer = vi.fn((layer: { onAdd?: (map: unknown, context: WebGL2RenderingContext) => void }) => {
    layer.onAdd?.(this, this.context)
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
      id: 'shared-scene', type: 'custom', renderingMode: '2d',
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
  createMap?: () => Promise<WorkspaceActivationMap>
  composition?: ReturnType<typeof createComposition>['composition']
  runtime?: WorkspaceActivationRuntime
  context?: WebGL2RenderingContext | null
  unwatchFailure?: () => void
  watchFailure?: WorkspaceActivationMapControls['watchFailure']
} = {}) {
  const map = input.map ?? new FakeMap()
  const camera = new MapLibreWorkspaceCameraOwner()
  camera.initialize({ width: 400, height: 300 })
  const runtime = input.runtime ?? createRuntime()
  const composition = input.composition ?? createComposition().composition
  const coordinator = new WorkspaceActivationCoordinator({
    container: document.createElement('div'), runtime, camera, composition,
    map: {
      createMap: input.createMap ?? (async () => map as unknown as WorkspaceActivationMap),
      getWebGL2Context: () => input.context === undefined ? map.context : input.context,
      watchFailure: input.watchFailure
        ?? (input.unwatchFailure ? () => input.unwatchFailure! : undefined),
    },
    layer: { id: 'shared-scene', anchor: { lat: 0, lon: 0 }, northBearingDeg: 0 },
  })
  return { coordinator, camera, composition, runtime, map }
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
    expect(map.addLayer).toHaveBeenCalledOnce()
    expect(runtime.init).toHaveBeenCalledOnce()
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
    const { coordinator, runtime } = createCoordinator({ createMap: () => created.promise })
    const activation = coordinator.activate()

    await coordinator.teardown()
    const staleMap = new FakeMap()
    created.resolve(staleMap as unknown as WorkspaceActivationMap)

    await expect(activation).resolves.toBe('cancelled')
    await coordinator.teardown()
    expect(staleMap.remove).toHaveBeenCalledOnce()
    expect(runtime.init).not.toHaveBeenCalled()
  })

  it('reports a stale map removal failure without rejecting cancelled activation', async () => {
    const created = deferred<WorkspaceActivationMap>()
    const { coordinator } = createCoordinator({ createMap: () => created.promise })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const activation = coordinator.activate()
    await coordinator.teardown()
    const staleMap = new FakeMap()
    staleMap.remove.mockImplementation(() => { throw new Error('stale remove failed') })

    created.resolve(staleMap as unknown as WorkspaceActivationMap)

    await expect(activation).resolves.toBe('cancelled')
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to remove stale MapLibre workspace map:',
      expect.any(Error),
    )
    consoleError.mockRestore()
  })

  it('makes repeated active teardown idempotent', async () => {
    const { coordinator, runtime, map } = createCoordinator()
    await coordinator.activate()

    await coordinator.teardown()
    await coordinator.teardown()

    expect(map.remove).toHaveBeenCalledOnce()
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
        getWebGL2Context: () => map.context,
      },
      layer: {
        id: 'shared-scene', anchor: { lat: 0, lon: 0 }, northBearingDeg: 0,
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
