import { afterEach, describe, expect, it, vi } from 'vitest'

import { getCanvasColor } from '../canvas/theme-refresh'
import type { CameraViewportSnapshot } from '../canvas/runtime/camera'
import { SceneChromeOverlay } from '../canvas/runtime/scene-chrome'
import { getCanvasInteractionStrokeVisual, resolveZoneVisual } from '../canvas/runtime/scene-visuals'
import {
  createInteractionPreview,
  showInteractionPreview,
} from '../canvas/runtime/interaction/overlay-ui'
import { createPolygonDraftOverlay } from '../canvas/runtime/interaction/polygon-draft-overlay'
import type { WorkspaceCameraFrameReader } from '../canvas/runtime/camera'

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
    for (const state of ['hover', 'selected', 'locked-design-object', 'locked-layer'] as const) {
      const visual = getCanvasInteractionStrokeVisual(state)
      expect(visual.casingColor, state).toBe(getCanvasColor('interaction-casing'))
      expect(visual.casingWidthPx, state).toBeGreaterThanOrEqual(visual.widthPx + 2)
    }
  })

  it('cases Zone strokes in the dark overlay casing', () => {
    const visual = resolveZoneVisual({
      kind: 'zone', name: 'bed', zoneType: 'rect', locked: false, rotationDeg: 0,
      points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], fillColor: null, notes: null,
    })
    expect(visual.stroke).toBe(getCanvasColor('zone-stroke'))
    expect(visual.casing).toBe(getCanvasColor('overlay-casing'))
  })

  it('draws the band selection box as an ochre stroke over a casing on both sides', () => {
    const host = document.createElement('div')
    const preview = createInteractionPreview(host)
    showInteractionPreview(preview, 'band', { x: 10, y: 10 }, { x: 60, y: 40 })

    expect(preview.style.border).toBe('2px solid var(--canvas-selection-stroke)')
    expect(preview.style.background).toBe('var(--canvas-selection)')
    expect(preview.style.boxShadow).toContain('var(--canvas-interaction-casing)')
    expect(preview.style.boxShadow).toContain('inset')
  })

  it('draws zone and measurement drafts as light strokes over a dark casing', () => {
    const host = document.createElement('div')
    const preview = createInteractionPreview(host)

    showInteractionPreview(preview, 'rectangle', { x: 10, y: 10 }, { x: 60, y: 40 })
    expect(preview.style.border).toBe('2px solid var(--canvas-guide-line)')
    expect(preview.style.background).toBe('var(--canvas-zone-fill)')
    expect(preview.style.boxShadow).toContain('var(--canvas-overlay-casing)')

    showInteractionPreview(preview, 'line', { x: 10, y: 10 }, { x: 60, y: 40 })
    expect(preview.style.borderTop).toBe('2px solid var(--canvas-guide-line)')
    expect(preview.style.boxShadow).toContain('var(--canvas-overlay-casing)')
  })

  it('draws a dark casing under the polygon draft line before the light stroke', () => {
    const host = document.createElement('div')
    const overlay = createPolygonDraftOverlay(host)
    const camera = { worldToScreen: (point: { x: number; y: number }) => point } as unknown as WorkspaceCameraFrameReader
    overlay.update([{ x: 0, y: 0 }, { x: 40, y: 0 }], { x: 40, y: 30 }, camera)

    const polylines = [...host.querySelectorAll('polyline')]
    expect(polylines.map((line) => line.getAttribute('stroke'))).toEqual([
      'var(--canvas-overlay-casing)',
      'var(--canvas-guide-line)',
    ])
    expect(Number(polylines[0]!.getAttribute('stroke-width')))
      .toBeGreaterThan(Number(polylines[1]!.getAttribute('stroke-width')))
    expect(polylines[0]!.getAttribute('points')).toBe(polylines[1]!.getAttribute('points'))
    overlay.dispose()
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
