// Production CSP rejects Pixi's generated functions; its shim avoids eval.
import 'pixi.js/unsafe-eval'
import type { Graphics } from 'pixi.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getCanvasColor } from '../canvas/theme-refresh'
import { createWorldLayers } from '../canvas/runtime/renderers/world-layers'
import { toPixiColor } from '../canvas/runtime/renderers/scene-paint'
import { getCanvasInteractionStrokeVisual, resolveZoneVisual } from '../canvas/runtime/scene-visuals'
import { createTestRendererView, createTestSceneRendererSnapshot } from './support/scene-renderer-snapshot'

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
    const layers = createWorldLayers()
    layers.syncScene({ ...createTestSceneRendererSnapshot(), editingAids: { grid: null, rulerGuides: [{ axis: 'v', position: 10 }] } })
    layers.setView(createTestRendererView({ x: 0, y: 0, scale: 8 }))
    const guides = layers.root.getChildByLabel('ruler-guides', true) as Graphics
    const strokes = guides.context.instructions
      .filter((instruction) => instruction.action === 'stroke')
      .map((instruction) => instruction.data.style as unknown as { color: number; width: number })

    // CSS px widths in world metres at 8 px/m.
    expect(strokes).toEqual([
      expect.objectContaining({ color: toPixiColor(getCanvasColor('overlay-casing'), 0), width: expect.closeTo(3 / 8, 6) }),
      expect.objectContaining({ color: toPixiColor(getCanvasColor('guide-line'), 0), width: expect.closeTo(1 / 8, 6) }),
    ])
  })
})
