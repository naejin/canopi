import { describe, expect, it, vi } from 'vitest'
import { Container, Text } from 'pixi.js'
import { SceneCanvasRuntime } from './scene-runtime'
import { createPixiScenePresentation } from './renderers/pixi-scene'
import type { SceneRendererSnapshot, SceneRenderTarget } from './renderers/scene-types'
import { createSharedMapSceneRendererComposition } from '../../maplibre/shared-scene-renderer'
import type { SharedMapSceneMap, SharedPixiRenderer } from '../../maplibre/shared-scene-layer'
import { CURRENT_CANOPI_FILE_VERSION } from '../../generated/canopi-design-format'
import type { CanopiFile } from '../../types/design'

/** jsdom has no 2D canvas to measure text with. */
class MeasuredText extends Text {
  override get width(): number { return 40 }
  override set width(_value: number) {}
  override get height(): number { return 16 }
  override set height(_value: number) {}
}

function createContainer(): HTMLElement {
  const container = document.createElement('div')
  Object.defineProperties(container, {
    clientWidth: { value: 800 },
    clientHeight: { value: 600 },
  })
  return container
}

/** One apple tree near Nantes. */
function orchard(): CanopiFile {
  return {
    version: CURRENT_CANOPI_FILE_VERSION,
    name: 'Orchard',
    description: null,
    plant_species_colors: {},
    layers: [],
    plants: [{
      id: 'apple', locked: false, canonical_name: 'Malus domestica', common_name: null, color: null,
      pinned_name: false, position: { lon: -1.5536, lat: 47.2184 }, rotation: null, scale: null, notes: null,
      planted_date: null, quantity: null,
    }],
    zones: [],
    annotations: [],
    consortiums: [],
    groups: [],
    timeline: [],
    budget: [],
    budget_currency: 'EUR',
    created_at: '2026-10-07T00:00:00.000Z',
    updated_at: '2026-10-07T00:00:00.000Z',
  }
}

/** MapLibre's canvas and repaint request, 800 × 600 CSS px at density 1. */
function createMap() {
  const canvas = document.createElement('canvas')
  Object.defineProperties(canvas, {
    clientWidth: { value: 800 }, clientHeight: { value: 600 },
    width: { value: 800, writable: true }, height: { value: 600, writable: true },
  })
  return { getCanvas: () => canvas, triggerRepaint: vi.fn<() => void>() } satisfies SharedMapSceneMap
}

/** Pixi's WebGL renderer, which jsdom cannot start; the stage and the presentation are Pixi's own. */
function createPixiRenderer(): SharedPixiRenderer {
  return {
    init: vi.fn(async () => {}), render: vi.fn(), resize: vi.fn(), resetState: vi.fn(),
    destroy: vi.fn(), context: { extensions: { loseContext: { loseContext: vi.fn() } } },
  }
}

function createTarget() {
  return {
    setSnapshot: vi.fn<(snapshot: SceneRendererSnapshot) => void>(),
    setDraft: vi.fn(),
    requestRender: vi.fn(),
  } satisfies SceneRenderTarget
}

describe('SceneCanvasRuntime and the shared map scene layer', () => {
  it('a map layer connected after the runtime drew presents the Scene in its first frame, and a pan only repaints', async () => {
    const runtime = new SceneCanvasRuntime()
    runtime.documentSurface.loadDocument(orchard())
    const container = createContainer()
    await runtime.init(container)
    expect(container.querySelector('canvas'), 'MapLibre owns the only surface').toBeNull()

    // As a Design switch or a Retry builds a new map and layer: the slot replays the drawn Scene to it.
    const composition = createSharedMapSceneRendererComposition((target) => runtime.connectRenderTarget(target))
    const stage = new Container()
    const pixi = createPixiRenderer()
    const map = createMap()
    const gl = {} as WebGL2RenderingContext
    const layer = composition.createLayer({
      id: 'canopi-shared-scene',
      frames: runtime.cameraHost.frames,
      createRenderer: () => pixi,
      createStage: () => stage,
      createPresentation: (input) => createPixiScenePresentation({ ...input, createText: () => new MeasuredText() }),
    })
    await layer.initialize(map, gl)
    layer.layer.onAdd!(map as never, gl)
    layer.layer.render(gl, {} as never)

    expect(layer.diagnostics.sceneSyncCount).toBe(1)
    expect(pixi.render).toHaveBeenCalledOnce()
    const [worldRoot, billboardRoot] = stage.children
    expect(billboardRoot!.children.length, 'the apple tree is drawn').toBeGreaterThan(0)

    // A pan asks MapLibre for a frame; the layer reads the camera itself and syncs no scene.
    map.triggerRepaint.mockClear()
    runtime.cameraHost.current().apply({ kind: 'pan-by', deltaPx: { x: 30, y: -20 } })
    expect(map.triggerRepaint).toHaveBeenCalled()
    layer.layer.render(gl, {} as never)
    expect(layer.diagnostics.sceneSyncCount).toBe(1)
    worldRoot!.updateLocalTransform()
    const view = runtime.cameraHost.frames.viewFrame.peek().view
    expect(worldRoot!.localTransform.tx).toBeCloseTo(view.planar.affine[4], 6)

    await layer.dispose({ mapWillBeRemoved: true })
    runtime.destroy()
  })

  it('draws nothing after a map failure unmounts it, and a remount draws the kept Scene on the connected target', async () => {
    const runtime = new SceneCanvasRuntime()
    runtime.documentSurface.loadDocument(orchard())
    const container = createContainer()
    const target = createTarget()
    runtime.connectRenderTarget(target)

    await runtime.init(container)
    target.setSnapshot.mockClear()
    target.requestRender.mockClear()
    await runtime.unmountRenderer()
    runtime.commandSurface.viewport.zoomIn()
    await new Promise((resolve) => requestAnimationFrame(resolve))

    expect(target.setSnapshot).not.toHaveBeenCalled()
    expect(target.requestRender).not.toHaveBeenCalled()
    // The rebuilt map's layer connects before the remount: it gets nothing until the remount draws.
    const rebuilt = createTarget()
    runtime.connectRenderTarget(rebuilt)
    expect(rebuilt.setSnapshot).not.toHaveBeenCalled()
    await runtime.remountRenderer(container)
    expect(rebuilt.setSnapshot).toHaveBeenCalledOnce()
    expect(rebuilt.setSnapshot.mock.calls[0]![0].scene.plants.map((plant) => plant.id)).toEqual(['apple'])
    runtime.destroy()
  })
})
