import { describe, expect, it, vi } from 'vitest'
import { RendererHost } from '../canvas/runtime/renderers/host'
import {
  MAPLIBRE_SCENE_RENDERER_ID,
  MapLibreSceneRendererBridge,
  type MapLibreSceneRenderTarget,
} from '../canvas/runtime/renderers/maplibre-scene'
import type {
  SceneRendererContext,
  SceneRendererDefinition,
  SceneRendererInstance,
  SceneRendererSnapshot,
} from '../canvas/runtime/renderers/scene-types'
import type { RendererCapabilities } from '../canvas/runtime/renderers/types'
import { createSharedMapSceneRendererComposition } from '../maplibre/shared-scene-renderer'
import type { SharedMapSceneMap, SharedPixiRenderer } from '../maplibre/shared-scene-layer'
import { createTestSceneRendererSnapshot } from './support/scene-renderer-snapshot'

const TEST_CAPABILITIES: RendererCapabilities = {
  domCanvas: true,
  canvas2d: true,
  offscreenCanvas: false,
  offscreenCanvas2d: false,
  webgl: true,
  webgl2: true,
  webgpu: false,
  imageBitmap: false,
  createImageBitmap: false,
  worker: false,
  devicePixelRatio: 2,
  prefersReducedMotion: false,
}

function createTarget() {
  const target = {
    setSnapshot: vi.fn<(snapshot: SceneRendererSnapshot) => void>(),
    requestRender: vi.fn<() => void>(),
  } satisfies MapLibreSceneRenderTarget
  return target
}

describe('MapLibre scene renderer bridge', () => {
  it('queues the latest scene until a map-owned target connects', async () => {
    const bridge = new MapLibreSceneRendererBridge()
    const container = document.createElement('div')
    const instance = await bridge.createRenderer().initialize(
      { container },
      { capabilities: TEST_CAPABILITIES, backendId: MAPLIBRE_SCENE_RENDERER_ID },
    )
    const first = createTestSceneRendererSnapshot()
    const latest = createTestSceneRendererSnapshot({
      viewport: { x: 30, y: 40, scale: 5 },
    })

    instance.renderScene(first)
    instance.renderScene(latest)
    const target = createTarget()
    bridge.connect(target)

    expect(target.setSnapshot).toHaveBeenCalledExactlyOnceWith(latest)
    expect(container.querySelector('canvas')).toBeNull()
  })

  it('asks MapLibre for camera-only frames without republishing scene content', async () => {
    const bridge = new MapLibreSceneRendererBridge()
    const target = createTarget()
    bridge.connect(target)
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame')
    const instance = await bridge.createRenderer().initialize(
      { container: document.createElement('div') },
      { capabilities: TEST_CAPABILITIES, backendId: MAPLIBRE_SCENE_RENDERER_ID },
    )
    const snapshot = createTestSceneRendererSnapshot()

    instance.renderScene(snapshot)
    instance.setViewport({ x: 80, y: 90, scale: 10 })

    expect(target.setSnapshot).toHaveBeenCalledExactlyOnceWith(snapshot)
    expect(target.requestRender).toHaveBeenCalledOnce()
    expect(requestFrame).not.toHaveBeenCalled()
    requestFrame.mockRestore()
  })

  it('ignores stale disconnect and failure notifications after target replacement', async () => {
    const bridge = new MapLibreSceneRendererBridge()
    const firstTarget = createTarget()
    const firstConnection = bridge.connect(firstTarget)
    const secondTarget = createTarget()
    bridge.connect(secondTarget)
    const instance = await bridge.createRenderer().initialize(
      { container: document.createElement('div') },
      { capabilities: TEST_CAPABILITIES, backendId: MAPLIBRE_SCENE_RENDERER_ID },
    )

    firstConnection.fail(new Error('stale map failed'))
    firstConnection.disconnect()
    const snapshot = createTestSceneRendererSnapshot()
    instance.renderScene(snapshot)

    expect(firstTarget.setSnapshot).not.toHaveBeenCalled()
    expect(secondTarget.setSnapshot).toHaveBeenCalledExactlyOnceWith(snapshot)
  })

  it('surfaces an active target failure through RendererHost failover', async () => {
    const bridge = new MapLibreSceneRendererBridge()
    const target = createTarget()
    const connection = bridge.connect(target)
    const fallbackRenderScene = vi.fn()
    const fallbackDispose = vi.fn()
    const fallback: SceneRendererDefinition = {
      id: 'canvas2d',
      initialize: async (): Promise<SceneRendererInstance> => ({
        id: 'canvas2d',
        dispose: fallbackDispose,
        resize: vi.fn(),
        renderScene: fallbackRenderScene,
        setViewport: vi.fn(),
      }),
    }
    const host = new RendererHost<SceneRendererContext, SceneRendererInstance>({
      capabilities: TEST_CAPABILITIES,
      backends: [bridge.createRenderer(), fallback],
    })
    await host.initialize({ container: document.createElement('div') })
    connection.fail(new Error('map context was lost'))
    const snapshot = createTestSceneRendererSnapshot()

    await host.run((renderer) => renderer.renderScene(snapshot))

    expect(host.snapshot.activeBackendId).toBe('canvas2d')
    expect(host.snapshot.failedBackendIds).toEqual([MAPLIBRE_SCENE_RENDERER_ID])
    expect(fallbackRenderScene).toHaveBeenCalledExactlyOnceWith(snapshot)
    expect(fallbackDispose).not.toHaveBeenCalled()
  })

  it('composes custom-layer failure into RendererHost failover', async () => {
    const composition = createSharedMapSceneRendererComposition()
    const fallbackRenderScene = vi.fn()
    const fallback: SceneRendererDefinition = {
      id: 'canvas2d',
      initialize: async (): Promise<SceneRendererInstance> => ({
        id: 'canvas2d', dispose: vi.fn(), resize: vi.fn(),
        renderScene: fallbackRenderScene, setViewport: vi.fn(),
      }),
    }
    const host = new RendererHost<SceneRendererContext, SceneRendererInstance>({
      capabilities: TEST_CAPABILITIES,
      backends: [composition.renderer, fallback],
    })
    const canvas = document.createElement('canvas')
    Object.defineProperties(canvas, {
      clientWidth: { value: 200 }, clientHeight: { value: 100 },
      width: { value: 400, writable: true }, height: { value: 200, writable: true },
    })
    const map = {
      getCanvas: () => canvas,
      getPitch: () => 0,
      triggerRepaint: vi.fn(),
      project: vi.fn()
        .mockReturnValueOnce({ x: 40, y: 30 })
        .mockReturnValueOnce({ x: 44, y: 30 })
        .mockReturnValueOnce({ x: 40, y: 34 }),
    } satisfies SharedMapSceneMap
    const renderer: SharedPixiRenderer = {
      init: vi.fn(async () => {}), render: vi.fn(), resize: vi.fn(), resetState: vi.fn(),
      destroy: vi.fn(), context: { extensions: { loseContext: { loseContext: vi.fn() } } },
    }
    const layer = composition.createLayer({
      id: 'design', anchor: { lat: 0, lon: 0 }, northBearingDeg: 0,
      createRenderer: () => renderer,
      createStage: () => ({ destroy: vi.fn() }) as never,
      createPresentation: () => ({
        dispose() {}, resize() {}, setViewport() {},
        renderScene() { throw new Error('shared scene failed') },
      }),
    })
    const gl = {} as WebGL2RenderingContext
    await layer.initialize(map, gl)
    layer.layer.onAdd!(map as never, gl)
    await host.initialize({ container: document.createElement('div') })
    const snapshot = createTestSceneRendererSnapshot()
    await host.run((active) => active.renderScene(snapshot))
    layer.layer.render(gl, {} as never)

    await host.run((active) => active.renderScene(snapshot))

    expect(host.snapshot.activeBackendId).toBe('canvas2d')
    expect(fallbackRenderScene).toHaveBeenCalledExactlyOnceWith(snapshot)
    await layer.dispose({ mapWillBeRemoved: true })
    await host.dispose()
  })

  it('surfaces map construction failure before layer initialization', async () => {
    const composition = createSharedMapSceneRendererComposition()
    const fallbackRenderScene = vi.fn()
    const host = new RendererHost<SceneRendererContext, SceneRendererInstance>({
      capabilities: TEST_CAPABILITIES,
      backends: [composition.renderer, {
        id: 'canvas2d',
        initialize: async () => ({
          id: 'canvas2d', dispose: vi.fn(), resize: vi.fn(),
          renderScene: fallbackRenderScene, setViewport: vi.fn(),
        }),
      }],
    })
    const layer = composition.createLayer({
      id: 'design', anchor: { lat: 0, lon: 0 }, northBearingDeg: 0,
    })
    await host.initialize({ container: document.createElement('div') })
    composition.failActiveLayer(new Error('MapLibre failed to start'))
    const snapshot = createTestSceneRendererSnapshot()

    await host.run((active) => active.renderScene(snapshot))

    expect(host.snapshot.activeBackendId).toBe('canvas2d')
    expect(fallbackRenderScene).toHaveBeenCalledExactlyOnceWith(snapshot)
    await layer.dispose({ mapWillBeRemoved: true })
    await host.dispose()
  })

  it('retains an admission failure that happens before any layer target connects', async () => {
    const composition = createSharedMapSceneRendererComposition()
    const fallbackRenderScene = vi.fn()
    const host = new RendererHost<SceneRendererContext, SceneRendererInstance>({
      capabilities: TEST_CAPABILITIES,
      backends: [composition.renderer, {
        id: 'canvas2d',
        initialize: async () => ({
          id: 'canvas2d', dispose: vi.fn(), resize: vi.fn(),
          renderScene: fallbackRenderScene, setViewport: vi.fn(),
        }),
      }],
    })
    composition.failActiveLayer(new Error('WebGL2 context unavailable'))
    await host.initialize({ container: document.createElement('div') })
    const snapshot = createTestSceneRendererSnapshot()

    await host.run((active) => active.renderScene(snapshot))

    expect(host.snapshot.activeBackendId).toBe('canvas2d')
    expect(fallbackRenderScene).toHaveBeenCalledExactlyOnceWith(snapshot)
    await host.dispose()
  })

  it('unregisters runtime ownership without disposing the map-owned target', async () => {
    const bridge = new MapLibreSceneRendererBridge()
    const disposeTarget = vi.fn()
    const target = { ...createTarget(), dispose: disposeTarget }
    bridge.connect(target)
    const instance = await bridge.createRenderer().initialize(
      { container: document.createElement('div') },
      { capabilities: TEST_CAPABILITIES, backendId: MAPLIBRE_SCENE_RENDERER_ID },
    )
    instance.renderScene(createTestSceneRendererSnapshot())

    await instance.dispose()
    const replacement = createTarget()
    bridge.connect(replacement)

    expect(replacement.setSnapshot).not.toHaveBeenCalled()
    expect(disposeTarget).not.toHaveBeenCalled()
  })
})
