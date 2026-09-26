import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MEASUREMENT_GUIDE_LABEL_OFFSET_PX } from '../canvas/runtime/measurement-guides'
import type { SceneRendererSnapshot } from '../canvas/runtime/renderers/scene-types'
import { createTestSceneRendererSnapshot } from './support/scene-renderer-snapshot'
import { LabelCollisionIndex } from '../canvas/label-collision'
import { Container, Text } from 'pixi.js'
import { createPixiScenePresentation } from '../canvas/runtime/renderers/pixi-scene'
import { CANVAS_CHROME_FONT_FAMILY } from '../canvas/chrome-fonts'

vi.mock('pixi.js', () => {
  const state = {
    containers: [] as MockContainer[],
    graphics: [] as MockGraphics[],
    graphicsContexts: [] as MockGraphicsContext[],
    texts: [] as MockText[],
  }

  class MockContainer {
    children: unknown[] = []
    visible = true
    alpha = 1
    position = { set: vi.fn() }
    scale = { set: vi.fn() }
    addChild(...children: unknown[]) {
      this.children.push(...children)
      return children[0]
    }
    removeChildren = vi.fn(() => {
      this.children = []
    })
    constructor() {
      state.containers.push(this)
    }
  }

  class MockGraphicsContext {
    private owners = new Set<MockGraphics>()
    clear = vi.fn(() => this)
    circle = vi.fn((...args: unknown[]) => this.record('circle', args))
    rect = vi.fn((...args: unknown[]) => this.record('rect', args))
    ellipse = vi.fn((...args: unknown[]) => this.record('ellipse', args))
    moveTo = vi.fn((...args: unknown[]) => this.record('moveTo', args))
    lineTo = vi.fn((...args: unknown[]) => this.record('lineTo', args))
    bezierCurveTo = vi.fn((...args: unknown[]) => this.record('bezierCurveTo', args))
    cut = vi.fn(() => this.record('cut'))
    closePath = vi.fn(() => this.record('closePath'))
    fill = vi.fn((...args: unknown[]) => this.record('fill', args))
    stroke = vi.fn((...args: unknown[]) => this.record('stroke', args))
    destroy = vi.fn(() => { this.owners.clear() })
    constructor() {
      state.graphicsContexts.push(this)
    }
    attach(graphics: MockGraphics) { this.owners.add(graphics) }
    detach(graphics: MockGraphics) { this.owners.delete(graphics) }
    get ownerCount() { return this.owners.size }
    private record(method: string, args: unknown[] = []) {
      for (const graphics of this.owners) graphics.record(method, args)
      return this
    }
  }

  class MockGraphics {
    private _context: MockGraphicsContext
    position = { set: vi.fn() }
    visible = true
    alpha = 1
    clear = vi.fn(() => this)
    circle = vi.fn(() => this)
    rect = vi.fn(() => this)
    ellipse = vi.fn(() => this)
    moveTo = vi.fn(() => this)
    lineTo = vi.fn(() => this)
    bezierCurveTo = vi.fn(() => this)
    cut = vi.fn(() => this)
    closePath = vi.fn(() => this)
    fill = vi.fn(() => this)
    stroke = vi.fn(() => this)
    removeFromParent = vi.fn()
    destroy = vi.fn((options?: boolean | { context?: boolean }) => {
      if (options === true || (typeof options === 'object' && options.context)) this._context.destroy()
    })
    constructor(options?: MockGraphicsContext | { context?: MockGraphicsContext }) {
      this._context = options instanceof MockGraphicsContext
        ? options
        : options?.context ?? new MockGraphicsContext()
      this._context.attach(this)
      state.graphics.push(this)
    }
    get context() { return this._context }
    set context(context: MockGraphicsContext) {
      if (context === this._context) return
      this._context.detach(this)
      this._context = context
      this._context.attach(this)
    }
    record(method: string, args: unknown[]) {
      const target = this as unknown as Record<string, (...values: unknown[]) => unknown>
      target[method]?.(...args)
    }
  }

  class MockText {
    resolution: number | null
    visible = true
    alpha = 1
    rotation = 0
    text = ''
    style: unknown = {}
    anchor = { set: vi.fn() }
    position = { set: vi.fn() }
    scale = { set: vi.fn() }
    removeFromParent = vi.fn()
    destroy = vi.fn()
    constructor(options: { resolution?: number } = {}) {
      this.resolution = options.resolution ?? null
      state.texts.push(this)
    }
  }

  class MockTextStyle {
    constructor(public readonly options: Record<string, unknown>) {}
  }

  return {
    Container: MockContainer,
    Graphics: MockGraphics,
    GraphicsContext: MockGraphicsContext,
    Text: MockText,
    TextStyle: MockTextStyle,
    __pixiMockState: state,
  }
})

/** Mounts the presentation the way the MapLibre custom layer does: text at twice the density. */
function mountPresentation(container: HTMLElement, dpr = 1) {
  return createPixiScenePresentation({
    stage: new Container(),
    createText: () => new Text({ resolution: dpr * 2 }),
    viewSize: { width: container.clientWidth, height: container.clientHeight },
  })
}

describe('createPixiScenePresentation', () => {
  it('translates admitted names during pan without rebuilding collision layout', async () => {
    const pixi = await import('pixi.js') as unknown as {
      __pixiMockState: { texts: Array<{ text: string; position: { set: ReturnType<typeof vi.fn> } }> }
    }
    const renderer = mountPresentation(document.createElement('div'))
    const add = vi.spyOn(LabelCollisionIndex.prototype, 'add')
    try {
      renderer.renderScene(createTestSceneRendererSnapshot({ scene: { plants: [createPlant({ position: { x: 1, y: 1 } })] }, viewport: { x: 0, y: 0, scale: 100 } }))
      const text = pixi.__pixiMockState.texts.find(t => t.text === 'Apple')!
      expect(text).toBeDefined()
      const [x, y] = text.position.set.mock.calls.at(-1)!
      add.mockClear()
      renderer.setViewport({ x: 10, y: 20, scale: 100 })
      expect(add).not.toHaveBeenCalled()
      expect(text.position.set).toHaveBeenLastCalledWith(x + 10, y + 20)
      renderer.setViewport({ x: 10, y: 20, scale: 110 })
      expect(add).toHaveBeenCalled()
    } finally {
      add.mockRestore()
      renderer.dispose()
    }
  })
  it('keeps world geometry warm during pan and refreshes screen-weight strokes on zoom', async () => {
    const pixi = await import('pixi.js') as unknown as {
      __pixiMockState: { graphics: Array<{ clear: ReturnType<typeof vi.fn> }> }
    }
    const renderer = mountPresentation(document.createElement('div'))
    renderer.renderScene(createTestSceneRendererSnapshot({ scene: {
      zones: [{ kind: 'zone', name: 'bed', zoneType: 'rect', locked: false, rotationDeg: 0, fillColor: '#eeeeee', notes: null,
        points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }] }],
      measurementGuides: [{ kind: 'measurement-guide', id: 'guide', locked: false, start: { x: 0, y: 0 }, end: { x: 2, y: 0 } }],
    }, viewport: { x: 0, y: 0, scale: 30 } }))
    const graphics = pixi.__pixiMockState.graphics
    graphics.forEach(g => g.clear.mockClear())
    renderer.setViewport({ x: 10, y: 20, scale: 30 })
    graphics.forEach(g => expect(g.clear).not.toHaveBeenCalled())
    renderer.setViewport({ x: 10, y: 20, scale: 60 })
    graphics.forEach(g => expect(g.clear).toHaveBeenCalledOnce())
    renderer.dispose()
  })
  it('skips offscreen plant paths and restores them with current appearance on re-entry', async () => {
    const pixi = await import('pixi.js') as unknown as {
      __pixiMockState: { graphics: Array<{ visible: boolean; clear: ReturnType<typeof vi.fn>; bezierCurveTo: ReturnType<typeof vi.fn>; fill: ReturnType<typeof vi.fn> }> }
    }
    const container = document.createElement('div')
    Object.defineProperties(container, { clientWidth: { value: 400 }, clientHeight: { value: 300 } })
    const renderer = mountPresentation(container)
    const snapshot = createTestSceneRendererSnapshot({ scene: { plants: [
      createPlant({ symbol: 'shrub', position: { x: 2, y: 2 } }),
    ] }, viewport: { x: 0, y: 0, scale: 30 } })
    renderer.renderScene(snapshot)
    const plant = pixi.__pixiMockState.graphics[0]!
    plant.clear.mockClear()
    renderer.setViewport({ x: 10000, y: 0, scale: 60 })
    expect(plant.visible).toBe(false)
    expect(plant.clear).not.toHaveBeenCalled()
    renderer.renderScene({ ...snapshot, viewport: { x: 10000, y: 0, scale: 60 },
      scene: { ...snapshot.scene, plants: snapshot.scene.plants.map(p => ({ ...p, color: '#ff0000' })) },
    })
    renderer.setViewport({ x: 0, y: 0, scale: 60 })
    expect(plant.visible).toBe(true)
    expect(plant.clear).not.toHaveBeenCalled()
    expect(plant.fill).toHaveBeenLastCalledWith(expect.objectContaining({ color: 0xff0000 }))
    renderer.dispose()
  })
  it('retains annotation text style during pan and updates it after an authored font change', async () => {
    const pixi = await import('pixi.js') as unknown as {
      __pixiMockState: { texts: Array<{ style: unknown }> }
    }
    const renderer = mountPresentation(document.createElement('div'))
    const snapshot = createTestSceneRendererSnapshot({ scene: { annotations: [{
      kind: 'annotation', id: 'note', annotationType: 'text', locked: false,
      position: { x: 1, y: 1 }, text: 'Orchard', fontSize: 16, rotationDeg: 0,
    }] }, viewport: { x: 0, y: 0, scale: 30 } })
    renderer.renderScene(snapshot)
    const text = pixi.__pixiMockState.texts[0]!
    const style = text.style
    renderer.setViewport({ x: 10, y: 20, scale: 30 })
    expect(text.style).toBe(style)
    renderer.renderScene({ ...snapshot, scene: { ...snapshot.scene,
      annotations: snapshot.scene.annotations.map(a => ({ ...a, fontSize: 20 })),
    } })
    expect(text.style).not.toBe(style)
    renderer.dispose()
  })
  it('shares exact botanical geometry and refreshes it for zoom, colour, and interaction', async () => {
    const pixi = await import('pixi.js') as unknown as {
      __pixiMockState: {
        graphics: Array<{
          clear: ReturnType<typeof vi.fn>
          context: unknown
          position: { set: ReturnType<typeof vi.fn> }
          bezierCurveTo: ReturnType<typeof vi.fn>
        }>
        graphicsContexts: Array<{ bezierCurveTo: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn>; ownerCount: number }>
      }
    }
    const renderer = mountPresentation(document.createElement('div'))
    const snapshot = createTestSceneRendererSnapshot({ scene: { plants: [
      createPlant({ id: 'a', symbol: 'shrub', position: { x: 1, y: 1 } }),
      createPlant({ id: 'b', symbol: 'shrub', position: { x: 5, y: 1 } }),
    ] }, viewport: { x: 0, y: 0, scale: 30 } })
    renderer.renderScene(snapshot)
    const [firstPlant, secondPlant] = pixi.__pixiMockState.graphics
    expect(firstPlant).toBeDefined()
    expect(secondPlant).toBeDefined()
    expect(firstPlant?.context).toBe(secondPlant?.context)
    const sharedContext = firstPlant!.context
    expect(pixi.__pixiMockState.graphicsContexts).toHaveLength(2)
    expect((sharedContext as { ownerCount: number }).ownerCount).toBe(2)
    firstPlant!.clear.mockClear()
    secondPlant!.clear.mockClear()
    renderer.setViewport({ x: 10, y: 20, scale: 30 })
    expect(firstPlant!.clear).not.toHaveBeenCalled()
    expect(secondPlant!.clear).not.toHaveBeenCalled()
    expect(firstPlant!.position.set).toHaveBeenLastCalledWith(40, 50)
    expect(firstPlant!.context).toBe(sharedContext)
    renderer.renderScene({ ...snapshot, selectedPlantIds: new Set(['b']) })
    expect(firstPlant!.context).toBe(sharedContext)
    expect(secondPlant!.context).not.toBe(sharedContext)
    renderer.setViewport({ x: 0, y: 0, scale: 60 })
    expect(firstPlant!.context).not.toBe(sharedContext)
    const zoomContext = firstPlant!.context
    renderer.renderScene({ ...snapshot, scene: { ...snapshot.scene, plants: snapshot.scene.plants.map(p => ({ ...p, color: '#ff0000' })) } })
    expect(firstPlant!.context).toBe(secondPlant!.context)
    expect(firstPlant!.context).not.toBe(zoomContext)
    expect(firstPlant!.clear).not.toHaveBeenCalled()
    expect(secondPlant!.clear).not.toHaveBeenCalled()
    renderer.setViewport({ x: 0, y: 0, scale: 30 })
    renderer.setViewport({ x: 0, y: 0, scale: 60 })
    renderer.setViewport({ x: 0, y: 0, scale: 90 })
    const plantContexts = pixi.__pixiMockState.graphicsContexts
      .filter(context => context.bezierCurveTo.mock.calls.length > 0)
    expect(plantContexts.filter(context => context.destroy.mock.calls.length > 0)).not.toHaveLength(0)
    renderer.dispose()
    for (const context of plantContexts) expect(context.destroy).toHaveBeenCalledTimes(1)
  })
  it('detaches removed and disposed Plant graphics from externally shared contexts', async () => {
    const pixi = await import('pixi.js') as unknown as {
      __pixiMockState: {
        graphics: Array<{ context: { ownerCount: number; destroy: ReturnType<typeof vi.fn> }; destroy: ReturnType<typeof vi.fn> }>
        graphicsContexts: Array<{ ownerCount: number; destroy: ReturnType<typeof vi.fn> }>
      }
    }
    const renderer = mountPresentation(document.createElement('div'))
    const snapshot = createTestSceneRendererSnapshot({ scene: { plants: [
      createPlant({ id: 'a', position: { x: 1, y: 1 } }),
      createPlant({ id: 'b', position: { x: 5, y: 1 } }),
    ] }, viewport: { x: 0, y: 0, scale: 30 } })
    renderer.renderScene(snapshot)
    const [firstPlant, secondPlant] = pixi.__pixiMockState.graphics
    const sharedContext = firstPlant!.context
    expect(secondPlant!.context).toBe(sharedContext)
    expect(sharedContext.ownerCount).toBe(2)

    renderer.renderScene({ ...snapshot, scene: { ...snapshot.scene, plants: [snapshot.scene.plants[1]!] } })
    expect(firstPlant!.destroy).toHaveBeenCalledOnce()
    expect(sharedContext.ownerCount).toBe(1)

    renderer.dispose()
    expect(secondPlant!.destroy).toHaveBeenCalledOnce()
    expect(sharedContext.ownerCount).toBe(0)
    for (const context of pixi.__pixiMockState.graphicsContexts) {
      expect(context.ownerCount).toBe(0)
      expect(context.destroy).toHaveBeenCalledOnce()
    }
  })
  it('reuses A/B/A exact zoom contexts, evicts only the third-oldest generation, and preserves the visible context', async () => {
    const pixi = await import('pixi.js') as unknown as {
      __pixiMockState: {
        graphics: Array<{ context: { destroy: ReturnType<typeof vi.fn> }; bezierCurveTo: ReturnType<typeof vi.fn> }>
      }
    }
    const renderer = mountPresentation(document.createElement('div'))
    const snapshot = createTestSceneRendererSnapshot({ scene: {
      plants: [createPlant({ symbol: 'shrub', position: { x: 2, y: 2 } })],
    }, viewport: { x: 0, y: 0, scale: 20 } })
    renderer.renderScene(snapshot)
    const plant = pixi.__pixiMockState.graphics[0]!
    const contextA = plant.context
    renderer.setViewport({ x: 0, y: 0, scale: 30 })
    const contextB = plant.context
    renderer.setViewport({ x: 0, y: 0, scale: 20 })
    expect(plant.context).toBe(contextA)
    expect(contextA.destroy).not.toHaveBeenCalled()
    renderer.setViewport({ x: 0, y: 0, scale: 40 })
    const contextC = plant.context
    renderer.setViewport({ x: 0, y: 0, scale: 60 })
    const contextD = plant.context
    expect(contextB.destroy).toHaveBeenCalledOnce()
    expect(contextA.destroy).not.toHaveBeenCalled()
    expect(contextC.destroy).not.toHaveBeenCalled()
    expect(contextD.destroy).not.toHaveBeenCalled()
    renderer.dispose()
    expect(contextA.destroy).toHaveBeenCalledOnce()
    expect(contextB.destroy).toHaveBeenCalledOnce()
    expect(contextC.destroy).toHaveBeenCalledOnce()
    expect(contextD.destroy).toHaveBeenCalledOnce()
  })
  beforeEach(async () => {
    const pixi = await import('pixi.js') as unknown as {
      __pixiMockState: {
        containers: unknown[]
        graphics: unknown[]
        graphicsContexts: unknown[]
        texts: unknown[]
      }
    }
    pixi.__pixiMockState.containers.length = 0
    pixi.__pixiMockState.graphics.length = 0
    pixi.__pixiMockState.graphicsContexts.length = 0
    pixi.__pixiMockState.texts.length = 0
  })

  it('restores full opacity after clearing Species focus, including camera-only updates', async () => {
    const pixi = await import('pixi.js') as unknown as {
      __pixiMockState: { graphics: Array<{ alpha: number; circle: ReturnType<typeof vi.fn>; fill: ReturnType<typeof vi.fn>; stroke: ReturnType<typeof vi.fn> }> }
    }
    const renderer = mountPresentation(document.createElement('div'))
    const snapshot = createTestSceneRendererSnapshot({ scene: { plants: [
      createPlant({ id: 'apple', position: { x: 0, y: 0 } }),
      createPlant({ id: 'mint', canonicalName: 'Mentha spicata', position: { x: 3, y: 0 } }),
    ] }, selectedTargets: [{ kind: 'plant', id: 'mint' }], speciesFocus: { canonicalName: 'Malus domestica', showCodes: false } })
    renderer.renderScene(snapshot)
    const marks = pixi.__pixiMockState.graphics.filter((graphic) => graphic.circle.mock.calls.length)
    expect(marks.map((mark) => mark.fill.mock.calls.at(-1)?.[0].alpha)).toEqual([1, .16])
    const selectionOpacity = marks[1]!.stroke.mock.calls.at(-1)?.[0].alpha
    expect(marks[1]!.alpha).toBe(1)
    renderer.setViewport({ x: 10, y: 20, scale: 2 })
    expect(marks.map((mark) => mark.fill.mock.calls.at(-1)?.[0].alpha)).toEqual([1, .16])
    renderer.renderScene({ ...snapshot, speciesFocus: { canonicalName: null, showCodes: false } })
    expect(marks.map((mark) => mark.fill.mock.calls.at(-1)?.[0].alpha)).toEqual([1, 1])
    expect(marks[1]!.stroke.mock.calls.at(-1)?.[0].alpha).toBe(selectionOpacity)
    renderer.dispose()
  })

  it.each([1, 1.5, 2])('keeps every text role at its CSS font size without scaling text during zoom at DPR %s', async (dpr) => {
    const pixi = await import('pixi.js') as unknown as {
      __pixiMockState: { texts: Array<{ text: string; style: { options: { fontSize: number; fontFamily: string } }; scale: { set: ReturnType<typeof vi.fn> } }> }
    }
    const renderer = mountPresentation(document.createElement('div'), dpr)
    try {
      renderer.renderScene(createTestSceneRendererSnapshot({
        scene: {
          plants: [createPlant({ id: 'a' }), createPlant({ id: 'b' })],
          annotations: [{ kind: 'annotation', annotationType: 'text', id: 'note', locked: false,
            position: { x: 1, y: 1 }, text: 'Érable 日本語', fontSize: 16, rotationDeg: 15 }],
          measurementGuides: [{ kind: 'measurement-guide', id: 'guide', locked: false,
            start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }],
        },
        viewport: { x: 0.35, y: 0.45, scale: 20 },
        pinnedPlantNameLabels: [{ plantId: 'a', text: 'Pinned name', fontStyle: 'normal', opacity: 1, screenPoint: { x: 10.35, y: 20.45 } }],
        selectionLabels: [{ canonicalName: 'Malus domestica', text: 'Selected name', fontStyle: 'italic', screenPoint: { x: 10.35, y: 30.45 } }],
      }))
      const texts = pixi.__pixiMockState.texts
      expect(texts.map(text => text.text)).toEqual(expect.arrayContaining(['2', 'Érable 日本語', 'Pinned name', 'Selected name']))
      expect(texts).toHaveLength(5)
      for (const scale of [0.1, 8, 14, 20, 63.75, 1000, 20]) {
        renderer.setViewport({ x: 0.35, y: 0.45, scale })
        for (const text of texts) {
          expect(text.style.options.fontFamily).toBe(CANVAS_CHROME_FONT_FAMILY)
          expect(text.scale.set).not.toHaveBeenCalled()
        }
        expect(texts.find(text => text.text === 'Érable 日本語')?.style.options.fontSize).toBe(16)
      }
    } finally {
      renderer.dispose()
    }
  })

  it('refreshes pinned-name fading on zoom reversal while retaining readable font size', async () => {
    const pixi = await import('pixi.js') as unknown as {
      __pixiMockState: { texts: Array<{ text: string; alpha: number; style: { options: { fontSize: number } }; destroy: ReturnType<typeof vi.fn> }> }
    }
    const host = document.createElement('div')
    const renderer = mountPresentation(host, 2)
    renderer.renderScene(createRendererSnapshot({ plants: [createPlant({ pinnedName: true })] }))
    for (const [scale, opacity] of [[20, 1], [14, 0.5], [8, 0], [14, 0.5], [20, 1]]) {
      renderer.setViewport({ x: 0, y: 0, scale: scale! })
      const labels = pixi.__pixiMockState.texts.filter((text) => text.text === 'Apple' && !text.destroy.mock.calls.length)
      expect(labels).toHaveLength(opacity === 0 ? 0 : 1)
      if (opacity) {
        expect(labels[0]?.alpha).toBe(opacity)
        expect(labels[0]?.style.options.fontSize).toBe(12)
      }
    }
    renderer.dispose()
  })

  it('crossfades Annotation markers and text, and reveals only the direct selected note', async () => {
    const pixi = await import('pixi.js') as unknown as {
      __pixiMockState: { texts: Array<{ text: string; alpha: number; visible: boolean; style: { options: { fontSize: number } } }>; graphics: Array<{ stroke: ReturnType<typeof vi.fn> }> }
    }
    const renderer = mountPresentation(document.createElement('div'), 2)
    const snapshot = createTestSceneRendererSnapshot({ scene: {
      annotations: [{ kind: 'annotation', id: 'note', annotationType: 'text', locked: false,
        position: { x: 10, y: 20 }, text: 'First\nSecond', fontSize: 16, rotationDeg: 45 }],
    }, viewport: { x: 0, y: 0, scale: 20 } })
    renderer.renderScene(snapshot)
    for (const [scale, opacity] of [[20, 1], [14, 0.5], [8, 0], [14, 0.5], [20, 1]]) {
      renderer.setViewport({ x: 0, y: 0, scale: scale! })
      const text = pixi.__pixiMockState.texts.find((entry) => entry.text === 'First\nSecond')!
      expect(text.alpha).toBe(opacity)
      expect(text.visible).toBe(opacity! > 0)
      expect(text.style.options.fontSize).toBe(16)
      if (scale === 8) expect(pixi.__pixiMockState.graphics.some((graphics) => graphics.stroke.mock.calls.some(([stroke]) => stroke.width === 1.5 && stroke.alpha === 1))).toBe(true)
    }
    renderer.renderScene({ ...snapshot, viewport: { x: 0, y: 0, scale: 4 }, revealedAnnotationId: 'note', selectedAnnotationIds: new Set(['note']) })
    expect(pixi.__pixiMockState.texts.find((entry) => entry.text === 'First\nSecond')).toMatchObject({ alpha: 1, visible: true })
    renderer.dispose()
  })

  it('renders precision glyphs and stack badges in CSS pixels', async () => {
    const pixi = await import('pixi.js') as unknown as {
      __pixiMockState: {
        graphics: Array<{ circle: ReturnType<typeof vi.fn>; fill: ReturnType<typeof vi.fn>; position: { set: ReturnType<typeof vi.fn> } }>;
        texts: Array<{ text: string; style: { options: { fontSize: number } } }>;
      }
    }
    const renderer = mountPresentation(document.createElement('div'), 1.5)
    renderer.renderScene(createRendererSnapshot({
      plants: [createPlant({ id: 'a', symbol: 'round' }), createPlant({ id: 'b', symbol: 'round' })],
      viewport: { x: -9900, y: -9900, scale: 1000 },
    }))
    const glyph = pixi.__pixiMockState.graphics.find(graphics => graphics.circle.mock.calls.some(([x, y, radius]) => x === 0 && y === 0 && radius > 4.8 && radius < 5.6))!
    expect(glyph).toBeDefined()
    expect(glyph.position.set).toHaveBeenLastCalledWith(100, 100)
    expect(pixi.__pixiMockState.texts.find((text) => text.text === '2')?.style.options.fontSize).toBe(9)
    renderer.dispose()
  })

  it('preserves CSS Zone fill alpha when composing Layer opacity', async () => {
    const pixi = await import('pixi.js') as unknown as {
      __pixiMockState: { graphics: Array<{ fill: ReturnType<typeof vi.fn> }>; containers: Array<{ alpha: number }> }
    }
    const renderer = mountPresentation(document.createElement('div'))
    renderer.renderScene(createTestSceneRendererSnapshot({ scene: {
      zones: [{ kind: 'zone', name: 'bed', zoneType: 'rect', locked: false, rotationDeg: 0,
        points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], fillColor: 'rgba(45, 95, 63, 0.1)', notes: null }],
      layers: [{ kind: 'layer', name: 'zones', visible: true, locked: false, opacity: 0.5 }],
    } }))
    const fills = pixi.__pixiMockState.graphics.flatMap((graphics) => graphics.fill.mock.calls)
    expect(fills[0]?.[0].alpha).toBeCloseTo(0.02)
    expect(pixi.__pixiMockState.containers.some((container) => container.alpha === 0.5)).toBe(true)
    renderer.dispose()
  })

  it('draws plant symbol glyphs at readable zoom and collapses them to dots at low zoom', async () => {
    const pixi = await import('pixi.js') as unknown as {
      __pixiMockState: {
        graphics: Array<{
          circle: ReturnType<typeof vi.fn>
          rect: ReturnType<typeof vi.fn>
          bezierCurveTo: ReturnType<typeof vi.fn>
          lineTo: ReturnType<typeof vi.fn>
        }>
      }
    }

    const host = document.createElement('div')
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 400 })
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 300 })

    const renderer = mountPresentation(host)

    const snapshot = createRendererSnapshot({
      plants: [
        createPlant({ id: 'rosette', symbol: 'rosette', position: { x: 10, y: 10 } }),
        createPlant({ id: 'conifer', canonicalName: 'Pyrus communis', position: { x: 15, y: 10 } }),
      ],
      plantSpeciesSymbols: { 'Pyrus communis': 'conifer' },
      viewport: { x: 0, y: 0, scale: 20 },
    })

    renderer.renderScene(snapshot)

    expect(pixi.__pixiMockState.graphics.some((graphics) => graphics.bezierCurveTo.mock.calls.length > 0)).toBe(true)
    expect(pixi.__pixiMockState.graphics.some((graphics) => graphics.lineTo.mock.calls.length > 0)).toBe(true)

    vi.clearAllMocks()
    renderer.renderScene({
      ...snapshot,
      viewport: { x: 0, y: 0, scale: 0.25 },
    })

    expect(pixi.__pixiMockState.graphics.some((graphics) => graphics.circle.mock.calls.length > 0)).toBe(true)
    expect(pixi.__pixiMockState.graphics.some((graphics) => graphics.bezierCurveTo.mock.calls.length > 0)).toBe(false)
    expect(pixi.__pixiMockState.graphics.some((graphics) => graphics.lineTo.mock.calls.length > 0)).toBe(false)
    renderer.dispose()
  })

  it('draws curved plant symbol recipes with native Pixi curves', async () => {
    const pixi = await import('pixi.js') as unknown as {
      __pixiMockState: {
        graphics: Array<{
          bezierCurveTo: ReturnType<typeof vi.fn>
          fill: ReturnType<typeof vi.fn>
          stroke: ReturnType<typeof vi.fn>
        }>
      }
    }

    const host = document.createElement('div')
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 400 })
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 300 })

    const renderer = mountPresentation(host)

    renderer.renderScene(createRendererSnapshot({
      plants: [
        createPlant({ id: 'shrub', symbol: 'shrub', position: { x: 10, y: 10 } }),
        createPlant({ id: 'groundcover', symbol: 'groundcover', position: { x: 30, y: 10 } }),
      ],
      viewport: { x: 0, y: 0, scale: 20 },
    }))

    expect(pixi.__pixiMockState.graphics.some((graphics) => graphics.bezierCurveTo.mock.calls.length > 0)).toBe(true)
    expect(pixi.__pixiMockState.graphics.some((graphics) => graphics.fill.mock.calls.length > 0)).toBe(true)
    expect(pixi.__pixiMockState.graphics.some((graphics) => graphics.stroke.mock.calls.length > 0)).toBe(true)
    renderer.dispose()
  })

  it('renders Measurement Guides with screen-space distance labels and layer visibility', async () => {
    const pixi = await import('pixi.js') as unknown as {
      __pixiMockState: {
        graphics: Array<{
          moveTo: ReturnType<typeof vi.fn>
          lineTo: ReturnType<typeof vi.fn>
          stroke: ReturnType<typeof vi.fn>
        }>
        texts: Array<{
          text: string
          rotation: number
          position: { set: ReturnType<typeof vi.fn> }
        }>
      }
    }

    const host = document.createElement('div')
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 400 })
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 300 })

    const renderer = mountPresentation(host)

    const snapshot = createRendererSnapshot({
      measurementGuides: [{
        kind: 'measurement-guide',
        id: 'guide-1',
        locked: false,
        start: { x: 40, y: 10 },
        end: { x: 10, y: 40 },
      }],
      layers: [{ kind: 'layer', name: 'measurement-guides', visible: true, locked: false, opacity: 1 }],
      viewport: { x: 0, y: 0, scale: 2 },
    })

    renderer.renderScene(snapshot)

    const guideGraphic = pixi.__pixiMockState.graphics.find((graphics) =>
      graphics.moveTo.mock.calls.some(([x, y]) => x === 40 && y === 10)
      && graphics.lineTo.mock.calls.some(([x, y]) => x === 10 && y === 40),
    )
    // A light 1.5 px guide over a 3.5 px dark casing, in world units at scale 2.
    expect(guideGraphic?.stroke.mock.calls).toHaveLength(2)
    expect(guideGraphic?.stroke.mock.calls[0]?.[0]).toMatchObject({ color: 0x14100a, width: 1.75, alpha: .6 })
    expect(guideGraphic?.stroke.mock.calls[1]?.[0]).toMatchObject({ color: 0xfff3d6, width: 0.75, alpha: 1 })
    const label = pixi.__pixiMockState.texts.find((text) => text.text === '42 m')
    const expectedLabelPoint = {
      x: 50 - MEASUREMENT_GUIDE_LABEL_OFFSET_PX * Math.SQRT1_2,
      y: 50 - MEASUREMENT_GUIDE_LABEL_OFFSET_PX * Math.SQRT1_2,
    }
    const labelPositionCall = label?.position.set.mock.calls[0]
    expect(labelPositionCall?.[0]).toBeCloseTo(expectedLabelPoint.x)
    expect(labelPositionCall?.[1]).toBeCloseTo(expectedLabelPoint.y)
    expect(label?.rotation).toBeCloseTo(-Math.PI / 4)

    vi.clearAllMocks()
    renderer.renderScene({
      ...snapshot,
      scene: {
        ...snapshot.scene,
        layers: [{ kind: 'layer', name: 'measurement-guides', visible: false, locked: false, opacity: 1 }],
      },
    })

    expect(pixi.__pixiMockState.graphics.some((graphics) => graphics.lineTo.mock.calls.length > 0)).toBe(false)
    expect(pixi.__pixiMockState.texts.some((text) => text.position.set.mock.calls.length > 0)).toBe(false)
    renderer.dispose()
  })

  it('retains plant and annotation display objects across viewport updates', async () => {
    const pixi = await import('pixi.js') as unknown as {
      __pixiMockState: {
        containers: Array<{ removeChildren: ReturnType<typeof vi.fn> }>
        graphics: unknown[]
        texts: unknown[]
      }
    }

    const host = document.createElement('div')
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 400 })
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 300 })

    const renderer = mountPresentation(host)

    const snapshot = createTestSceneRendererSnapshot({
      scene: {
        plants: [{
          kind: 'plant',
          locked: false,
          id: 'plant-1',
          canonicalName: 'Malus domestica',
          commonName: 'Apple',
          color: null,
          stratum: 'mid',
          canopySpreadM: 3,
          position: { x: 10, y: 20 },
          rotationDeg: null,
          notes: null,
          plantedDate: null,
          quantity: 1,
        }],
        zones: [],
        annotations: [{
          kind: 'annotation',
          locked: false,
          id: 'annotation-1',
          annotationType: 'text',
          position: { x: 25, y: 35 },
          text: 'Hello',
          fontSize: 16,
          rotationDeg: null,
        }],
      },
      selectedTargets: [{ kind: 'annotation', id: 'annotation-1' }],
    })

    renderer.renderScene(snapshot)

    const graphicsAfterSceneRender = pixi.__pixiMockState.graphics.length
    const textsAfterSceneRender = pixi.__pixiMockState.texts.length
    const removeChildrenCallsAfterSceneRender = pixi.__pixiMockState.containers
      .reduce((count, container) => count + container.removeChildren.mock.calls.length, 0)

    renderer.setViewport({ x: 15, y: 25, scale: 1.5 })

    expect(pixi.__pixiMockState.graphics).toHaveLength(graphicsAfterSceneRender)
    expect(pixi.__pixiMockState.texts).toHaveLength(textsAfterSceneRender)
    expect(
      pixi.__pixiMockState.containers
        .reduce((count, container) => count + container.removeChildren.mock.calls.length, 0),
    ).toBe(removeChildrenCallsAfterSceneRender)

    renderer.dispose()
  })

  it('applies text annotation rotation in screen space', async () => {
    const pixi = await import('pixi.js') as unknown as {
      __pixiMockState: {
        texts: Array<{
          text: string
          rotation: number
          position: { set: ReturnType<typeof vi.fn> }
        }>
      }
    }

    const host = document.createElement('div')
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 400 })
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 300 })

    const renderer = mountPresentation(host)

    const snapshot = createTestSceneRendererSnapshot({
      scene: {
        annotations: [{
          kind: 'annotation',
          locked: false,
          id: 'annotation-1',
          annotationType: 'text',
          position: { x: 25, y: 35 },
          text: 'Hello',
          fontSize: 16,
          rotationDeg: 90,
        }],
      },
      viewport: { x: 10, y: 20, scale: 2 },
    })

    renderer.renderScene(snapshot)

    const annotationText = pixi.__pixiMockState.texts.find((text) => text.text === 'Hello')
    expect(annotationText?.position.set).toHaveBeenCalledWith(60, 90)
    expect(annotationText?.rotation).toBeCloseTo(Math.PI / 2)
    renderer.dispose()
  })

  it('renders elliptical zones from center and radii geometry', async () => {
    const pixi = await import('pixi.js') as unknown as {
      __pixiMockState: {
        graphics: Array<{ ellipse: ReturnType<typeof vi.fn> }>
      }
    }

    const host = document.createElement('div')
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 400 })
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 300 })

    const renderer = mountPresentation(host)

    const snapshot = createTestSceneRendererSnapshot({
      scene: {
        zones: [{
          kind: 'zone',
          locked: false,
          name: 'ellipse-1',
          zoneType: 'ellipse',
          points: [
            { x: 50, y: 60 },
            { x: 30, y: 20 },
          ],
          rotationDeg: 0,
          fillColor: null,
          notes: null,
        }],
      },
    })

    renderer.renderScene(snapshot)

    const ellipseGraphic = pixi.__pixiMockState.graphics.find((graphics) => graphics.ellipse.mock.calls.length > 0)
    expect(ellipseGraphic?.ellipse).toHaveBeenCalledWith(50, 60, 30, 20)
    renderer.dispose()
  })

  it('renders rotated rectangular zones as oriented paths', async () => {
    const pixi = await import('pixi.js') as unknown as {
      __pixiMockState: {
        graphics: Array<{
          rect: ReturnType<typeof vi.fn>
          moveTo: ReturnType<typeof vi.fn>
          lineTo: ReturnType<typeof vi.fn>
        }>
      }
    }

    const host = document.createElement('div')
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 400 })
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 300 })

    const renderer = mountPresentation(host)

    const snapshot = createTestSceneRendererSnapshot({
      scene: {
        zones: [{
          kind: 'zone',
          locked: false,
          name: 'zone-1',
          zoneType: 'rect',
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 4 },
            { x: 0, y: 4 },
          ],
          rotationDeg: 90,
          fillColor: null,
          notes: null,
        }],
      },
    })

    renderer.renderScene(snapshot)

    const zoneGraphic = pixi.__pixiMockState.graphics.find((graphics) =>
      graphics.rect.mock.calls.length > 0 || graphics.moveTo.mock.calls.length > 0,
    )
    expect(zoneGraphic).toBeDefined()
    expect(zoneGraphic?.rect).not.toHaveBeenCalled()
    expect(zoneGraphic?.moveTo).toHaveBeenCalledWith(7, -3)
    expect(zoneGraphic?.lineTo).toHaveBeenCalledWith(7, 7)
    expect(zoneGraphic?.lineTo).toHaveBeenCalledWith(3, 7)
    expect(zoneGraphic?.lineTo).toHaveBeenCalledWith(3, -3)
    renderer.dispose()
  })

  it('uses interaction stroke alpha for rotated Pixi zones', async () => {
    const pixi = await import('pixi.js') as unknown as {
      __pixiMockState: {
        graphics: Array<{
          moveTo: ReturnType<typeof vi.fn>
          stroke: ReturnType<typeof vi.fn>
        }>
      }
    }

    const host = document.createElement('div')
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 400 })
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 300 })

    const renderer = mountPresentation(host)

    const snapshot = createTestSceneRendererSnapshot({
      scene: {
        zones: [
          {
            kind: 'zone',
            locked: false,
            name: 'rotated-rect',
            zoneType: 'rect',
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 4 },
              { x: 0, y: 4 },
            ],
            rotationDeg: 90,
            fillColor: null,
            notes: null,
          },
          {
            kind: 'zone',
            locked: false,
            name: 'rotated-ellipse',
            zoneType: 'ellipse',
            points: [
              { x: 40, y: 40 },
              { x: 8, y: 4 },
            ],
            rotationDeg: 45,
            fillColor: null,
            notes: null,
          },
        ],
      },
      highlightedZoneIds: new Set<string>(['rotated-rect', 'rotated-ellipse']),
    })

    renderer.renderScene(snapshot)

    const rotatedZoneStrokes = pixi.__pixiMockState.graphics
      .filter((graphics) => graphics.moveTo.mock.calls.length > 0)
      .map((graphics) => graphics.stroke.mock.calls)

    expect(rotatedZoneStrokes).toHaveLength(2)
    for (const [casing, stroke] of rotatedZoneStrokes) {
      expect(casing?.[0].alpha).toBeCloseTo(0.72)
      expect(casing?.[0].width).toBeGreaterThan(stroke?.[0].width)
      expect(stroke?.[0].alpha).toBeCloseTo(0.72 * 0.62)
    }
    renderer.dispose()
  })

  it('keeps colliding Zone and Plant selection strokes typed and screen-readable', async () => {
    const pixi = await import('pixi.js') as unknown as {
      __pixiMockState: {
        graphics: Array<{
          rect: ReturnType<typeof vi.fn>
          circle: ReturnType<typeof vi.fn>
          stroke: ReturnType<typeof vi.fn>
        }>
      }
    }

    const host = document.createElement('div')
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 400 })
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 300 })

    const renderer = mountPresentation(host)

    const snapshot = createTestSceneRendererSnapshot({
      scene: {
        plants: [{
          kind: 'plant',
          locked: false,
          id: 'shared-id',
          canonicalName: 'Malus domestica',
          commonName: 'Apple',
          color: null,
          stratum: 'mid',
          canopySpreadM: null,
          position: { x: 10, y: 20 },
          rotationDeg: null,
          notes: null,
          plantedDate: null,
          quantity: 1,
        }],
        zones: [{
          kind: 'zone',
          locked: false,
          name: 'shared-id',
          zoneType: 'rect',
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
          ],
          rotationDeg: 0,
          fillColor: null,
          notes: null,
        }],
      },
      viewport: { x: 0, y: 0, scale: 4 },
      selectedTargets: [{ kind: 'zone', id: 'shared-id' }],
    })

    renderer.renderScene(snapshot)

    const zoneGraphic = pixi.__pixiMockState.graphics.find((graphics) => graphics.rect.mock.calls.length > 0)
    const plantGraphic = pixi.__pixiMockState.graphics.find((graphics) => graphics.circle.mock.calls.length > 0)
    // Selected: 2.5 CSS px over a 5.5 CSS px casing, divided by camera scale 4.
    expect(zoneGraphic?.stroke.mock.calls[0]?.[0]).toMatchObject({ width: 1.375 })
    expect(zoneGraphic?.stroke.mock.calls[1]?.[0]).toMatchObject({ width: 0.625 })
    expect(plantGraphic?.stroke).not.toHaveBeenCalled()

    renderer.setViewport({ x: 0, y: 0, scale: 2 })

    expect(zoneGraphic?.stroke.mock.calls.slice(-1)[0]?.[0]).toMatchObject({ width: 1.25 })
    expect(plantGraphic?.stroke).not.toHaveBeenCalled()

    renderer.renderScene(createTestSceneRendererSnapshot({
      scene: snapshot.scene,
      viewport: { x: 0, y: 0, scale: 4 },
      selectedTargets: [
        { kind: 'zone', id: 'shared-id' },
        { kind: 'plant', id: 'shared-id' },
      ],
    }))

    expect(zoneGraphic?.stroke.mock.calls.slice(-1)[0]?.[0]).toMatchObject({ width: 0.625 })
    expect(plantGraphic?.stroke.mock.calls.slice(-2).map(([stroke]) => stroke.width)).toEqual([5.5, 2.5])

    renderer.setViewport({ x: 0, y: 0, scale: 2 })

    expect(zoneGraphic?.stroke.mock.calls.slice(-1)[0]?.[0]).toMatchObject({ width: 1.25 })
    expect(plantGraphic?.stroke.mock.calls.slice(-2).map(([stroke]) => stroke.width)).toEqual([5.5, 2.5])
    renderer.dispose()
  })

  it('renders selected zones with stronger ochre strokes than hover highlights', async () => {
    const pixi = await import('pixi.js') as unknown as {
      __pixiMockState: {
        graphics: Array<{
          rect: ReturnType<typeof vi.fn>
          stroke: ReturnType<typeof vi.fn>
        }>
      }
    }

    const host = document.createElement('div')
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 400 })
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 300 })

    const renderer = mountPresentation(host)

    const snapshot = createTestSceneRendererSnapshot({
      scene: {
        zones: [
          {
            kind: 'zone',
            locked: false,
            name: 'selected-zone',
            zoneType: 'rect',
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
              { x: 0, y: 10 },
            ],
            rotationDeg: 0,
            fillColor: null,
            notes: null,
          },
          {
            kind: 'zone',
            locked: false,
            name: 'hover-zone',
            zoneType: 'rect',
            points: [
              { x: 20, y: 0 },
              { x: 30, y: 0 },
              { x: 30, y: 10 },
              { x: 20, y: 10 },
            ],
            rotationDeg: 0,
            fillColor: null,
            notes: null,
          },
        ],
      },
      selectedTargets: [{ kind: 'zone', id: 'selected-zone' }],
      highlightedZoneIds: new Set<string>(['hover-zone']),
    })

    renderer.renderScene(snapshot)

    const selectedGraphic = pixi.__pixiMockState.graphics
      .find((graphics) => graphics.rect.mock.calls[0]?.[0] === 0)
    const hoverGraphic = pixi.__pixiMockState.graphics
      .find((graphics) => graphics.rect.mock.calls[0]?.[0] === 20)
    const selectedCasing = selectedGraphic?.stroke.mock.calls[0]?.[0]
    const selectedStroke = selectedGraphic?.stroke.mock.calls[1]?.[0]
    const hoverStroke = hoverGraphic?.stroke.mock.calls[1]?.[0]

    expect(selectedStroke).toMatchObject({ color: 0x9c5a16 })
    expect(selectedCasing).toMatchObject({ color: 0xfff8ec })
    expect(selectedCasing.width).toBeGreaterThan(selectedStroke.width)
    expect(selectedStroke.width).toBeGreaterThan(hoverStroke.width)
    expect(selectedStroke.alpha).toBeGreaterThan(hoverStroke.alpha)
    renderer.dispose()
  })
})

function createRendererSnapshot(overrides: {
  plants?: SceneRendererSnapshot['scene']['plants']
  measurementGuides?: SceneRendererSnapshot['scene']['measurementGuides']
  layers?: SceneRendererSnapshot['scene']['layers']
  plantSpeciesSymbols?: Record<string, string>
  viewport?: SceneRendererSnapshot['viewport']
} = {}): SceneRendererSnapshot {
  return createTestSceneRendererSnapshot({
    scene: {
      plants: overrides.plants ?? [],
      layers: overrides.layers ?? [],
      plantSpeciesSymbols: overrides.plantSpeciesSymbols ?? {},
      measurementGuides: overrides.measurementGuides ?? [],
    },
    viewport: overrides.viewport ?? { x: 0, y: 0, scale: 1 },
  })
}

function createPlant(
  overrides: Partial<SceneRendererSnapshot['scene']['plants'][number]> = {},
): SceneRendererSnapshot['scene']['plants'][number] {
  return {
    kind: 'plant',
    locked: false,
    id: 'plant-1',
    canonicalName: 'Malus domestica',
    commonName: 'Apple',
    color: null,
    stratum: null,
    canopySpreadM: null,
    position: { x: 10, y: 10 },
    rotationDeg: null,
    notes: null,
    plantedDate: null,
    quantity: 1,
    ...overrides,
  }
}
