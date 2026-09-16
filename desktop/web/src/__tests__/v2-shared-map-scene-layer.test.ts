import { describe, expect, it, vi } from 'vitest'
import { createSharedMapSceneLayer, type SharedMapSceneMap, type SharedPixiRenderer } from '../maplibre/shared-scene-layer'
import { createTestSceneRendererSnapshot } from './support/scene-renderer-snapshot'

function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  Object.defineProperties(canvas, {
    clientWidth: { value: 200, writable: true },
    clientHeight: { value: 100, writable: true },
    width: { value: 400, writable: true },
    height: { value: 200, writable: true },
  })
  return canvas
}

function createMap(canvas: HTMLCanvasElement): SharedMapSceneMap {
  let projectIndex = 0
  const points = [{ x: 40, y: 30 }, { x: 44, y: 30 }, { x: 40, y: 34 }]
  return {
    getCanvas: () => canvas,
    getPitch: () => 0,
    project: () => points[projectIndex++ % points.length]!,
    triggerRepaint: vi.fn(),
  }
}

function createRenderer(init = vi.fn(async () => {})): SharedPixiRenderer {
  return {
    init,
    render: vi.fn(),
    resize: vi.fn(),
    resetState: vi.fn(),
    destroy: vi.fn(),
    context: { extensions: { loseContext: { loseContext: vi.fn() } } },
  }
}

describe('createSharedMapSceneLayer', () => {
  it('draws only in MapLibre render after an explicit initialization and repaint request', async () => {
    const canvas = createCanvas()
    const map = createMap(canvas)
    const renderer = createRenderer()
    const presentation = { dispose: vi.fn(), resize: vi.fn(), renderScene: vi.fn(), setViewport: vi.fn() }
    const adapter = createSharedMapSceneLayer({
      id: 'v2-scene',
      anchor: { lat: 0, lon: 0 },
      northBearingDeg: 0,
      createRenderer: () => renderer,
      createStage: () => ({ destroy: vi.fn() }) as never,
      createPresentation: () => presentation,
    })
    const gl = {} as WebGL2RenderingContext

    await adapter.initialize(map, gl)
    adapter.setSnapshot(createTestSceneRendererSnapshot())
    expect(map.triggerRepaint).toHaveBeenCalledOnce()
    expect(renderer.render).not.toHaveBeenCalled()

    adapter.layer.onAdd!(map as never, gl)
    adapter.requestRender()
    expect(map.triggerRepaint).toHaveBeenCalledTimes(2)
    adapter.layer.render(gl, {} as never)

    expect(presentation.renderScene).toHaveBeenCalledWith(expect.objectContaining({ viewport: { x: 40, y: 30, scale: 4 } }))
    expect(renderer.render).toHaveBeenCalledWith(expect.objectContaining({ clear: false }))
    expect(renderer.resetState).toHaveBeenCalledOnce()

    adapter.layer.render(gl, {} as never)
    expect(presentation.renderScene).toHaveBeenCalledOnce()
    expect(presentation.setViewport).not.toHaveBeenCalled()
    expect(adapter.diagnostics).toMatchObject({
      phase: 'attached', initializeCount: 1, renderCount: 2,
      sceneSyncCount: 1, viewportSyncCount: 0, repaintCount: 2,
    })
  })

  it('resynchronizes presentation after a MapLibre-owned resize even when the camera is unchanged', async () => {
    const canvas = createCanvas()
    const map = createMap(canvas)
    const renderer = createRenderer()
    const presentation = { dispose: vi.fn(), resize: vi.fn(), renderScene: vi.fn(), setViewport: vi.fn() }
    const adapter = createSharedMapSceneLayer({
      id: 'v2-scene', anchor: { lat: 0, lon: 0 }, northBearingDeg: 0, createRenderer: () => renderer,
      createStage: () => ({ destroy: vi.fn() }) as never,
      createPresentation: () => presentation,
    })
    const gl = {} as WebGL2RenderingContext
    await adapter.initialize(map, gl)
    adapter.layer.onAdd!(map as never, gl)
    adapter.setSnapshot(createTestSceneRendererSnapshot())
    adapter.layer.render(gl, {} as never)

    ;(canvas as unknown as { clientWidth: number; clientHeight: number }).clientWidth = 300
    ;(canvas as unknown as { clientWidth: number; clientHeight: number }).clientHeight = 150
    canvas.width = 600
    canvas.height = 300
    adapter.layer.render(gl, {} as never)

    expect(presentation.setViewport).toHaveBeenCalledOnce()
    expect(adapter.diagnostics).toMatchObject({ renderCount: 2, sceneSyncCount: 1, viewportSyncCount: 1, resizeCount: 1 })
    const disposal = adapter.dispose()
    adapter.layer.render(gl, {} as never)
    await disposal
  })

  it('survives style reload detach and reattach without duplicate initialization', async () => {
    const canvas = createCanvas()
    const map = createMap(canvas)
    const renderer = createRenderer()
    const remove = vi.spyOn(canvas, 'remove')
    const adapter = createSharedMapSceneLayer({
      id: 'v2-scene', anchor: { lat: 0, lon: 0 }, northBearingDeg: 0, createRenderer: () => renderer,
      createStage: () => ({ destroy: vi.fn() }) as never,
      createPresentation: () => ({ dispose() {}, resize() {}, renderScene() {}, setViewport() {} }),
    })
    const gl = {} as WebGL2RenderingContext

    await adapter.initialize(map, gl)
    adapter.layer.onAdd!(map as never, gl)
    adapter.layer.onRemove!(map as never, gl)
    adapter.layer.onAdd!(map as never, gl)
    await adapter.initialize(map, gl)
    const disposal = adapter.dispose()
    expect(renderer.destroy).not.toHaveBeenCalled()
    adapter.layer.render(gl, {} as never)
    await disposal
    await adapter.dispose()

    expect(renderer.init).toHaveBeenCalledOnce()
    expect(renderer.destroy).toHaveBeenCalledOnce()
    expect(renderer.context.extensions.loseContext).toBeUndefined()
    expect(remove).not.toHaveBeenCalled()
    expect(adapter.diagnostics).toMatchObject({ phase: 'disposed', initializeCount: 1, disposeCount: 1 })
  })

  it('disposes an initialization that completes after its final owner has gone away', async () => {
    let resolveInit: (() => void) | undefined
    const renderer = createRenderer(vi.fn(() => new Promise<void>(resolve => { resolveInit = resolve })))
    const adapter = createSharedMapSceneLayer({
      id: 'v2-scene', anchor: { lat: 0, lon: 0 }, northBearingDeg: 0, createRenderer: () => renderer,
      createStage: () => ({ destroy: vi.fn() }) as never,
      createPresentation: () => ({ dispose() {}, resize() {}, renderScene() {}, setViewport() {} }),
    })
    const canvas = createCanvas()
    const initialize = adapter.initialize(createMap(canvas), {} as WebGL2RenderingContext)
    const disposal = adapter.dispose({ mapWillBeRemoved: true })
    resolveInit!()
    await initialize
    await disposal

    expect(renderer.destroy).toHaveBeenCalledOnce()
    expect(adapter.diagnostics).toMatchObject({ phase: 'disposed', disposeCount: 1 })
  })

  it('lets MapLibre resize first without changing its backing dimensions', async () => {
    const canvas = createCanvas()
    const map = createMap(canvas)
    const renderer = createRenderer()
    const presentation = { dispose: vi.fn(), resize: vi.fn(), renderScene: vi.fn(), setViewport: vi.fn() }
    const adapter = createSharedMapSceneLayer({
      id: 'v2-scene', anchor: { lat: 0, lon: 0 }, northBearingDeg: 0, createRenderer: () => renderer,
      createStage: () => ({ destroy: vi.fn() }) as never,
      createPresentation: () => presentation,
    })
    const gl = {} as WebGL2RenderingContext
    await adapter.initialize(map, gl)
    adapter.layer.onAdd!(map as never, gl)
    adapter.setSnapshot(createTestSceneRendererSnapshot())

    ;(canvas as unknown as { clientWidth: number; clientHeight: number }).clientWidth = 300
    ;(canvas as unknown as { clientWidth: number; clientHeight: number }).clientHeight = 150
    canvas.width = 600
    canvas.height = 300
    adapter.layer.render(gl, {} as never)

    expect(renderer.resize).toHaveBeenCalledWith(300, 150, expect.closeTo(2, 3))
    expect(canvas.width).toBe(600)
    expect(canvas.height).toBe(300)
    expect(presentation.resize).toHaveBeenCalledWith(300, 150)
    expect(adapter.diagnostics.resizeCount).toBe(1)

    const disposal = adapter.dispose()
    adapter.layer.render(gl, {} as never)
    await disposal
  })

  it('requires a detached owner to declare immediate MapLibre removal', async () => {
    const canvas = createCanvas()
    const renderer = createRenderer()
    const adapter = createSharedMapSceneLayer({
      id: 'v2-scene', anchor: { lat: 0, lon: 0 }, northBearingDeg: 0, createRenderer: () => renderer,
      createStage: () => ({ destroy: vi.fn() }) as never,
      createPresentation: () => ({ dispose() {}, resize() {}, renderScene() {}, setViewport() {} }),
    })
    await adapter.initialize(createMap(canvas), {} as WebGL2RenderingContext)

    await expect(adapter.dispose()).rejects.toThrow(/MapLibre removal/)
    expect(renderer.destroy).not.toHaveBeenCalled()
    await adapter.dispose({ mapWillBeRemoved: true })
    expect(renderer.destroy).toHaveBeenCalledOnce()
  })

  it('reports a terminal render failure once to the lifecycle owner', async () => {
    const canvas = createCanvas()
    const map = createMap(canvas)
    const renderer = createRenderer()
    const onFailure = vi.fn()
    const adapter = createSharedMapSceneLayer({
      id: 'v2-scene', anchor: { lat: 0, lon: 0 }, northBearingDeg: 0,
      createRenderer: () => renderer,
      createStage: () => ({ destroy: vi.fn() }) as never,
      createPresentation: () => ({
        dispose() {}, resize() {}, setViewport() {},
        renderScene() { throw new Error('presentation failed') },
      }),
      onFailure,
    })
    const gl = {} as WebGL2RenderingContext
    await adapter.initialize(map, gl)
    adapter.layer.onAdd!(map as never, gl)
    adapter.setSnapshot(createTestSceneRendererSnapshot())

    adapter.layer.render(gl, {} as never)
    adapter.layer.render(gl, {} as never)

    expect(onFailure).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      message: 'presentation failed',
    }))
    expect(adapter.diagnostics).toMatchObject({
      phase: 'failed',
      skippedRenderCount: 2,
      lastFailure: 'presentation failed',
    })
    await adapter.dispose({ mapWillBeRemoved: true })
  })
})
