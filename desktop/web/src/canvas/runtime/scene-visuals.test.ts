import { describe, expect, it } from 'vitest'

import { CANVAS_CHROME_FONT_FAMILY, CANVAS_CHROME_MONO_FONT_FAMILY } from '../chrome-fonts'
import { getCanvasColor } from '../theme-refresh'
import { getCanvasInteractionStrokeVisual, getDraftLabelVisual, getDraftVisual } from './scene-visuals'

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

  it('resolves each draft token to the canvas colour today\'s DOM previews use', () => {
    // overlay-ui.ts and polygon-draft-overlay.ts: light drafts on the dark overlay casing, the ochre band on the interaction casing.
    expect(getDraftVisual('draft')).toEqual({ color: getCanvasColor('guide-line'), casing: getCanvasColor('overlay-casing') })
    expect(getDraftVisual('selection'))
      .toEqual({ color: getCanvasColor('selection-stroke'), casing: getCanvasColor('interaction-casing') })
    expect(getDraftVisual('draft-fill')).toEqual({ color: getCanvasColor('zone-fill') })
    expect(getDraftVisual('selection-fill')).toEqual({ color: getCanvasColor('selection-fill') })
    // No phase-0 draft is muted or a warning; both draw as a draft until a phase gives them a colour.
    expect(getDraftVisual('draft-muted')).toEqual(getDraftVisual('draft'))
    expect(getDraftVisual('warning')).toEqual(getDraftVisual('draft'))
    expect(getDraftVisual('warning-fill')).toEqual(getDraftVisual('draft-fill'))
  })

  it('gives each draft label tone today\'s chip style', () => {
    const chip = {
      fontSizePx: 12.5,
      border: getCanvasColor('chip-border'),
      borderWidthPx: 1,
      radiusPx: 5,
      shadow: { offsetXPx: 0, offsetYPx: 2, blurPx: 8, color: 'rgba(30, 22, 10, 0.12)' },
    }
    const measure = getDraftLabelVisual('measure')
    expect(measure).toMatchObject({
      ...chip, placement: 'centre', fontFamily: CANVAS_CHROME_MONO_FONT_FAMILY, fontWeight: '600',
      color: getCanvasColor('chip-text'), background: getCanvasColor('chip-surface-muted'), paddingPx: { x: 5, y: 2 },
    })
    expect(getDraftLabelVisual('measure-quiet')).toEqual({ ...measure, fontWeight: '400' })
    const hint = getDraftLabelVisual('hint')
    expect(hint).toMatchObject({
      ...chip, placement: 'above', gapPx: 4, fontFamily: CANVAS_CHROME_FONT_FAMILY, fontWeight: '600',
      color: getCanvasColor('chip-text'), background: getCanvasColor('chip-surface'), paddingPx: { x: 6, y: 2 },
    })
    expect(getDraftLabelVisual('hint-primary')).toEqual({ ...hint, color: getCanvasColor('chip-primary'), paddingPx: { x: 8, y: 4 } })
    expect(getDraftLabelVisual('warning')).toEqual(hint)
  })
})
