import type { TimelineAction } from '../types/design'
import { dateToX, niceInterval, formatDateLabel } from './timeline-math'
import { cssVar, roundRect, readThemeTokens } from './canvas2d-utils'

// ---------------------------------------------------------------------------
// Timeline renderer — Canvas 2D drawing (not Konva)
// Theme-aware: reads CSS variables from a container element at render time.
// ---------------------------------------------------------------------------

export const LANE_HEIGHT = 32
export const RULER_HEIGHT = 28
const BAR_RADIUS = 4
const BAR_MARGIN = 4

/** Width of the species label sidebar in pixels. Shared with InteractiveTimeline. */
export const LABEL_SIDEBAR_WIDTH = 140

/** Action type CSS variable names + hex fallbacks */
const ACTION_COLOR_VARS: Record<string, [varName: string, fallback: string]> = {
  planting: ['--color-action-planting', '#7D6049'],
  pruning: ['--color-action-pruning', '#A06B1F'],
  harvest: ['--color-action-harvest', '#B8860B'],
  watering: ['--color-action-watering', '#5B8FB9'],
  fertilising: ['--color-action-fertilising', '#7D6F5E'],
  other: ['--color-action-other', '#8B7355'],
}
const DEFAULT_ACTION_COLOR: [string, string] = ['--color-action-other', '#8B7355']

function actionColor(type: string): string {
  const [varName, fallback] = ACTION_COLOR_VARS[type] ?? DEFAULT_ACTION_COLOR
  return cssVar(varName) || fallback
}

export interface TimelineRenderState {
  originDate: Date
  pxPerDay: number
  scrollX: number
  scrollY: number
  selectedId: string | null
  hoveredId: string | null
  locale: string
}

export interface SpeciesRow {
  speciesName: string
  actions: TimelineAction[]
}

/**
 * Group actions by species (via plants[0] canonical name or ungrouped).
 * Returns a flat list of rows: one per species, plus an "ungrouped" row.
 */
export function groupActionsBySpecies(actions: TimelineAction[]): SpeciesRow[] {
  const speciesMap = new Map<string, TimelineAction[]>()
  const ungrouped: TimelineAction[] = []

  for (const action of actions) {
    const key = action.plants?.[0] ?? null
    if (key) {
      const existing = speciesMap.get(key)
      if (existing) existing.push(action)
      else speciesMap.set(key, [action])
    } else {
      ungrouped.push(action)
    }
  }

  const rows: SpeciesRow[] = []
  for (const [name, acts] of speciesMap) {
    rows.push({ speciesName: name, actions: acts })
  }
  if (ungrouped.length > 0) {
    rows.push({ speciesName: '', actions: ungrouped })
  }
  return rows
}

/**
 * Compute lane layout: each action gets a lane index within its species row,
 * stacking vertically when bars overlap in time.
 * Returns a map of actionId -> { row index, sub-lane within row }.
 */
export interface ActionLayout {
  /** Species row index (0-based) */
  rowIndex: number
  /** Sub-lane within the species row (0-based) for stacking overlapping bars */
  subLane: number
  /** Total number of sub-lanes in this species row */
  totalSubLanes: number
}

export function computeLayout(rows: SpeciesRow[]): Map<string, ActionLayout> {
  const layout = new Map<string, ActionLayout>()

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex]!
    // Sort actions by start date
    const sorted = [...row.actions].sort((a, b) => {
      const aStart = a.start_date ? new Date(a.start_date).getTime() : Infinity
      const bStart = b.start_date ? new Date(b.start_date).getTime() : Infinity
      return aStart - bStart
    })

    // Greedy lane packing — assign to the first sub-lane where the action doesn't overlap
    const laneEnds: number[] = [] // end time of last action in each sub-lane

    for (const action of sorted) {
      const startMs = action.start_date ? new Date(action.start_date).getTime() : Infinity
      const endMs = action.end_date ? new Date(action.end_date).getTime() : (isFinite(startMs) ? startMs + 86400000 : Infinity)

      let assigned = -1
      for (let i = 0; i < laneEnds.length; i++) {
        if (startMs >= laneEnds[i]!) {
          assigned = i
          laneEnds[i] = endMs
          break
        }
      }
      if (assigned === -1) {
        assigned = laneEnds.length
        laneEnds.push(endMs)
      }

      layout.set(action.id, {
        rowIndex,
        subLane: assigned,
        totalSubLanes: 0, // will be filled below
      })
    }

    // Write total sub-lanes back
    const totalSubLanes = Math.max(laneEnds.length, 1)
    for (const action of sorted) {
      const entry = layout.get(action.id)!
      entry.totalSubLanes = totalSubLanes
    }
  }

  return layout
}

/** Height of a species row in pixels. */
function rowHeight(row: SpeciesRow, layout: Map<string, ActionLayout>): number {
  if (row.actions.length === 0) return LANE_HEIGHT
  const firstEntry = layout.get(row.actions[0]!.id)
  const totalSubLanes = firstEntry?.totalSubLanes ?? 1
  return Math.max(LANE_HEIGHT, totalSubLanes * LANE_HEIGHT)
}

/** Precompute cumulative Y offsets for all species rows. */
export function computeTimelineRowOffsets(rows: SpeciesRow[], layout: Map<string, ActionLayout>): number[] {
  const offsets = new Array(rows.length + 1) as number[]
  offsets[0] = RULER_HEIGHT
  for (let i = 0; i < rows.length; i++) {
    offsets[i + 1] = offsets[i]! + rowHeight(rows[i]!, layout)
  }
  return offsets
}


// ---------------------------------------------------------------------------
// Main render
// ---------------------------------------------------------------------------

export function renderTimeline(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  rows: SpeciesRow[],
  layout: Map<string, ActionLayout>,
  state: TimelineRenderState,
  t: (key: string) => string,
  cachedRowOffsets?: number[],
): void {
  ctx.clearRect(0, 0, width, height)

  const { originDate, pxPerDay, scrollX, scrollY, selectedId, hoveredId } = state
  if (pxPerDay <= 0) return

  const theme = readThemeTokens()
  const bgColor = theme.bg
  const surfaceColor = theme.surface
  const borderColor = theme.border
  const textColor = theme.text
  const textMutedColor = theme.textMuted
  const primaryColor = theme.primary
  const dangerColor = cssVar('--color-danger') || '#B5432A'
  const primaryContrastColor = theme.primaryContrast
  const fontSans = theme.fontSans

  const chartLeft = LABEL_SIDEBAR_WIDTH

  // -- Label sidebar background -----------------------------------------------
  ctx.fillStyle = surfaceColor
  ctx.fillRect(0, 0, chartLeft, height)

  // -- Time ruler at top (above chart area only) ------------------------------
  ctx.fillStyle = bgColor
  ctx.fillRect(chartLeft, 0, width - chartLeft, RULER_HEIGHT)

  const interval = niceInterval(pxPerDay)
  const intervalMs = interval * 24 * 60 * 60 * 1000
  const viewStartMs = originDate.getTime() + (scrollX / pxPerDay) * 86400000
  const viewEndMs = viewStartMs + ((width - chartLeft) / pxPerDay) * 86400000
  const firstTickMs = Math.floor(viewStartMs / intervalMs) * intervalMs

  ctx.fillStyle = textMutedColor
  ctx.font = `600 11px ${fontSans}`
  ctx.strokeStyle = borderColor
  ctx.lineWidth = 0.5

  for (let ms = firstTickMs; ms < viewEndMs + intervalMs; ms += intervalMs) {
    const date = new Date(ms)
    const x = chartLeft + dateToX(date, originDate, pxPerDay) - scrollX

    if (x < chartLeft - 40 || x > width + 40) continue

    // Tick mark
    ctx.beginPath()
    ctx.moveTo(x, RULER_HEIGHT - 6)
    ctx.lineTo(x, RULER_HEIGHT)
    ctx.stroke()

    // Label
    const label = formatDateLabel(date, interval, state.locale)
    ctx.fillText(label, x + 3, RULER_HEIGHT - 10)
  }

  // Ruler bottom border
  ctx.strokeStyle = borderColor
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, RULER_HEIGHT)
  ctx.lineTo(width, RULER_HEIGHT)
  ctx.stroke()

  // Ruler top-left corner fill
  ctx.fillStyle = bgColor
  ctx.fillRect(0, 0, chartLeft, RULER_HEIGHT)

  // Sidebar border (full height, drawn after all fills to avoid overdraw)
  ctx.strokeStyle = borderColor
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(chartLeft, 0)
  ctx.lineTo(chartLeft, height)
  ctx.stroke()

  // -- Species rows -----------------------------------------------------------
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, RULER_HEIGHT, width, height - RULER_HEIGHT)
  ctx.clip()

  const rowOffsets = cachedRowOffsets ?? computeTimelineRowOffsets(rows, layout)
  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx]!
    const rY = rowOffsets[rowIdx]! - scrollY
    const rH = rowOffsets[rowIdx + 1]! - rowOffsets[rowIdx]!

    // Skip if out of view
    if (rY + rH < RULER_HEIGHT || rY > height) continue

    // Alternating row backgrounds
    if (rowIdx % 2 === 1) {
      ctx.fillStyle = borderColor
      ctx.globalAlpha = 0.3
      ctx.fillRect(chartLeft, rY, width - chartLeft, rH)
      ctx.globalAlpha = 1
    }

    // Row separator line
    ctx.strokeStyle = borderColor
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.moveTo(0, rY + rH)
    ctx.lineTo(width, rY + rH)
    ctx.stroke()

    // Species label in sidebar
    ctx.fillStyle = textColor
    ctx.font = `600 11px ${fontSans}`
    const label = row.speciesName || t('canvas.timeline.general')
    ctx.save()
    ctx.beginPath()
    ctx.rect(4, rY, chartLeft - 8, rH)
    ctx.clip()
    // Vertically center the text
    const labelY = rY + rH / 2 + 4
    ctx.fillText(label, 8, labelY)
    ctx.restore()

    // -- Action bars for this row -------------------------------------------
    for (const action of row.actions) {
      if (!action.start_date) continue

      const entry = layout.get(action.id)
      if (!entry) continue

      const startDate = new Date(action.start_date)
      const endDate = action.end_date
        ? new Date(action.end_date)
        : new Date(startDate.getTime() + 86400000)

      const x1 = chartLeft + dateToX(startDate, originDate, pxPerDay) - scrollX
      const x2 = chartLeft + dateToX(endDate, originDate, pxPerDay) - scrollX

      const subLaneH = rH / entry.totalSubLanes
      const barY = rY + entry.subLane * subLaneH + BAR_MARGIN
      const barW = Math.max(x2 - x1, 6)
      const barH = subLaneH - BAR_MARGIN * 2

      // Skip if out of horizontal view
      if (x1 + barW < chartLeft || x1 > width) continue

      // Bar fill
      const baseColor = actionColor(action.action_type)
      ctx.globalAlpha = action.id === hoveredId ? 0.9 : 0.8
      ctx.fillStyle = baseColor
      roundRect(ctx, x1, barY, barW, barH, BAR_RADIUS)
      ctx.fill()
      ctx.globalAlpha = 1

      // Selected outline
      if (action.id === selectedId) {
        ctx.strokeStyle = primaryColor
        ctx.lineWidth = 2
        roundRect(ctx, x1, barY, barW, barH, BAR_RADIUS)
        ctx.stroke()
      }

      // Hover outline (lighter)
      if (action.id === hoveredId && action.id !== selectedId) {
        ctx.strokeStyle = primaryColor
        ctx.lineWidth = 1
        ctx.globalAlpha = 0.5
        roundRect(ctx, x1, barY, barW, barH, BAR_RADIUS)
        ctx.stroke()
        ctx.globalAlpha = 1
      }

      // Label inside bar
      if (barW > 40) {
        ctx.save()
        ctx.fillStyle = primaryContrastColor
        ctx.font = `600 11px ${fontSans}`
        ctx.beginPath()
        ctx.rect(x1 + 2, barY, barW - 4, barH)
        ctx.clip()
        ctx.fillText(action.description, x1 + 6, barY + barH / 2 + 3.5)
        ctx.restore()
      }

    }
  }

  ctx.restore() // un-clip

  // -- Today marker -----------------------------------------------------------
  const todayX = chartLeft + dateToX(new Date(), originDate, pxPerDay) - scrollX
  if (todayX >= chartLeft && todayX <= width) {
    ctx.strokeStyle = dangerColor
    ctx.lineWidth = 1.5
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(todayX, 0)
    ctx.lineTo(todayX, height)
    ctx.stroke()
    ctx.setLineDash([])

    // Small triangle at top
    ctx.fillStyle = dangerColor
    ctx.beginPath()
    ctx.moveTo(todayX - 4, 0)
    ctx.lineTo(todayX + 4, 0)
    ctx.lineTo(todayX, 6)
    ctx.closePath()
    ctx.fill()
  }
}

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

export interface HitResult {
  action: TimelineAction
  edge: 'body'
}

export function hitTestAction(
  x: number,
  y: number,
  rows: SpeciesRow[],
  layout: Map<string, ActionLayout>,
  state: TimelineRenderState,
  cachedRowOffsets?: number[],
): HitResult | null {
  const { originDate, pxPerDay, scrollX, scrollY } = state
  const chartLeft = LABEL_SIDEBAR_WIDTH

  // Ignore clicks in the label sidebar or ruler
  if (x < chartLeft || y < RULER_HEIGHT) return null

  const rowOffsets = cachedRowOffsets ?? computeTimelineRowOffsets(rows, layout)
  for (const row of rows) {
    for (const action of row.actions) {
      if (!action.start_date) continue

      const entry = layout.get(action.id)
      if (!entry) continue

      const rowIdx = entry.rowIndex
      const rY = rowOffsets[rowIdx]! - scrollY
      const rH = rowOffsets[rowIdx + 1]! - rowOffsets[rowIdx]!
      const subLaneH = rH / entry.totalSubLanes

      const startDate = new Date(action.start_date)
      const endDate = action.end_date
        ? new Date(action.end_date)
        : new Date(startDate.getTime() + 86400000)

      const x1 = chartLeft + dateToX(startDate, originDate, pxPerDay) - scrollX
      const x2 = chartLeft + dateToX(endDate, originDate, pxPerDay) - scrollX
      const barY = rY + entry.subLane * subLaneH + BAR_MARGIN
      const barW = Math.max(x2 - x1, 6)
      const barH = subLaneH - BAR_MARGIN * 2

      if (x >= x1 && x <= x1 + barW && y >= barY && y <= barY + barH) {
        return { action, edge: 'body' }
      }
    }
  }
  return null
}

