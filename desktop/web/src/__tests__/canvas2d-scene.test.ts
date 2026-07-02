import { afterEach, describe, expect, it, vi } from 'vitest'

import { MEASUREMENT_GUIDE_LABEL_OFFSET_PX } from '../canvas/runtime/measurement-guides'
import { createCanvas2DSceneRenderer, renderCanvas2DSceneSnapshot } from '../canvas/runtime/renderers/canvas2d-scene'
import type { SceneRendererSnapshot } from '../canvas/runtime/renderers/scene-types'

describe('createCanvas2DSceneRenderer', () => {
  afterEach(() => {
    vi.restoreAllMocks()
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
        createPlant({ id: 'square', symbol: 'square', position: { x: 10, y: 10 } }),
        createPlant({ id: 'triangle', canonicalName: 'Pyrus communis', position: { x: 30, y: 10 } }),
      ],
      plantSpeciesSymbols: { 'Pyrus communis': 'triangle' },
      viewport: { x: 0, y: 0, scale: 8 },
    })

    renderer.renderScene(snapshot)

    expect(ctx.rect).toHaveBeenCalled()
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
      viewport: { x: 0, y: 0, scale: 8 },
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
      selectedEntityIds: new Set(['plant-1', 'zone-1']),
      selectedPlantIds: new Set(['plant-1']),
      selectedZoneIds: new Set(['zone-1']),
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
        guides: [],
      },
      viewport: { x: 10, y: 20, scale: 2 },
      selectedPlantIds: new Set<string>(),
      selectedZoneIds: new Set<string>(),
      selectedAnnotationIds: new Set<string>(),
      selectedMeasurementGuideIds: new Set<string>(),
      highlightedPlantIds: new Set<string>(),
      highlightedZoneIds: new Set<string>(),
      sizeMode: 'default',
      colorByAttr: null,
      localizedCommonNames: new Map(),
      hoveredCanonicalName: null,
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

function createRendererSnapshot(overrides: {
  plants?: SceneRendererSnapshot['scene']['plants']
  zones?: SceneRendererSnapshot['scene']['zones']
  measurementGuides?: SceneRendererSnapshot['scene']['measurementGuides']
  layers?: SceneRendererSnapshot['scene']['layers']
  plantSpeciesSymbols?: Record<string, string>
  viewport?: SceneRendererSnapshot['viewport']
  selectedEntityIds?: SceneRendererSnapshot['selectedEntityIds']
  selectedPlantIds?: SceneRendererSnapshot['selectedPlantIds']
  selectedZoneIds?: SceneRendererSnapshot['selectedZoneIds']
  selectionLabels?: SceneRendererSnapshot['selectionLabels']
} = {}): SceneRendererSnapshot {
  return {
    scene: {
      plants: overrides.plants ?? [],
      zones: overrides.zones ?? [],
      annotations: [],
      groups: [],
      layers: overrides.layers ?? [],
      plantSpeciesColors: {},
      plantSpeciesSymbols: overrides.plantSpeciesSymbols ?? {},
      measurementGuides: overrides.measurementGuides ?? [],
      guides: [],
    },
    viewport: overrides.viewport ?? { x: 10, y: 20, scale: 2 },
    selectedEntityIds: overrides.selectedEntityIds,
    selectedPlantIds: overrides.selectedPlantIds ?? new Set<string>(),
    selectedZoneIds: overrides.selectedZoneIds ?? new Set<string>(),
    selectedAnnotationIds: new Set<string>(),
    selectedMeasurementGuideIds: new Set<string>(),
    highlightedPlantIds: new Set<string>(),
    highlightedZoneIds: new Set<string>(),
    sizeMode: 'default',
    colorByAttr: null,
    localizedCommonNames: new Map(),
    hoveredCanonicalName: null,
    selectionLabels: overrides.selectionLabels ?? [],
    speciesCache: new Map(),
  }
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
