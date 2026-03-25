import type { TimelineAction } from '../types/design'
import { dateToX, niceInterval, formatDateLabel } from './timeline-math'

// ---------------------------------------------------------------------------
// Timeline renderer — Canvas 2D drawing (not Konva)
// Same pattern as rulers and minimap for 60fps performance.
// ---------------------------------------------------------------------------

const LANE_HEIGHT = 28
const RULER_HEIGHT = 24
const BAR_RADIUS = 4
const BAR_MARGIN = 3
const TODAY_COLOR = 'rgba(239, 68, 68, 0.7)'
const RULER_BG = 'rgba(0, 0, 0, 0.03)'
const RULER_TEXT = '#64748b'
const RULER_LINE = 'rgba(0, 0, 0, 0.1)'
const SELECTED_OUTLINE = '#2D5F3F'

const ACTION_COLORS: Record<string, string> = {
  planting: '#4CAF50',
  pruning: '#FF9800',
  harvest: '#FDD835',
  watering: '#42A5F5',
  fertilising: '#795548',
  other: '#9E9E9E',
}

const LANE_ORDER = ['planting', 'pruning', 'harvest', 'watering', 'fertilising', 'other']

export interface TimelineRenderState {
  originDate: Date
  pxPerDay: number
  scrollX: number
  selectedId: string | null
}

/**
 * Render the full timeline onto a Canvas 2D context.
 */
export function renderTimeline(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  actions: TimelineAction[],
  state: TimelineRenderState,
): void {
  const dpr = window.devicePixelRatio || 1
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)

  const { originDate, pxPerDay, scrollX, selectedId } = state

  // -- Time ruler at top ---------------------------------------------------
  ctx.fillStyle = RULER_BG
  ctx.fillRect(0, 0, width, RULER_HEIGHT)

  const interval = niceInterval(pxPerDay)
  const intervalMs = interval * 24 * 60 * 60 * 1000

  // First visible date (snapped to interval boundary)
  const viewStartMs = originDate.getTime() + (scrollX / pxPerDay) * 24 * 60 * 60 * 1000
  const firstTickMs = Math.floor(viewStartMs / intervalMs) * intervalMs

  ctx.fillStyle = RULER_TEXT
  ctx.font = '10px system-ui, sans-serif'
  ctx.strokeStyle = RULER_LINE
  ctx.lineWidth = 0.5

  for (let ms = firstTickMs; ms < viewStartMs + (width / pxPerDay) * 24 * 60 * 60 * 1000; ms += intervalMs) {
    const date = new Date(ms)
    const x = dateToX(date, originDate, pxPerDay) - scrollX

    ctx.beginPath()
    ctx.moveTo(x, RULER_HEIGHT - 6)
    ctx.lineTo(x, RULER_HEIGHT)
    ctx.stroke()

    const label = formatDateLabel(date, interval)
    ctx.fillText(label, x + 3, RULER_HEIGHT - 8)
  }

  // Ruler bottom border
  ctx.strokeStyle = RULER_LINE
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, RULER_HEIGHT)
  ctx.lineTo(width, RULER_HEIGHT)
  ctx.stroke()

  // -- Swim lane backgrounds -----------------------------------------------
  for (let i = 0; i < LANE_ORDER.length; i++) {
    const y = RULER_HEIGHT + i * LANE_HEIGHT
    if (i % 2 === 1) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.02)'
      ctx.fillRect(0, y, width, LANE_HEIGHT)
    }
  }

  // -- Action bars ----------------------------------------------------------
  for (const action of actions) {
    if (!action.start_date) continue

    const startDate = new Date(action.start_date)
    const endDate = action.end_date ? new Date(action.end_date) : new Date(startDate.getTime() + 24 * 60 * 60 * 1000) // default 1 day

    const x1 = dateToX(startDate, originDate, pxPerDay) - scrollX
    const x2 = dateToX(endDate, originDate, pxPerDay) - scrollX

    // Which lane?
    const laneIdx = LANE_ORDER.indexOf(action.action_type)
    const lane = laneIdx >= 0 ? laneIdx : LANE_ORDER.length - 1
    const y = RULER_HEIGHT + lane * LANE_HEIGHT + BAR_MARGIN

    const barW = Math.max(x2 - x1, 6) // min 6px wide
    const barH = LANE_HEIGHT - BAR_MARGIN * 2

    // Bar fill
    ctx.fillStyle = action.completed
      ? 'rgba(158, 158, 158, 0.4)'
      : (ACTION_COLORS[action.action_type] ?? ACTION_COLORS.other!)
    _roundRect(ctx, x1, y, barW, barH, BAR_RADIUS)
    ctx.fill()

    // Selected outline
    if (action.id === selectedId) {
      ctx.strokeStyle = SELECTED_OUTLINE
      ctx.lineWidth = 2
      _roundRect(ctx, x1, y, barW, barH, BAR_RADIUS)
      ctx.stroke()
    }

    // Label inside bar
    if (barW > 30) {
      ctx.fillStyle = action.completed ? '#666' : '#fff'
      ctx.font = '10px system-ui, sans-serif'
      ctx.save()
      ctx.beginPath()
      ctx.rect(x1, y, barW, barH)
      ctx.clip()
      ctx.fillText(action.description, x1 + 4, y + barH / 2 + 3)
      ctx.restore()
    }

    // Completed strikethrough
    if (action.completed && barW > 10) {
      ctx.strokeStyle = '#666'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x1 + 2, y + barH / 2)
      ctx.lineTo(x1 + barW - 2, y + barH / 2)
      ctx.stroke()
    }
  }

  // -- Today marker ---------------------------------------------------------
  const todayX = dateToX(new Date(), originDate, pxPerDay) - scrollX
  if (todayX >= 0 && todayX <= width) {
    ctx.strokeStyle = TODAY_COLOR
    ctx.lineWidth = 1.5
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(todayX, 0)
    ctx.lineTo(todayX, height)
    ctx.stroke()
    ctx.setLineDash([])
  }
}

/**
 * Hit-test: which action bar (if any) is at the given pixel position?
 */
export function hitTestAction(
  x: number,
  y: number,
  actions: TimelineAction[],
  state: TimelineRenderState,
): TimelineAction | null {
  const { originDate, pxPerDay, scrollX } = state

  for (const action of actions) {
    if (!action.start_date) continue
    const startDate = new Date(action.start_date)
    const endDate = action.end_date ? new Date(action.end_date) : new Date(startDate.getTime() + 86400000)
    const x1 = dateToX(startDate, originDate, pxPerDay) - scrollX
    const x2 = dateToX(endDate, originDate, pxPerDay) - scrollX
    const laneIdx = LANE_ORDER.indexOf(action.action_type)
    const lane = laneIdx >= 0 ? laneIdx : LANE_ORDER.length - 1
    const barY = RULER_HEIGHT + lane * LANE_HEIGHT + BAR_MARGIN
    const barH = LANE_HEIGHT - BAR_MARGIN * 2

    if (x >= x1 && x <= Math.max(x2, x1 + 6) && y >= barY && y <= barY + barH) {
      return action
    }
  }
  return null
}

function _roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}
