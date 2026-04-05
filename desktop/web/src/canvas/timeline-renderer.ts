import type { TimelineAction } from '../types/design'
import { dateToX, niceInterval, formatDateLabel } from './timeline-math'
import { cssVar, roundRect } from './canvas2d-utils'

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

/** Action type colors — earthy field notebook palette */
const ACTION_COLORS: Record<string, string> = {
  planting: '#5A7D3A',   // moss green
  pruning: '#A06B1F',    // ochre
  harvest: '#B8860B',    // dark goldenrod
  watering: '#5B8FB9',   // pond teal
  fertilising: '#7D6F5E', // graphite
  other: '#7D6F5E',       // graphite
}

export interface TimelineRenderState {
  originDate: Date
  pxPerDay: number
  scrollX: number
  selectedId: string | null
  hoveredId: string | null
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
      const aStart = a.start_date ? new Date(a.start_date).getTime() : 0
      const bStart = b.start_date ? new Date(b.start_date).getTime() : 0
      return aStart - bStart
    })

    // Greedy lane packing — assign to the first sub-lane where the action doesn't overlap
    const laneEnds: number[] = [] // end time of last action in each sub-lane

    for (const action of sorted) {
      const startMs = action.start_date ? new Date(action.start_date).getTime() : Date.now()
      const endMs = action.end_date ? new Date(action.end_date).getTime() : startMs + 86400000

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

/**
 * Compute the pixel Y offset for a given species row.
 */
export function rowYOffset(rowIndex: number, rows: SpeciesRow[], layout: Map<string, ActionLayout>): number {
  let y = RULER_HEIGHT
  for (let i = 0; i < rowIndex; i++) {
    y += rowHeight(rows[i]!, layout)
  }
  return y
}

/** Height of a species row in pixels. */
export function rowHeight(row: SpeciesRow, layout: Map<string, ActionLayout>): number {
  if (row.actions.length === 0) return LANE_HEIGHT
  const firstEntry = layout.get(row.actions[0]!.id)
  const totalSubLanes = firstEntry?.totalSubLanes ?? 1
  return Math.max(LANE_HEIGHT, totalSubLanes * LANE_HEIGHT)
}

/** Total content height including ruler. */
export function totalContentHeight(rows: SpeciesRow[], layout: Map<string, ActionLayout>): number {
  let h = RULER_HEIGHT
  for (const row of rows) {
    h += rowHeight(row, layout)
  }
  return h
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
  scrollY: number,
): void {
  const dpr = window.devicePixelRatio || 1
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)

  const { originDate, pxPerDay, scrollX, selectedId, hoveredId } = state

  // Read theme tokens
  const bgColor = cssVar('--color-bg') || '#F0EBE1'
  const surfaceColor = cssVar('--color-surface') || '#FAF7F2'
  const borderColor = cssVar('--color-border') || 'rgba(60, 45, 30, 0.12)'
  const textColor = cssVar('--color-text') || '#2C2418'
  const textMutedColor = cssVar('--color-text-muted') || '#7D6F5E'
  const primaryColor = cssVar('--color-primary') || '#A06B1F'
  const dangerColor = cssVar('--color-danger') || '#B5432A'

  const chartLeft = LABEL_SIDEBAR_WIDTH

  // -- Label sidebar background -----------------------------------------------
  ctx.fillStyle = surfaceColor
  ctx.fillRect(0, 0, chartLeft, height)

  // Sidebar border
  ctx.strokeStyle = borderColor
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(chartLeft, 0)
  ctx.lineTo(chartLeft, height)
  ctx.stroke()

  // -- Time ruler at top (above chart area only) ------------------------------
  ctx.fillStyle = bgColor
  ctx.fillRect(chartLeft, 0, width - chartLeft, RULER_HEIGHT)

  const interval = niceInterval(pxPerDay)
  const intervalMs = interval * 24 * 60 * 60 * 1000
  const viewStartMs = originDate.getTime() + (scrollX / pxPerDay) * 86400000
  const viewEndMs = viewStartMs + ((width - chartLeft) / pxPerDay) * 86400000
  const firstTickMs = Math.floor(viewStartMs / intervalMs) * intervalMs

  ctx.fillStyle = textMutedColor
  ctx.font = `600 10px ${cssVar('--font-sans') || 'system-ui, sans-serif'}`
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
    const label = formatDateLabel(date, interval)
    ctx.fillText(label, x + 3, RULER_HEIGHT - 10)
  }

  // Ruler bottom border
  ctx.strokeStyle = borderColor
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, RULER_HEIGHT)
  ctx.lineTo(width, RULER_HEIGHT)
  ctx.stroke()

  // Ruler top-left corner label
  ctx.fillStyle = bgColor
  ctx.fillRect(0, 0, chartLeft, RULER_HEIGHT)
  ctx.strokeStyle = borderColor
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(chartLeft, 0)
  ctx.lineTo(chartLeft, RULER_HEIGHT)
  ctx.stroke()

  // -- Species rows -----------------------------------------------------------
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, RULER_HEIGHT, width, height - RULER_HEIGHT)
  ctx.clip()

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx]!
    const rY = rowYOffset(rowIdx, rows, layout) - scrollY
    const rH = rowHeight(row, layout)

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
    ctx.font = `600 11px ${cssVar('--font-sans') || 'system-ui, sans-serif'}`
    const label = row.speciesName || 'General'
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
      const baseColor = ACTION_COLORS[action.action_type] ?? ACTION_COLORS.other!
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
        ctx.fillStyle = surfaceColor
        ctx.font = `600 10px ${cssVar('--font-sans') || 'system-ui, sans-serif'}`
        ctx.save()
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

export type HitEdge = 'body' | null

export interface HitResult {
  action: TimelineAction
  edge: HitEdge
}

export function hitTestAction(
  x: number,
  y: number,
  rows: SpeciesRow[],
  layout: Map<string, ActionLayout>,
  state: TimelineRenderState,
  scrollY: number,
): HitResult | null {
  const { originDate, pxPerDay, scrollX } = state
  const chartLeft = LABEL_SIDEBAR_WIDTH

  // Ignore clicks in the label sidebar or ruler
  if (x < chartLeft || y < RULER_HEIGHT) return null

  for (const row of rows) {
    for (const action of row.actions) {
      if (!action.start_date) continue

      const entry = layout.get(action.id)
      if (!entry) continue

      const rowIdx = entry.rowIndex
      const rY = rowYOffset(rowIdx, rows, layout) - scrollY
      const rH = rowHeight(rows[rowIdx]!, layout)
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

