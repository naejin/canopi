import { describe, expect, it } from 'vitest'

import { getCanvasInteractionStrokeVisual } from './scene-visuals'

describe('scene visuals', () => {
  it('keeps selected, hover, and locked hover strokes visually distinct', () => {
    const hover = getCanvasInteractionStrokeVisual('hover')
    const selected = getCanvasInteractionStrokeVisual('selected')
    const lockedObject = getCanvasInteractionStrokeVisual('locked-design-object')
    const lockedLayer = getCanvasInteractionStrokeVisual('locked-layer')

    expect(selected.widthPx).toBeGreaterThan(hover.widthPx)
    expect(selected.alpha).toBeGreaterThan(hover.alpha)
    expect(lockedObject.color).not.toBe(lockedLayer.color)
    expect(lockedObject.color).not.toBe(selected.color)
    expect(lockedLayer.color).not.toBe(selected.color)
  })
})
