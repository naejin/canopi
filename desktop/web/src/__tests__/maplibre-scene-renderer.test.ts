import { describe, expect, it, vi } from 'vitest'
import {
  MAPLIBRE_SCENE_RENDERER_ID,
  MapLibreSceneRendererBridge,
  type MapLibreSceneRenderTarget,
} from '../canvas/runtime/renderers/maplibre-scene'
import type { SceneRendererSnapshot } from '../canvas/runtime/renderers/scene-types'
import { createSharedMapSceneRendererComposition } from '../maplibre/shared-scene-renderer'
import type { SharedMapSceneMap, SharedPixiRenderer } from '../maplibre/shared-scene-layer'
import { createTestSceneRendererSnapshot } from './support/scene-renderer-snapshot'

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
    )
    const snapshot = createTestSceneRendererSnapshot()

    instance.renderScene(snapshot)
    instance.setViewport({ x: 80, y: 90, scale: 10 })

    expect(target.setSnapshot).toHaveBeenCalledExactlyOnceWith(snapshot)
    expect(target.requestRender).toHaveBeenCalledOnce()
    expect(requestFrame).not.toHaveBeenCalled()
    requestFrame.mockRestore()
  })

  it('ignores a stale disconnect after target replacement', async () => {
    const bridge = new MapLibreSceneRendererBridge()
    const firstTarget = createTarget()
    const firstConnection = bridge.connect(firstTarget)
    const secondTarget = createTarget()
    bridge.connect(secondTarget)
    const instance = await bridge.createRenderer().initialize(
      { container: document.createElement('div') },
    )

    firstConnection.disconnect()
    const snapshot = createTestSceneRendererSnapshot()
    instance.renderScene(snapshot)

    expect(firstTarget.setSnapshot).not.toHaveBeenCalled()
    expect(secondTarget.setSnapshot).toHaveBeenCalledExactlyOnceWith(snapshot)
  })

  it('offers exactly one renderer with no selection or fallback metadata', () => {
    const composition = createSharedMapSceneRendererComposition()

    expect(composition.renderer.id).toBe(MAPLIBRE_SCENE_RENDERER_ID)
    expect(MAPLIBRE_SCENE_RENDERER_ID).toBe('maplibre-pixi')
    expect(Object.keys(composition.renderer).sort()).toEqual(['id', 'initialize'])
    expect(Object.keys(composition).sort()).toEqual(['createLayer', 'renderer'])
  })

  it('reports custom-layer failure to the layer owner instead of swapping renderers', async () => {
    const composition = createSharedMapSceneRendererComposition()
    const onFailure = vi.fn()
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
      id: 'design', readOrigin: () => ({ lat: 0, lon: 0 }), onFailure,
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
    const active = await composition.renderer.initialize({ container: document.createElement('div') })
    const snapshot = createTestSceneRendererSnapshot()
    active.renderScene(snapshot)
    layer.layer.render(gl, {} as never)

    expect(onFailure).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'shared scene failed' }))
    // The renderer keeps publishing; the workspace coordinator owns unmounting it.
    expect(() => active.renderScene(snapshot)).not.toThrow()
    await layer.dispose({ mapWillBeRemoved: true })
    await active.dispose()
  })

  it('unregisters runtime ownership without disposing the map-owned target', async () => {
    const bridge = new MapLibreSceneRendererBridge()
    const disposeTarget = vi.fn()
    const target = { ...createTarget(), dispose: disposeTarget }
    bridge.connect(target)
    const instance = await bridge.createRenderer().initialize(
      { container: document.createElement('div') },
    )
    instance.renderScene(createTestSceneRendererSnapshot())

    await instance.dispose()
    const replacement = createTarget()
    bridge.connect(replacement)

    expect(replacement.setSnapshot).not.toHaveBeenCalled()
    expect(disposeTarget).not.toHaveBeenCalled()
  })
})
