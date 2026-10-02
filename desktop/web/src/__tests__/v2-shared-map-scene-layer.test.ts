import { describe, expect, it, vi } from 'vitest'
import { Ticker, WebGLRenderer, type WebGLOptions } from 'pixi.js'
import {
  createSharedMapSceneLayer,
  sharedPixiRendererInitOptions,
  type SharedMapSceneMap,
  type SharedPixiRenderer,
} from '../maplibre/shared-scene-layer'
import { createSharedMapSceneRendererComposition } from '../maplibre/shared-scene-renderer'
import { SceneRuntimeRenderScheduler } from '../canvas/runtime/scene-runtime/render-scheduler'
import type { DraftPresentation } from '../canvas/runtime/tools/draft'
import { createTestRendererView, createTestSceneRendererSnapshot } from './support/scene-renderer-snapshot'
import { createTestView, type TestView } from './support/test-view'
import './support/camera-tolerance'

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

/** A MapLibre map as the layer sees it; `project` and `getPitch` are there only to show that the layer never asks them. */
function createMap(canvas: HTMLCanvasElement): SharedMapSceneMap & { project: ReturnType<typeof vi.fn>; getPitch: ReturnType<typeof vi.fn> } {
  return {
    getCanvas: () => canvas,
    getPitch: vi.fn(() => 0),
    project: vi.fn(() => ({ x: 0, y: 0 })),
    triggerRepaint: vi.fn(),
  }
}

/** The runtime's camera on the canvas's 200 × 100 CSS px at density 2, plane origin at (40, 30), 4 px/m. */
function createFrames(): TestView {
  return createTestView({ screen: { width: 200, height: 100, devicePixelRatio: 2 }, viewport: { x: 40, y: 30, scale: 4 } })
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
  // ADR 0004: MapLibre owns the canvas's events and the only frame loop. The
  // options are Pixi's real ones (the type check below), so nothing hides
  // behind a cast, and what init installs anyway is detached right after.
  // skipExtensionImports leaves out Pixi's filter extensions, yet the scene's plant layer
  // (layer opacity, species focus dim) and the Place plants and stamp ghosts draw through an
  // AlphaFilter. Without the filter pipe Pixi's render throws, and the map is torn down.
  it('registers Pixi\'s filter system and pipe, which every AlphaFilter of the scene and its drafts needs', () => {
    // The extensions a WebGL renderer is built with; `config` is protected, so a subclass reads it.
    const { renderPipes, systems } = new class extends WebGLRenderer {
      readonly extensionLists = this.config
    }().extensionLists
    expect(renderPipes.map((entry) => entry.name)).toContain('filter')
    expect(systems.map((entry) => entry.name)).toContain('filter')
  })

  it('initializes Pixi for MapLibre\'s context and loop: no extension imports, events, clears or GC, then detaches Pixi from the canvas and stops its ticker', async () => {
    const canvas = createCanvas()
    const map = createMap(canvas)
    const gl = {} as WebGL2RenderingContext
    const options: Partial<WebGLOptions> = sharedPixiRendererInitOptions({ canvas, context: gl, width: 200, height: 100, resolution: 2 })
    expect(options).toEqual({
      canvas, context: gl, width: 200, height: 100, resolution: 2,
      autoDensity: false, antialias: true, backgroundAlpha: 0, clearBeforeRender: false, premultipliedAlpha: true,
      skipExtensionImports: true,
      eventMode: 'none',
      eventFeatures: { move: false, globalMove: false, click: false, wheel: false },
      textureGCActive: false,
      renderableGCActive: false,
    })

    const setTargetElement = vi.fn()
    const renderer: SharedPixiRenderer = { ...createRenderer(), events: { setTargetElement } }
    const adapter = createSharedMapSceneLayer({
      id: 'v2-scene', frames: createFrames().frames, createRenderer: () => renderer,
      createStage: () => ({ destroy: vi.fn() }) as never,
      createPresentation: () => ({ dispose: vi.fn(), resize: vi.fn(), syncScene: vi.fn(), setView: vi.fn(), setDraft: vi.fn() }),
    })
    Ticker.system.start()
    expect(Ticker.system.started).toBe(true)

    await adapter.initialize(map, gl)

    expect(renderer.init).toHaveBeenCalledWith(expect.objectContaining({ canvas, context: gl, skipExtensionImports: true, eventMode: 'none' }))
    expect(setTargetElement).toHaveBeenCalledWith(null)
    expect(Ticker.system.started).toBe(false)
    await adapter.dispose({ mapWillBeRemoved: true })
  })

  it('draws only in MapLibre render after an explicit initialization and repaint request', async () => {
    const canvas = createCanvas()
    const map = createMap(canvas)
    const renderer = createRenderer()
    const presentation = { dispose: vi.fn(), resize: vi.fn(), syncScene: vi.fn(), setView: vi.fn(), setDraft: vi.fn() }
    const adapter = createSharedMapSceneLayer({
      id: 'v2-scene',
      frames: createFrames().frames,
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

    expect(presentation.setView).toHaveBeenCalledOnce()
    expect(presentation.setView.mock.calls[0]![0].planar.affine).toEqual([4, 0, 0, 4, 40, 30])
    expect(presentation.syncScene).toHaveBeenCalledOnce()
    expect(renderer.render).toHaveBeenCalledWith(expect.objectContaining({ clear: false }))
    expect(renderer.resetState).toHaveBeenCalledOnce()

    adapter.layer.render(gl, {} as never)
    expect(presentation.syncScene).toHaveBeenCalledOnce()
    expect(presentation.setView).toHaveBeenCalledOnce()
    expect(adapter.diagnostics).toMatchObject({
      phase: 'attached', initializeCount: 1, renderCount: 2, sceneSyncCount: 1,
    })
  })

  it('rasterizes scene text at twice the MapLibre canvas density', async () => {
    const canvas = createCanvas()
    const map = createMap(canvas)
    let createText: (() => { resolution: number }) | null = null
    const adapter = createSharedMapSceneLayer({
      id: 'v2-scene', frames: createFrames().frames, createRenderer: () => createRenderer(),
      createStage: () => ({ destroy: vi.fn() }) as never,
      createPresentation: (input) => {
        createText = input.createText
        return { dispose() {}, resize() {}, syncScene() {}, setView() {}, setDraft() {} }
      },
    })

    await adapter.initialize(map, {} as WebGL2RenderingContext)

    // 400×200 backing pixels for a 200×100 CSS canvas is a density of 2.
    expect(createText!().resolution).toBe(4)
    await adapter.dispose({ mapWillBeRemoved: true })
  })

  it('the layer never derives a transform', async () => {
    const canvas = createCanvas()
    const map = createMap(canvas)
    const camera = createFrames()
    const presentation = { dispose: vi.fn(), resize: vi.fn(), syncScene: vi.fn(), setView: vi.fn(), setDraft: vi.fn() }
    const adapter = createSharedMapSceneLayer({
      id: 'v2-scene', frames: camera.frames, createRenderer: () => createRenderer(),
      createStage: () => ({ destroy: vi.fn() }) as never,
      createPresentation: () => presentation,
    })
    const gl = {} as WebGL2RenderingContext
    await adapter.initialize(map, gl)
    adapter.layer.onAdd!(map as never, gl)
    adapter.setSnapshot(createTestSceneRendererSnapshot())

    // The frame's own view, in CSS px whatever the canvas density (400 × 200 backing pixels here).
    adapter.layer.render(gl, {} as never)
    expect(presentation.setView).toHaveBeenCalledExactlyOnceWith(camera.view())
    // A pan publishes a frame; the layer takes it on its next render, and nothing else.
    camera.setViewport({ x: 52, y: 18, scale: 4 })
    adapter.layer.render(gl, {} as never)
    expect(presentation.setView).toHaveBeenCalledTimes(2)
    expect(presentation.setView).toHaveBeenLastCalledWith(camera.view())
    adapter.layer.render(gl, {} as never)
    expect(presentation.setView).toHaveBeenCalledTimes(2)

    expect(map.project).not.toHaveBeenCalled()
    expect(map.getPitch).not.toHaveBeenCalled()
    await adapter.dispose({ mapWillBeRemoved: true })
  })

  it('resynchronizes presentation after a MapLibre-owned resize even when the camera is unchanged', async () => {
    const canvas = createCanvas()
    const map = createMap(canvas)
    const renderer = createRenderer()
    const camera = createFrames()
    const presentation = { dispose: vi.fn(), resize: vi.fn(), syncScene: vi.fn(), setView: vi.fn(), setDraft: vi.fn() }
    const adapter = createSharedMapSceneLayer({
      id: 'v2-scene', frames: camera.frames, createRenderer: () => renderer,
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
    // The camera takes the new screen and publishes a frame, the camera itself unchanged.
    camera.host.current().setScreen({ width: 300, height: 150, devicePixelRatio: 2 })
    adapter.layer.render(gl, {} as never)

    expect(presentation.setView).toHaveBeenCalledTimes(2)
    expect(presentation.setView.mock.calls[1]![0].screen).toMatchObject({ width: 300, height: 150 })
    expect(adapter.diagnostics).toMatchObject({ renderCount: 2, sceneSyncCount: 1 })
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
      id: 'v2-scene', frames: createFrames().frames, createRenderer: () => renderer,
      createStage: () => ({ destroy: vi.fn() }) as never,
      createPresentation: () => ({ dispose() {}, resize() {}, syncScene() {}, setView() {}, setDraft() {} }),
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
      id: 'v2-scene', frames: createFrames().frames, createRenderer: () => renderer,
      createStage: () => ({ destroy: vi.fn() }) as never,
      createPresentation: () => ({ dispose() {}, resize() {}, syncScene() {}, setView() {}, setDraft() {} }),
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
    const presentation = { dispose: vi.fn(), resize: vi.fn(), syncScene: vi.fn(), setView: vi.fn(), setDraft: vi.fn() }
    const adapter = createSharedMapSceneLayer({
      id: 'v2-scene', frames: createFrames().frames, createRenderer: () => renderer,
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
    const disposal = adapter.dispose()
    adapter.layer.render(gl, {} as never)
    await disposal
  })

  it('requires a detached owner to declare immediate MapLibre removal', async () => {
    const canvas = createCanvas()
    const renderer = createRenderer()
    const adapter = createSharedMapSceneLayer({
      id: 'v2-scene', frames: createFrames().frames, createRenderer: () => renderer,
      createStage: () => ({ destroy: vi.fn() }) as never,
      createPresentation: () => ({ dispose() {}, resize() {}, syncScene() {}, setView() {}, setDraft() {} }),
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
      id: 'v2-scene', frames: createFrames().frames,
      createRenderer: () => renderer,
      createStage: () => ({ destroy: vi.fn() }) as never,
      createPresentation: () => ({
        dispose() {}, resize() {}, setView() {}, setDraft() {},
        syncScene() { throw new Error('presentation failed') },
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
      lastFailure: 'presentation failed',
    })
    await adapter.dispose({ mapWillBeRemoved: true })
  })

  it('a repaint the presentation asks for outside a render repaints the map (a draft chip\'s font arrived)', async () => {
    const canvas = createCanvas()
    const map = createMap(canvas)
    let requestRepaint: (() => void) | null = null
    const adapter = createSharedMapSceneLayer({
      id: 'v2-scene',
      frames: createFrames().frames,
      createRenderer: () => createRenderer(),
      createStage: () => ({ destroy: vi.fn() }) as never,
      createPresentation: (input) => {
        requestRepaint = input.requestRepaint
        return { dispose: vi.fn(), resize: vi.fn(), syncScene: vi.fn(), setView: vi.fn(), setDraft: vi.fn() }
      },
    })
    await adapter.initialize(map, {} as WebGL2RenderingContext)
    expect(requestRepaint).not.toBeNull()
    requestRepaint!()
    expect(map.triggerRepaint).toHaveBeenCalledOnce()
  })

  it('a tool draft set on the mounted renderer reaches the Pixi draft layer', async () => {
    const composition = createSharedMapSceneRendererComposition()
    const presentation = {
      dispose: vi.fn(), resize: vi.fn(), syncScene: vi.fn(), setView: vi.fn(),
      setDraft: vi.fn(),
    }
    const canvas = createCanvas()
    const map = createMap(canvas)
    const gl = {} as WebGL2RenderingContext
    const layer = composition.createLayer({
      id: 'v2-scene', frames: createFrames().frames, createRenderer: () => createRenderer(),
      createStage: () => ({ destroy: vi.fn() }) as never,
      createPresentation: () => presentation,
    })
    const scheduler = new SceneRuntimeRenderScheduler({
      getRenderer: () => composition.renderer,
      getView: () => createTestRendererView({ x: 0, y: 0, scale: 1 }),
      prepareSceneRender: async () => ({ publish: () => createTestSceneRendererSnapshot() }),
      renderChrome: vi.fn(),
    })
    await scheduler.initialize(document.createElement('div'))
    const draft: DraftPresentation = {
      shapes: [{ kind: 'polyline', points: [{ x: 0, y: 0 }, { x: 4, y: 3 }], style: { token: 'draft', widthPx: 2 } }],
    }

    // Set while the layer is still initializing: the presentation takes it when it exists.
    scheduler.setDraft(draft)
    await layer.initialize(map, gl)
    expect(presentation.setDraft).toHaveBeenCalledExactlyOnceWith(draft)

    layer.layer.onAdd!(map as never, gl)
    const repaints = vi.mocked(map.triggerRepaint).mock.calls.length
    scheduler.setDraft(null)
    expect(presentation.setDraft).toHaveBeenLastCalledWith(null)
    expect(vi.mocked(map.triggerRepaint).mock.calls.length).toBe(repaints + 1)

    // Unmounted, the scheduler has nothing to draw on.
    await scheduler.unmount()
    scheduler.setDraft(draft)
    expect(presentation.setDraft).toHaveBeenCalledTimes(2)
    await layer.dispose({ mapWillBeRemoved: true })
  })
})
