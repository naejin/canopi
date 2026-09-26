import { describe, expect, it, vi } from 'vitest'

import { drawInspectionLensScene } from '../canvas/runtime/inspection-lens-drawing'
import type { SceneRendererSnapshot } from '../canvas/runtime/renderers/scene-types'
import type { SceneDesignObjectSelection } from '../canvas/runtime/scene'
import { createTestSceneRendererSnapshot } from './support/scene-renderer-snapshot'

function draw(
  ctx: ReturnType<typeof createMockCanvasContext>,
  snapshot: SceneRendererSnapshot,
  options: { widthPx?: number; heightPx?: number; dpr?: number } = {},
): void {
  drawInspectionLensScene(ctx as unknown as CanvasRenderingContext2D, snapshot, {
    widthPx: options.widthPx ?? 400,
    heightPx: options.heightPx ?? 300,
    dpr: options.dpr,
  })
}

describe('drawInspectionLensScene', () => {
  it('skips distant plants but draws edge footprints', () => {
    const ctx = createMockCanvasContext()
    draw(ctx, createRendererSnapshot({
      plants: [createPlant({ id: 'edge', position: { x: -.1, y: 1 } }),
        createPlant({ id: 'far', position: { x: 1000, y: 1 } })],
      viewport: { x: 0, y: 0, scale: 30 },
    }))
    expect(ctx.fill).toHaveBeenCalledTimes(1)
  })

  it('retains offscreen neighbours when calculating an edge plant footprint', () => {
    const ctx = createMockCanvasContext()
    draw(ctx, createRendererSnapshot({
      plants: [createPlant({ id: 'edge', position: { x: -31 / 30, y: 1 } }),
        createPlant({ id: 'neighbour', position: { x: -33 / 30, y: 1 } })],
      viewport: { x: 0, y: 0, scale: 30 },
    }))
    expect(ctx.arc).toHaveBeenCalledTimes(1)
    // Two CSS pixels between centres leaves a .84 CSS-pixel position mark.
    expect(ctx.arc.mock.calls[0]?.[2]).toBeCloseTo(.028)
  })

  it('renders crowded position marks as solid dots without outlines exceeding their footprints', () => {
    const ctx = createMockCanvasContext()
    draw(ctx, createRendererSnapshot({
      plants: [createPlant({ id: 'a', position: { x: 0, y: 0 } }), createPlant({ id: 'b', position: { x: .27, y: 0 } })],
      viewport: { x: 0, y: 0, scale: 10 },
    }))
    expect(ctx.fill).toHaveBeenCalledTimes(2)
    expect(ctx.stroke).not.toHaveBeenCalled()
  })

  it('keeps Zone outlines two CSS pixels wide over a four-pixel casing on a high-density backing store', () => {
    const canvas = createTransformTrackingCanvasContext(2)
    const widths: number[] = []
    canvas.context.stroke.mockImplementation(() => { widths.push(canvas.context.lineWidth) })
    draw(canvas.context, createRendererSnapshot({
      viewport: { x: 0, y: 0, scale: 20 },
      zones: [{ kind: 'zone', name: 'bed', zoneType: 'rect', locked: false, rotationDeg: 0,
        points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], fillColor: null, notes: null }],
    }), { dpr: 2 })
    expect(widths).toEqual([0.2, 0.1])
  })

  it('draws plant symbol glyphs at readable zoom and collapses them to dots at low zoom', () => {
    const snapshot = createRendererSnapshot({
      plants: [
        createPlant({ id: 'rosette', symbol: 'rosette', position: { x: 10, y: 10 } }),
        createPlant({ id: 'conifer', canonicalName: 'Pyrus communis', position: { x: 15, y: 10 } }),
      ],
      plantSpeciesSymbols: { 'Pyrus communis': 'conifer' },
      viewport: { x: 0, y: 0, scale: 20 },
    })
    const readable = createMockCanvasContext()
    draw(readable, snapshot)
    expect(readable.bezierCurveTo).toHaveBeenCalled()
    expect(readable.lineTo).toHaveBeenCalled()

    const distant = createMockCanvasContext()
    draw(distant, { ...snapshot, viewport: { x: 0, y: 0, scale: 0.25 } })
    expect(distant.arc).toHaveBeenCalled()
    expect(distant.rect).not.toHaveBeenCalled()
    expect(distant.lineTo).not.toHaveBeenCalled()
  })

  it('draws curved plant symbol recipes with native Canvas2D curves', () => {
    const ctx = createMockCanvasContext()
    draw(ctx, createRendererSnapshot({
      plants: [
        createPlant({ id: 'shrub', symbol: 'shrub', position: { x: 10, y: 10 } }),
        createPlant({ id: 'groundcover', symbol: 'groundcover', position: { x: 15, y: 10 } }),
      ],
      viewport: { x: 0, y: 0, scale: 20 },
    }))
    expect(ctx.bezierCurveTo).toHaveBeenCalled()
    expect(ctx.fill).toHaveBeenCalled()
    expect(ctx.stroke).toHaveBeenCalled()
  })

  it('keeps a Placed Plant stack badge anchored and screen-sized on a HiDPI canvas', () => {
    const canvas = createTransformTrackingCanvasContext(2)
    draw(canvas.context, createRendererSnapshot({
      plants: [
        createPlant({ id: 'plant-1', position: { x: 10, y: 20 } }),
        createPlant({ id: 'plant-2', position: { x: 10, y: 20 } }),
      ],
      viewport: { x: 40, y: -15, scale: 3 },
    }), { dpr: 2 })

    const plantCenter = canvas.arcs[0]!.centerCss
    const badgeText = canvas.texts.find((entry) => entry.text === '2')!
    expect(badgeText.originCss.x).toBeGreaterThan(plantCenter.x)
    expect(badgeText.originCss.y).toBeLessThan(plantCenter.y)
    expect(Math.max(...canvas.arcs.map((entry) => entry.radiusCss))).toBe(7)
  })

  it('rings the hovered lens plant with the shared hover visual', () => {
    const ctx = createMockCanvasContext()
    draw(ctx, {
      ...createRendererSnapshot({
        plants: [createPlant({ id: 'a', position: { x: 10, y: 10 } }), createPlant({ id: 'b', position: { x: 30, y: 10 } })],
        viewport: { x: 0, y: 0, scale: 10 },
      }),
      hoverTarget: { kind: 'plant', id: 'a', state: 'hover' },
    })
    const plainStrokes = createMockCanvasContext()
    draw(plainStrokes, createRendererSnapshot({
      plants: [createPlant({ id: 'a', position: { x: 10, y: 10 } }), createPlant({ id: 'b', position: { x: 30, y: 10 } })],
      viewport: { x: 0, y: 0, scale: 10 },
    }))
    // The hover ring is one casing stroke and one ring stroke.
    expect(ctx.stroke.mock.calls.length).toBe(plainStrokes.stroke.mock.calls.length + 2)
  })
})

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
