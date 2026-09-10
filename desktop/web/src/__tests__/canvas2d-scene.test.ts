import { afterEach, describe, expect, it, vi } from 'vitest'

import { MEASUREMENT_GUIDE_LABEL_OFFSET_PX } from '../canvas/runtime/measurement-guides'
import { createCanvas2DSceneRenderer, renderCanvas2DSceneSnapshot } from '../canvas/runtime/renderers/canvas2d-scene'
import type { SceneRendererSnapshot } from '../canvas/runtime/renderers/scene-types'
import type { SceneDesignObjectSelection } from '../canvas/runtime/scene'
import { createTestSceneRendererSnapshot } from './support/scene-renderer-snapshot'

describe('createCanvas2DSceneRenderer', () => {
  it('renders crowded position marks as solid dots without outlines exceeding their footprints', () => {
    const ctx = createMockCanvasContext()
    renderCanvas2DSceneSnapshot(ctx as unknown as CanvasRenderingContext2D, createRendererSnapshot({
      plants: [createPlant({ id: 'a', position: { x: 0, y: 0 } }), createPlant({ id: 'b', position: { x: .27, y: 0 } })],
      viewport: { x: 0, y: 0, scale: 10 },
    }), { widthPx: 400, heightPx: 300 })
    expect(ctx.fill).toHaveBeenCalledTimes(2)
    expect(ctx.stroke).not.toHaveBeenCalled()
  })

  it('keeps short measurement lines quiet and reveals their distance on inspection or closer zoom', async () => {
    const { canvas, renderer } = await initializeTransformTrackingRenderer(2)
    const snapshot = createRendererSnapshot({
      measurementGuides: [{ kind: 'measurement-guide', id: 'gap', start: { x: 0, y: 0 }, end: { x: .8, y: 0 }, locked: false }],
      viewport: { x: 0, y: 0, scale: 20 },
    })
    renderer.renderScene(snapshot)
    expect(canvas.texts).toHaveLength(0)
    renderer.renderScene({ ...snapshot, hoverTarget: { kind: 'measurement-guide', id: 'gap', state: 'hover' } })
    expect(canvas.texts.map((entry) => entry.text)).toEqual(['80 cm'])
    renderer.renderScene(snapshot)
    canvas.clearDraws()
    renderer.setViewport({ x: 10, y: 20, scale: 400 })
    expect(canvas.texts.map((entry) => entry.text)).toEqual(['80 cm'])
    renderer.dispose()
  })

  it('replaces crowded note text with its marker and restores text on hover and a spacious viewport', async () => {
    const { canvas, renderer } = await initializeTransformTrackingRenderer(1.5)
    const snapshot = createRendererSnapshot({
      plants: [createPlant({ position: { x: 10, y: 20 } })],
      annotations: [{ kind: 'annotation', id: 'note', annotationType: 'text', position: { x: 0, y: 20 },
        text: 'A long note over the plant', fontSize: 16, rotationDeg: 0, locked: false }],
      viewport: { x: 0, y: 0, scale: 20 },
    })
    renderer.renderScene(snapshot)
    expect(canvas.texts.some((entry) => entry.text === 'A long note over the plant')).toBe(false)
    renderer.renderScene({ ...snapshot, hoverTarget: { kind: 'annotation', id: 'note', state: 'hover' } })
    expect(canvas.texts.some((entry) => entry.text === 'A long note over the plant')).toBe(true)
    renderer.renderScene(snapshot)
    canvas.clearDraws()
    renderer.setViewport({ x: 15, y: 30, scale: 400 })
    expect(canvas.texts.some((entry) => entry.text === 'A long note over the plant')).toBe(true)
    renderer.dispose()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('keeps Zone outlines two CSS pixels wide on a high-density backing store', () => {
    const canvas = createTransformTrackingCanvasContext(2)
    const widths: number[] = []
    canvas.context.stroke.mockImplementation(() => { widths.push(canvas.context.lineWidth) })
    renderCanvas2DSceneSnapshot(canvas.context as unknown as CanvasRenderingContext2D, createRendererSnapshot({
      viewport: { x: 0, y: 0, scale: 20 },
      zones: [{ kind: 'zone', name: 'bed', zoneType: 'rect', locked: false, rotationDeg: 0,
        points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], fillColor: null, notes: null }],
    }), { widthPx: 400, heightPx: 300, dpr: 2 })
    expect(widths).toEqual([0.1])
  })

  it('draws plant symbol glyphs at readable zoom and collapses them to dots at low zoom', async () => {
    const ctx = createMockCanvasContext()
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext') as unknown as {
      mockImplementation(implementation: (contextId: string) => CanvasRenderingContext2D | null): void
    }
    getContextSpy.mockImplementation((contextId: string) => {
      return contextId === '2d' ? ctx as unknown as CanvasRenderingContext2D : null
    })

    const host = document.createElement('div')
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 400 })
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 300 })

    const renderer = await createCanvas2DSceneRenderer().initialize({ container: host }, {
      backendId: 'canvas2d',
      capabilities: {
        domCanvas: true,
        canvas2d: true,
        offscreenCanvas: false,
        offscreenCanvas2d: false,
        webgl: false,
        webgl2: false,
        webgpu: false,
        imageBitmap: false,
        createImageBitmap: false,
        worker: false,
        devicePixelRatio: 1,
        prefersReducedMotion: null,
      },
    } as never)

    const snapshot = createRendererSnapshot({
      plants: [
        createPlant({ id: 'rosette', symbol: 'rosette', position: { x: 10, y: 10 } }),
        createPlant({ id: 'conifer', canonicalName: 'Pyrus communis', position: { x: 30, y: 10 } }),
      ],
      plantSpeciesSymbols: { 'Pyrus communis': 'conifer' },
      viewport: { x: 0, y: 0, scale: 20 },
    })

    renderer.renderScene(snapshot)

    expect(ctx.bezierCurveTo).toHaveBeenCalled()
    expect(ctx.lineTo).toHaveBeenCalled()

    vi.clearAllMocks()
    renderer.renderScene({
      ...snapshot,
      viewport: { x: 0, y: 0, scale: 0.25 },
    })

    expect(ctx.arc).toHaveBeenCalled()
    expect(ctx.rect).not.toHaveBeenCalled()
    expect(ctx.lineTo).not.toHaveBeenCalled()
    renderer.dispose()
  })

  it('keeps a pinned plant name attached after viewport changes on a HiDPI canvas', async () => {
    const { canvas, renderer } = await initializeTransformTrackingRenderer(2)
    renderer.renderScene(createRendererSnapshot({
      plants: [createPlant({
        pinnedName: true,
        position: { x: 10, y: 20 },
      })],
      selectedTargets: [{ kind: 'plant', id: 'plant-1' }],
      viewport: { x: 0, y: 0, scale: 2 },
    }))

    renderer.setViewport({ x: 0, y: 0, scale: 3 })
    renderer.setViewport({ x: 0, y: 0, scale: 1.5 })
    canvas.clearDraws()
    renderer.setViewport({ x: 40, y: -15, scale: 1.5 })

    expect(canvas.arcs[0]?.centerCss).toEqual({ x: 55, y: 15 })
    const label = canvas.texts.find((entry) => entry.text === 'Apple')
    expect(label?.originCss.x).toBe(55)
    expect(label?.originCss.y).toBeGreaterThan(15)
    renderer.dispose()
  })

  it('keeps a pinned plant name attached at a fractional device pixel ratio', async () => {
    const { canvas, renderer } = await initializeTransformTrackingRenderer(1.25)
    renderer.renderScene(createRendererSnapshot({
      plants: [createPlant({
        pinnedName: true,
        position: { x: 10, y: 20 },
      })],
      selectedTargets: [{ kind: 'plant', id: 'plant-1' }],
      viewport: { x: 0, y: 0, scale: 2 },
    }))

    canvas.clearDraws()
    renderer.setViewport({ x: 12.5, y: -6.25, scale: 1.75 })

    expect(canvas.arcs[0]?.centerCss.x).toBeCloseTo(30)
    expect(canvas.arcs[0]?.centerCss.y).toBeCloseTo(28.75)
    const label = canvas.texts.find((entry) => entry.text === 'Apple')
    expect(label?.originCss.x).toBeCloseTo(30)
    expect(label?.originCss.y).toBeGreaterThan(28.75)
    renderer.dispose()
  })

  it('refreshes pinned-name opacity without scaling its font or ignoring Layer opacity', async () => {
    const { canvas, renderer } = await initializeTransformTrackingRenderer(1.25)
    renderer.renderScene(createRendererSnapshot({
      plants: [createPlant({ pinnedName: true })],
      layers: [{ kind: 'layer', name: 'plants', visible: true, locked: false, opacity: 0.6 }],
    }))
    for (const [scale, opacity] of [[20, 0.6], [14, 0.3], [8, 0], [14, 0.3], [20, 0.6]]) {
      canvas.clearDraws()
      renderer.setViewport({ x: 0, y: 0, scale: scale! })
      const labels = canvas.texts.filter((entry) => entry.text === 'Apple')
      expect(labels).toHaveLength(opacity === 0 ? 0 : 1)
      if (opacity) {
        expect(labels[0]?.alpha).toBeCloseTo(opacity)
        expect(labels[0]?.font).toBe('600 12px Inter, sans-serif')
      }
    }
    renderer.dispose()
  })

  it('keeps a selected plant label attached on a HiDPI canvas', async () => {
    const { canvas, renderer } = await initializeTransformTrackingRenderer(2)
    renderer.renderScene(createRendererSnapshot({
      plants: [createPlant({ position: { x: 10, y: 20 } })],
      selectedTargets: [{ kind: 'plant', id: 'plant-1' }],
      viewport: { x: 0, y: 0, scale: 2 },
    }))

    canvas.clearDraws()
    renderer.setViewport({ x: 40, y: -15, scale: 3 })

    expect(canvas.arcs[0]?.centerCss).toEqual({ x: 70, y: 45 })
    const label = canvas.texts.find((entry) => entry.text === 'Apple')
    expect(label?.originCss.x).toBe(70)
    expect(label?.originCss.y).toBeGreaterThan(45)
    renderer.dispose()
  })

  it.each([1, 1.25, 2])('crossfades Annotation text and markers on viewport-only updates at DPR %s', async (dpr) => {
    const { canvas, renderer } = await initializeTransformTrackingRenderer(dpr)
    const snapshot = createRendererSnapshot({
      annotations: [{ kind: 'annotation', id: 'note', annotationType: 'text', locked: false,
        position: { x: 10, y: 20 }, text: 'First\nSecond', fontSize: 16, rotationDeg: 45 }],
      layers: [{ kind: 'layer', name: 'annotations', visible: true, locked: false, opacity: 0.6 }],
      viewport: { x: 5, y: 10, scale: 20 },
    })
    renderer.renderScene(snapshot)
    expect(canvas.texts.filter((text) => text.text === 'First')).toHaveLength(1)
    for (const [scale, opacity] of [[20, 0.6], [14, 0.3], [8, 0], [14, 0.3], [20, 0.6]]) {
      canvas.clearDraws()
      canvas.context.moveTo.mockClear()
      renderer.setViewport({ x: 5, y: 10, scale: scale! })
      const lines = canvas.texts.filter((text) => ['First', 'Second'].includes(text.text))
      expect(lines).toHaveLength(opacity === 0 ? 0 : 2)
      for (const line of lines) {
        expect(line.alpha).toBe(opacity)
        expect(line.font).toBe('16px Inter, sans-serif')
      }
      if (scale! < 20) expect(canvas.context.moveTo).toHaveBeenCalledWith(5 + 10 * scale! - 4, 10 + 20 * scale! - 4)
    }
    canvas.clearDraws()
    renderer.renderScene({ ...snapshot, viewport: { x: 0, y: 0, scale: 4 }, revealedAnnotationId: 'note', selectedAnnotationIds: new Set(['note']) })
    expect(canvas.texts.find((text) => text.text === 'First')?.alpha).toBe(0.6)
    canvas.clearDraws()
    renderer.renderScene({ ...snapshot, scene: { ...snapshot.scene, layers: [{ kind: 'layer', name: 'annotations', visible: false, locked: false, opacity: 1 }] } })
    expect(canvas.texts).toEqual([])
    renderer.dispose()
  })

  it('keeps annotation text anchored on a HiDPI canvas', async () => {
    const { canvas, renderer } = await initializeTransformTrackingRenderer(2)

    renderer.renderScene(createRendererSnapshot({
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
      selectedTargets: [{ kind: 'annotation', id: 'annotation-1' }],
      viewport: { x: 10, y: 20, scale: 2 },
    }))

    expect(canvas.texts.find((entry) => entry.text === 'Hello')?.originCss).toEqual({ x: 60, y: 90 })
    renderer.dispose()
  })

  it('keeps a Measurement Guide label anchored on a HiDPI canvas', async () => {
    const { canvas, renderer } = await initializeTransformTrackingRenderer(2)

    renderer.renderScene(createRendererSnapshot({
      selectedTargets: [{ kind: 'measurement-guide', id: 'guide-1' }],
      measurementGuides: [{
        kind: 'measurement-guide',
        id: 'guide-1',
        locked: false,
        start: { x: 0, y: 0 },
        end: { x: 10, y: 0 },
      }],
      layers: [{
        kind: 'layer',
        name: 'measurement-guides',
        visible: true,
        locked: false,
        opacity: 1,
      }],
      viewport: { x: 10, y: 20, scale: 2 },
    }))

    expect(canvas.texts.find((entry) => entry.text === '10 m')?.originCss).toEqual({
      x: 20,
      y: 10.5,
    })
    renderer.dispose()
  })

  it('keeps a Placed Plant stack badge anchored and screen-sized on a HiDPI canvas', async () => {
    const { canvas, renderer } = await initializeTransformTrackingRenderer(2)

    renderer.renderScene(createRendererSnapshot({
      plants: [
        createPlant({ id: 'plant-1', position: { x: 10, y: 20 } }),
        createPlant({ id: 'plant-2', position: { x: 10, y: 20 } }),
      ],
      viewport: { x: 40, y: -15, scale: 3 },
    }))

    const plantCenter = canvas.arcs[0]!.centerCss
    const badgeText = canvas.texts.find((entry) => entry.text === '2')!
    expect(badgeText.originCss.x).toBeGreaterThan(plantCenter.x)
    expect(badgeText.originCss.y).toBeLessThan(plantCenter.y)
    expect(Math.max(...canvas.arcs.map((entry) => entry.radiusCss))).toBe(7)
    renderer.dispose()
  })

  it('paints a print underlay after the background without leaking canvas state', () => {
    const ctx = createMockCanvasContext()
    const calls: string[] = []
    ctx.fillRect.mockImplementation(() => {
      calls.push('background')
    })
    ctx.save.mockImplementation(() => {
      calls.push('save')
    })
    ctx.restore.mockImplementation(() => {
      calls.push('restore')
    })
    const underlay = vi.fn((underlayCtx: CanvasRenderingContext2D, widthPx: number, heightPx: number) => {
      calls.push('underlay')
      underlayCtx.globalAlpha = 0.25
      expect(widthPx).toBe(200)
      expect(heightPx).toBe(120)
    })

    renderCanvas2DSceneSnapshot(
      ctx as unknown as CanvasRenderingContext2D,
      createRendererSnapshot(),
      {
        widthPx: 200,
        heightPx: 120,
        background: '#FFFFFF',
        underlay,
      },
    )

    expect(underlay).toHaveBeenCalledWith(ctx, 200, 120)
    expect(calls.slice(0, 4)).toEqual(['background', 'save', 'underlay', 'restore'])
  })

  it('draws curved plant symbol recipes with native Canvas2D curves', async () => {
    const ctx = createMockCanvasContext()
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext') as unknown as {
      mockImplementation(implementation: (contextId: string) => CanvasRenderingContext2D | null): void
    }
    getContextSpy.mockImplementation((contextId: string) => {
      return contextId === '2d' ? ctx as unknown as CanvasRenderingContext2D : null
    })

    const host = document.createElement('div')
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 400 })
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 300 })

    const renderer = await createCanvas2DSceneRenderer().initialize({ container: host }, {
      backendId: 'canvas2d',
      capabilities: {
        domCanvas: true,
        canvas2d: true,
        offscreenCanvas: false,
        offscreenCanvas2d: false,
        webgl: false,
        webgl2: false,
        webgpu: false,
        imageBitmap: false,
        createImageBitmap: false,
        worker: false,
        devicePixelRatio: 1,
        prefersReducedMotion: null,
      },
    } as never)

    renderer.renderScene(createRendererSnapshot({
      plants: [
        createPlant({ id: 'shrub', symbol: 'shrub', position: { x: 10, y: 10 } }),
        createPlant({ id: 'groundcover', symbol: 'groundcover', position: { x: 30, y: 10 } }),
      ],
      viewport: { x: 0, y: 0, scale: 20 },
    }))

    expect(ctx.bezierCurveTo).toHaveBeenCalled()
    expect(ctx.fill).toHaveBeenCalled()
    expect(ctx.stroke).toHaveBeenCalled()
    renderer.dispose()
  })

  it('does not restore selection labels for mixed selections on viewport changes', async () => {
    const ctx = createMockCanvasContext()
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext') as unknown as {
      mockImplementation(implementation: (contextId: string) => CanvasRenderingContext2D | null): void
    }
    getContextSpy.mockImplementation((contextId: string) => {
      return contextId === '2d' ? ctx as unknown as CanvasRenderingContext2D : null
    })

    const host = document.createElement('div')
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 400 })
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 300 })

    const renderer = await createCanvas2DSceneRenderer().initialize({ container: host }, {
      backendId: 'canvas2d',
      capabilities: {
        domCanvas: true,
        canvas2d: true,
        offscreenCanvas: false,
        offscreenCanvas2d: false,
        webgl: false,
        webgl2: false,
        webgpu: false,
        imageBitmap: false,
        createImageBitmap: false,
        worker: false,
        devicePixelRatio: 1,
        prefersReducedMotion: null,
      },
    } as never)

    const snapshot = createRendererSnapshot({
      plants: [createPlant({ id: 'plant-1', position: { x: 10, y: 10 } })],
      zones: [{
        kind: 'zone',
        locked: false,
        name: 'zone-1',
        zoneType: 'rect',
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 10 },
          { x: 0, y: 10 },
        ],
        rotationDeg: 0,
        fillColor: null,
        notes: null,
      }],
      selectedTargets: [
        { kind: 'plant', id: 'plant-1' },
        { kind: 'zone', id: 'zone-1' },
      ],
      selectionLabels: [{
        canonicalName: 'Malus domestica',
        text: 'Apple',
        fontStyle: 'normal',
        screenPoint: { x: 10, y: 15 },
      }],
      viewport: { x: 0, y: 0, scale: 2 },
    })

    renderer.renderScene(snapshot)
    vi.clearAllMocks()

    renderer.setViewport({ x: 3, y: 4, scale: 3 })

    expect(ctx.fillText).not.toHaveBeenCalledWith('Apple', expect.any(Number), expect.any(Number))
    renderer.dispose()
  })

  it('applies text annotation rotation in screen space', async () => {
    const ctx = createMockCanvasContext()
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext') as unknown as {
      mockImplementation(implementation: (contextId: string) => CanvasRenderingContext2D | null): void
    }
    getContextSpy.mockImplementation((contextId: string) => {
      return contextId === '2d' ? ctx as unknown as CanvasRenderingContext2D : null
    })

    const host = document.createElement('div')
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 400 })
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 300 })

    const renderer = await createCanvas2DSceneRenderer().initialize({ container: host }, {
      backendId: 'canvas2d',
      capabilities: {
        domCanvas: true,
        canvas2d: true,
        offscreenCanvas: false,
        offscreenCanvas2d: false,
        webgl: false,
        webgl2: false,
        webgpu: false,
        imageBitmap: false,
        createImageBitmap: false,
        worker: false,
        devicePixelRatio: 1,
        prefersReducedMotion: null,
      },
    } as never)

    const snapshot: SceneRendererSnapshot = {
      scene: {
        plants: [],
        zones: [],
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
        groups: [],
        layers: [],
        plantSpeciesColors: {},
        plantSpeciesSymbols: {},
        measurementGuides: [],
        guides: [],
      },
      viewport: { x: 10, y: 20, scale: 2 },
      revealedAnnotationId: 'annotation-1',
      selectionLabelPlantIds: new Set<string>(),
      selectedPlantIds: new Set<string>(),
      selectedZoneIds: new Set<string>(),
      selectedAnnotationIds: new Set<string>(),
      selectedMeasurementGuideIds: new Set<string>(),
      highlightedPlantIds: new Set<string>(),
      highlightedZoneIds: new Set<string>(),
      localizedCommonNames: new Map(),
      hoveredCanonicalName: null,
      hoverTarget: null,
      pinnedPlantNameLabels: [],
      selectionLabels: [],
      speciesCache: new Map(),
    }

    renderer.renderScene(snapshot)

    expect(ctx.translate).toHaveBeenCalledWith(60, 90)
    expect(ctx.rotate).toHaveBeenCalledWith(Math.PI / 2)
    expect(ctx.fillText).toHaveBeenCalledWith('Hello', 0, 0)
    renderer.dispose()
  })

  it('draws Measurement Guides as dashed lines with end ticks and labels', async () => {
    const ctx = createMockCanvasContext()
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext') as unknown as {
      mockImplementation(implementation: (contextId: string) => CanvasRenderingContext2D | null): void
    }
    getContextSpy.mockImplementation((contextId: string) => {
      return contextId === '2d' ? ctx as unknown as CanvasRenderingContext2D : null
    })

    const host = document.createElement('div')
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 400 })
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 300 })

    const renderer = await createCanvas2DSceneRenderer().initialize({ container: host }, {
      backendId: 'canvas2d',
      capabilities: {
        domCanvas: true,
        canvas2d: true,
        offscreenCanvas: false,
        offscreenCanvas2d: false,
        webgl: false,
        webgl2: false,
        webgpu: false,
        imageBitmap: false,
        createImageBitmap: false,
        worker: false,
        devicePixelRatio: 1,
        prefersReducedMotion: null,
      },
    } as never)

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

    expect(ctx.setLineDash).toHaveBeenCalledWith(expect.arrayContaining([expect.any(Number)]))
    expect(ctx.moveTo).toHaveBeenCalledWith(40, 10)
    expect(ctx.lineTo).toHaveBeenCalledWith(10, 40)
    const expectedLabelPoint = {
      x: 50 - MEASUREMENT_GUIDE_LABEL_OFFSET_PX * Math.SQRT1_2,
      y: 50 - MEASUREMENT_GUIDE_LABEL_OFFSET_PX * Math.SQRT1_2,
    }
    const labelTranslateCall = ctx.translate.mock.calls.find(([x, y]) =>
      Math.abs(x - expectedLabelPoint.x) < 0.0001 && Math.abs(y - expectedLabelPoint.y) < 0.0001
    )
    expect(labelTranslateCall).toBeDefined()
    expect(ctx.rotate).toHaveBeenCalledWith(-Math.PI / 4)
    expect(ctx.fillText).toHaveBeenCalledWith('42 m', 0, 0)

    vi.clearAllMocks()
    renderer.renderScene({
      ...snapshot,
      scene: {
        ...snapshot.scene,
        layers: [{ kind: 'layer', name: 'measurement-guides', visible: false, locked: false, opacity: 1 }],
      },
    })

    expect(ctx.lineTo).not.toHaveBeenCalled()
    expect(ctx.fillText).not.toHaveBeenCalled()
    renderer.dispose()
  })
})

async function initializeTransformTrackingRenderer(dpr: number) {
  vi.stubGlobal('devicePixelRatio', dpr)
  const canvas = createTransformTrackingCanvasContext(dpr)
  const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext') as unknown as {
    mockImplementation(implementation: (contextId: string) => CanvasRenderingContext2D | null): void
  }
  getContextSpy.mockImplementation((contextId) => (
    contextId === '2d' ? canvas.context as unknown as CanvasRenderingContext2D : null
  ))

  const host = document.createElement('div')
  Object.defineProperty(host, 'clientWidth', { configurable: true, value: 400 })
  Object.defineProperty(host, 'clientHeight', { configurable: true, value: 300 })
  const renderer = await createCanvas2DSceneRenderer().initialize({ container: host }, {
    backendId: 'canvas2d',
    capabilities: {
      domCanvas: true,
      canvas2d: true,
      offscreenCanvas: false,
      offscreenCanvas2d: false,
      webgl: false,
      webgl2: false,
      webgpu: false,
      imageBitmap: false,
      createImageBitmap: false,
      worker: false,
      devicePixelRatio: dpr,
      prefersReducedMotion: null,
    },
  } as never)

  return { canvas, renderer }
}

function createRendererSnapshot(overrides: {
  plants?: SceneRendererSnapshot['scene']['plants']
  zones?: SceneRendererSnapshot['scene']['zones']
  annotations?: SceneRendererSnapshot['scene']['annotations']
  measurementGuides?: SceneRendererSnapshot['scene']['measurementGuides']
  layers?: SceneRendererSnapshot['scene']['layers']
  plantSpeciesSymbols?: Record<string, string>
  viewport?: SceneRendererSnapshot['viewport']
  selectedTargets?: SceneDesignObjectSelection
  selectionLabels?: SceneRendererSnapshot['selectionLabels']
} = {}): SceneRendererSnapshot {
  return createTestSceneRendererSnapshot({
    scene: {
      plants: overrides.plants ?? [],
      zones: overrides.zones ?? [],
      annotations: overrides.annotations ?? [],
      groups: [],
      layers: overrides.layers ?? [],
      plantSpeciesColors: {},
      plantSpeciesSymbols: overrides.plantSpeciesSymbols ?? {},
      measurementGuides: overrides.measurementGuides ?? [],
      guides: [],
    },
    viewport: overrides.viewport ?? { x: 10, y: 20, scale: 2 },
    selectedTargets: overrides.selectedTargets,
    selectionLabels: overrides.selectionLabels ?? [],
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
    scale: null,
    notes: null,
    plantedDate: null,
    quantity: 1,
    ...overrides,
  }
}

function createMockCanvasContext() {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    ellipse: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),
    arc: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    rotate: vi.fn(),
    getTransform: vi.fn(() => ({ a: 1 })),
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    fillStyle: '',
    strokeStyle: '',
    globalAlpha: 1,
    lineWidth: 1,
  }
}

function createTransformTrackingCanvasContext(backingStoreScale: number) {
  type Transform = { a: number; b: number; c: number; d: number; e: number; f: number }
  let transform: Transform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
  const stack: Transform[] = []
  const arcs: Array<{ centerCss: { x: number; y: number }; radiusCss: number }> = []
  const texts: Array<{ text: string; alpha: number; font: string; originCss: { x: number; y: number } }> = []
  const toCssPoint = (x: number, y: number) => ({
    x: (transform.a * x + transform.c * y + transform.e) / backingStoreScale,
    y: (transform.b * x + transform.d * y + transform.f) / backingStoreScale,
  })
  const context = {
    ...createMockCanvasContext(),
    setTransform: vi.fn((a: number, b: number, c: number, d: number, e: number, f: number) => {
      transform = { a, b, c, d, e, f }
    }),
    getTransform: vi.fn(() => ({ ...transform })),
    translate: vi.fn((x: number, y: number) => {
      transform = {
        ...transform,
        e: transform.e + transform.a * x + transform.c * y,
        f: transform.f + transform.b * x + transform.d * y,
      }
    }),
    scale: vi.fn((x: number, y: number) => {
      transform = {
        ...transform,
        a: transform.a * x,
        b: transform.b * x,
        c: transform.c * y,
        d: transform.d * y,
      }
    }),
    save: vi.fn(() => stack.push({ ...transform })),
    restore: vi.fn(() => {
      transform = stack.pop() ?? transform
    }),
    arc: vi.fn((x: number, y: number, radius: number) => {
      arcs.push({
        centerCss: toCssPoint(x, y),
        radiusCss: Math.hypot(transform.a, transform.b) * radius / backingStoreScale,
      })
    }),
    fillText: vi.fn((text: string, x: number, y: number) => {
      texts.push({ text, alpha: context.globalAlpha, font: context.font, originCss: toCssPoint(x, y) })
    }),
  }

  return {
    context,
    arcs,
    texts,
    clearDraws() {
      arcs.length = 0
      texts.length = 0
    },
  }
}
