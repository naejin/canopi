import { afterEach, describe, expect, it, vi } from 'vitest'

import { getCanvasColor } from '../canvas/theme-refresh'
import type { CameraViewportSnapshot } from '../canvas/runtime/camera'
import { SceneChromeOverlay } from '../canvas/runtime/scene-chrome'
import { getCanvasInteractionStrokeVisual, resolveZoneVisual } from '../canvas/runtime/scene-visuals'

function cameraSnapshot(): CameraViewportSnapshot {
  return {
    viewport: { x: 0, y: 0, scale: 8 },
    screenSize: { width: 320, height: 240 },
    devicePixelRatio: 1,
    referenceScale: 8,
    scaleBounds: { minimum: 0.00001, maximum: 2000 },
    overviewScaleThreshold: 0.1,
    mode: 'site',
    groundMetersPerCssPixel: null,
    revision: 1,
  }
}

describe('overlay stroke casing', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('gives every interaction stroke a wider casing in its theme contrast colour', () => {
    for (const state of ['hover', 'highlight', 'selected', 'locked-design-object', 'locked-layer'] as const) {
      const visual = getCanvasInteractionStrokeVisual(state)
      expect(visual.casingColor, state).toBe(getCanvasColor('interaction-casing'))
      expect(visual.casingWidthPx, state).toBeGreaterThanOrEqual(visual.widthPx + 2)
    }
  })

  it('cases Zone strokes in the dark overlay casing', () => {
    const visual = resolveZoneVisual({
      kind: 'zone', id: 'bed', name: 'bed', zoneType: 'rect', locked: false, rotationDeg: 0,
      points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], fillColor: null, notes: null,
    })
    expect(visual.stroke).toBe(getCanvasColor('zone-stroke'))
    expect(visual.casing).toBe(getCanvasColor('overlay-casing'))
  })

  it('strokes ruler guides over a wider dark casing', () => {
    vi.stubGlobal('devicePixelRatio', 1)
    const strokes: Array<{ strokeStyle: string; lineWidth: number }> = []
    const context = {
      setTransform: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(),
      lineTo: vi.fn(), fillText: vi.fn(), translate: vi.fn(), rotate: vi.fn(), save: vi.fn(), restore: vi.fn(),
      setLineDash: vi.fn(), fillStyle: '', strokeStyle: '', lineWidth: 0, font: '',
      stroke: vi.fn(() => { strokes.push({ strokeStyle: context.strokeStyle, lineWidth: context.lineWidth }) }),
    }
    const rulerContext = { ...context, stroke: vi.fn() }
    let gridCanvas: HTMLCanvasElement | null = null
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      return (this === gridCanvas ? context : rulerContext) as never
    })
    const container = document.createElement('div')
    const overlay = new SceneChromeOverlay(container, vi.fn())
    gridCanvas = container.querySelector<HTMLCanvasElement>('[data-scene-chrome-part="grid"]')
    overlay.update({
      camera: cameraSnapshot(),
      chromeVisible: true,
      rulersVisible: false,
      gridVisible: false,
      guides: [{ id: 'guide-v', axis: 'v', position: 10 }],
    })

    expect(strokes).toEqual([
      { strokeStyle: getCanvasColor('overlay-casing'), lineWidth: 3 },
      { strokeStyle: getCanvasColor('guide-line'), lineWidth: 1 },
    ])
    overlay.destroy()
  })
})
