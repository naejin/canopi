import { describe, expect, it } from 'vitest'
import {
  SCALE_BAR_CANVAS_WIDTH,
  SCALE_BAR_MARGIN_X,
  SCALE_BAR_MARGIN_Y,
  SCALE_BAR_RESERVED_BOTTOM_PX,
  getScaleBarDisplay,
} from '../canvas/scale-bar'

describe('scale-bar metrics', () => {
  it('selects a stable nice distance and screen width from stage scale', () => {
    expect(getScaleBarDisplay(7.25)).toEqual({
      barScreenPx: 145,
      label: '20m',
    })
  })

  it('exports a shared bottom reservation for the legend and html overlay', () => {
    expect(SCALE_BAR_MARGIN_X).toBe(40)
    expect(SCALE_BAR_MARGIN_Y).toBe(16)
    expect(SCALE_BAR_RESERVED_BOTTOM_PX).toBe(40)
    expect(SCALE_BAR_CANVAS_WIDTH).toBeGreaterThan(SCALE_BAR_MARGIN_X + 180)
  })
})
