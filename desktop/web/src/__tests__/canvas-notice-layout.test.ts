import { describe, expect, it } from 'vitest'
import {
  CANVAS_NOTICE_MARGIN_PX,
  CANVAS_RULER_SIZE_PX,
  resolveCanvasNoticePlacement,
} from '../canvas/canvas-notice-layout'
import {
  SCALE_BAR_CANVAS_WIDTH,
  SCALE_BAR_RESERVED_BOTTOM_PX,
} from '../canvas/scale-bar'

describe('Canvas Notice Layout', () => {
  it('reserves ruler chrome for the top-left Tool HUD slot', () => {
    const placement = resolveCanvasNoticePlacement('tool-hud', {
      canvasWidth: 640,
      canvasHeight: 480,
      rulersVisible: true,
      scaleBarVisible: true,
    })

    expect(placement).toMatchObject({
      slot: 'tool-hud',
      placement: 'top-left',
      leftPx: CANVAS_RULER_SIZE_PX + CANVAS_NOTICE_MARGIN_PX,
      topPx: CANVAS_RULER_SIZE_PX + CANVAS_NOTICE_MARGIN_PX,
      compact: false,
    })
    expect(placement.maxWidthPx).toBeGreaterThan(320)
  })

  it('places Location Notices above the scale bar in the bottom-left safe slot', () => {
    const placement = resolveCanvasNoticePlacement('location-notice', {
      canvasWidth: 640,
      canvasHeight: 480,
      rulersVisible: true,
      scaleBarVisible: true,
    })

    expect(placement).toMatchObject({
      slot: 'location-notice',
      placement: 'bottom-left-above-scale-bar',
      leftPx: CANVAS_RULER_SIZE_PX + CANVAS_NOTICE_MARGIN_PX,
      bottomPx: SCALE_BAR_RESERVED_BOTTOM_PX + CANVAS_NOTICE_MARGIN_PX,
      compact: false,
    })
    expect(placement.maxWidthPx).toBeGreaterThan(SCALE_BAR_CANVAS_WIDTH)
  })

  it('shifts Location Notices to the right of the scale bar when vertical space is tight', () => {
    const placement = resolveCanvasNoticePlacement('location-notice', {
      canvasWidth: 640,
      canvasHeight: 72,
      noticeHeight: 28,
      rulersVisible: true,
      scaleBarVisible: true,
    })

    expect(placement).toMatchObject({
      slot: 'location-notice',
      placement: 'bottom-left-right-of-scale-bar',
      leftPx: SCALE_BAR_CANVAS_WIDTH + CANVAS_NOTICE_MARGIN_PX,
      bottomPx: CANVAS_NOTICE_MARGIN_PX,
      compact: false,
    })
  })

  it('compacts Location Notices when the right-of-scale-bar slot is too narrow', () => {
    const placement = resolveCanvasNoticePlacement('location-notice', {
      canvasWidth: 300,
      canvasHeight: 72,
      noticeHeight: 28,
      rulersVisible: true,
      scaleBarVisible: true,
    })

    expect(placement).toMatchObject({
      slot: 'location-notice',
      placement: 'bottom-left-compact',
      leftPx: CANVAS_RULER_SIZE_PX + CANVAS_NOTICE_MARGIN_PX,
      bottomPx: CANVAS_NOTICE_MARGIN_PX,
      compact: true,
    })
    expect(placement.maxWidthPx).toBeLessThan(240)
  })
})
