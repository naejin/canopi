import { SCALE_BAR_CANVAS_WIDTH, SCALE_BAR_RESERVED_BOTTOM_PX } from './scale-bar'

export const CANVAS_RULER_SIZE_PX = 24
export const CANVAS_NOTICE_MARGIN_PX = 12
export const CANVAS_NOTICE_MIN_WIDTH_PX = 160
export const CANVAS_NOTICE_COMPACT_MAX_WIDTH_PX = 220
export const CANVAS_NOTICE_DEFAULT_HEIGHT_PX = 28
export const CANVAS_NOTICE_DEFAULT_CANVAS_WIDTH_PX = 640
export const CANVAS_NOTICE_DEFAULT_CANVAS_HEIGHT_PX = 480

export type CanvasNoticeSlot = 'tool-hud' | 'location-notice'

export interface CanvasNoticeViewport {
  canvasWidth: number
  canvasHeight: number
  noticeHeight?: number
  rulersVisible: boolean
  scaleBarVisible: boolean
}

export interface CanvasNoticePlacement {
  slot: CanvasNoticeSlot
  placement: 'top-left'
    | 'bottom-left-above-scale-bar'
    | 'bottom-left-right-of-scale-bar'
    | 'bottom-left-compact'
  leftPx: number
  topPx?: number
  bottomPx?: number
  maxWidthPx: number
  compact: boolean
}

export function resolveCanvasNoticePlacement(
  slot: CanvasNoticeSlot,
  viewport: CanvasNoticeViewport,
): CanvasNoticePlacement {
  const canvasWidth = viewport.canvasWidth > 0
    ? viewport.canvasWidth
    : CANVAS_NOTICE_DEFAULT_CANVAS_WIDTH_PX
  const canvasHeight = viewport.canvasHeight > 0
    ? viewport.canvasHeight
    : CANVAS_NOTICE_DEFAULT_CANVAS_HEIGHT_PX
  const rulerInset = viewport.rulersVisible ? CANVAS_RULER_SIZE_PX : 0
  const leftPx = rulerInset + CANVAS_NOTICE_MARGIN_PX
  if (slot === 'location-notice') {
    const scaleBarReservedBottomPx = viewport.scaleBarVisible ? SCALE_BAR_RESERVED_BOTTOM_PX : 0
    const bottomPx = scaleBarReservedBottomPx
      + CANVAS_NOTICE_MARGIN_PX
    const maxWidthPx = Math.max(
      CANVAS_NOTICE_MIN_WIDTH_PX,
      canvasWidth - leftPx - CANVAS_NOTICE_MARGIN_PX,
    )
    const noticeHeight = viewport.noticeHeight ?? CANVAS_NOTICE_DEFAULT_HEIGHT_PX
    const topSafePx = rulerInset + CANVAS_NOTICE_MARGIN_PX
    const topIfAboveScaleBar = canvasHeight - bottomPx - noticeHeight
    if (topIfAboveScaleBar < topSafePx && viewport.scaleBarVisible) {
      const rightOfScaleLeftPx = SCALE_BAR_CANVAS_WIDTH + CANVAS_NOTICE_MARGIN_PX
      const rightOfScaleAvailableWidthPx = canvasWidth
        - rightOfScaleLeftPx
        - CANVAS_NOTICE_MARGIN_PX
      if (rightOfScaleAvailableWidthPx < CANVAS_NOTICE_MIN_WIDTH_PX) {
        const compactAvailableWidthPx = canvasWidth - leftPx - CANVAS_NOTICE_MARGIN_PX

        return {
          slot,
          placement: 'bottom-left-compact',
          leftPx,
          bottomPx: CANVAS_NOTICE_MARGIN_PX,
          maxWidthPx: Math.max(
            80,
            Math.min(CANVAS_NOTICE_COMPACT_MAX_WIDTH_PX, compactAvailableWidthPx),
          ),
          compact: true,
        }
      }

      return {
        slot,
        placement: 'bottom-left-right-of-scale-bar',
        leftPx: rightOfScaleLeftPx,
        bottomPx: CANVAS_NOTICE_MARGIN_PX,
        maxWidthPx: rightOfScaleAvailableWidthPx,
        compact: rightOfScaleAvailableWidthPx < 240,
      }
    }

    return {
      slot,
      placement: 'bottom-left-above-scale-bar',
      leftPx,
      bottomPx,
      maxWidthPx,
      compact: maxWidthPx < 240,
    }
  }

  const topPx = rulerInset + CANVAS_NOTICE_MARGIN_PX
  const availableToolWidthPx = canvasWidth - leftPx - CANVAS_NOTICE_MARGIN_PX
  const maxWidthPx = Math.max(
    96,
    availableToolWidthPx,
  )

  return {
    slot,
    placement: 'top-left',
    leftPx,
    topPx,
    maxWidthPx,
    compact: maxWidthPx < 240,
  }
}
