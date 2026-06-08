import type {
  TimelineActionLayout,
  TimelineActionTypeRow,
  TimelinePlanningAction,
} from '../../planning-projection'
import { dateToX } from '../../../canvas/timeline-math'

export const TIMELINE_LANE_HEIGHT = 32
export const TIMELINE_RULER_HEIGHT = 28
export const TIMELINE_LABEL_SIDEBAR_WIDTH = 110
export const DEFAULT_TIMELINE_PX_PER_DAY = 5

const TIMELINE_BAR_MARGIN = 4
const TIMELINE_EDGE_THRESHOLD = 6

export interface TimelineActionCanvasGeometryState {
  readonly originDate: Date
  readonly pxPerDay: number
  readonly scrollX: number
}

export interface TimelineActionCanvasGeometry {
  readonly rows: readonly TimelineActionTypeRow[]
  readonly layout: ReadonlyMap<string, TimelineActionLayout>
  readonly state: TimelineActionCanvasGeometryState
  readonly rowOffsets: readonly number[]
  readonly canvasHeight: number
}

export interface TimelineActionHitResult {
  readonly action: TimelineActionTypeRow['actions'][number]
  readonly edge: 'left' | 'right' | 'body'
}

export interface TimelineActionGeometryBounds {
  readonly action: TimelinePlanningAction
  readonly rowIndex: number
  readonly rowY: number
  readonly rowHeight: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface TimelineActionCanvasPoint {
  readonly x: number
  readonly y: number
}

export function createTimelineActionCanvasGeometry({
  rows,
  layout,
  state,
}: {
  readonly rows: readonly TimelineActionTypeRow[]
  readonly layout: ReadonlyMap<string, TimelineActionLayout>
  readonly state: TimelineActionCanvasGeometryState
}): TimelineActionCanvasGeometry {
  const rowOffsets = computeTimelineRowOffsets(rows, layout)
  return {
    rows,
    layout,
    state,
    rowOffsets,
    canvasHeight: rowOffsets[rowOffsets.length - 1] ?? TIMELINE_RULER_HEIGHT,
  }
}

export function computeTimelineRowOffsets(
  rows: readonly TimelineActionTypeRow[],
  layout: ReadonlyMap<string, TimelineActionLayout>,
): number[] {
  const offsets = new Array(rows.length + 1) as number[]
  offsets[0] = TIMELINE_RULER_HEIGHT
  for (let i = 0; i < rows.length; i++) {
    offsets[i + 1] = offsets[i]! + rowHeight(rows[i]!, layout)
  }
  return offsets
}

export function hitTestTimelineActionGeometry(
  geometry: TimelineActionCanvasGeometry,
  point: TimelineActionCanvasPoint,
): TimelineActionHitResult | null {
  if (point.x < TIMELINE_LABEL_SIDEBAR_WIDTH || point.y < TIMELINE_RULER_HEIGHT) {
    return null
  }

  for (const row of geometry.rows) {
    for (const action of row.actions) {
      const bounds = getTimelineActionGeometryBounds(geometry, action)
      if (!bounds) continue
      if (
        point.x < bounds.x
        || point.x > bounds.x + bounds.width
        || point.y < bounds.y
        || point.y > bounds.y + bounds.height
      ) {
        continue
      }
      if (bounds.width <= TIMELINE_EDGE_THRESHOLD * 2) {
        return { action, edge: 'body' }
      }
      if (point.x - bounds.x < TIMELINE_EDGE_THRESHOLD) {
        return { action, edge: 'left' }
      }
      if (bounds.x + bounds.width - point.x < TIMELINE_EDGE_THRESHOLD) {
        return { action, edge: 'right' }
      }
      return { action, edge: 'body' }
    }
  }
  return null
}

export function getTimelineActionGeometryBounds(
  geometry: TimelineActionCanvasGeometry,
  action: TimelinePlanningAction,
): TimelineActionGeometryBounds | null {
  if (!action.startDate) return null

  const entry = geometry.layout.get(action.id)
  if (!entry) return null

  const rowY = geometry.rowOffsets[entry.rowIndex]
  const nextRowY = geometry.rowOffsets[entry.rowIndex + 1]
  if (rowY == null || nextRowY == null) return null

  const { originDate, pxPerDay, scrollX } = geometry.state
  const rowH = nextRowY - rowY
  const subLaneH = rowH / entry.totalSubLanes

  const startDate = new Date(action.startDate)
  const endDate = action.endDate
    ? new Date(action.endDate)
    : new Date(startDate.getTime() + 86400000)

  const x1 = TIMELINE_LABEL_SIDEBAR_WIDTH
    + dateToX(startDate, originDate, pxPerDay)
    - scrollX
  const x2 = TIMELINE_LABEL_SIDEBAR_WIDTH
    + dateToX(endDate, originDate, pxPerDay)
    - scrollX

  return {
    action,
    rowIndex: entry.rowIndex,
    rowY,
    rowHeight: rowH,
    x: x1,
    y: rowY + entry.subLane * subLaneH + TIMELINE_BAR_MARGIN,
    width: Math.max(x2 - x1, 6),
    height: subLaneH - TIMELINE_BAR_MARGIN * 2,
  }
}

export function findTimelineActionTypeAtY(
  geometry: TimelineActionCanvasGeometry,
  y: number,
): string | null {
  for (let i = 0; i < geometry.rowOffsets.length - 1; i++) {
    if (y >= geometry.rowOffsets[i]! && y < geometry.rowOffsets[i + 1]!) {
      return geometry.rows[i]?.actionType ?? null
    }
  }
  return null
}

function rowHeight(
  row: TimelineActionTypeRow,
  layout: ReadonlyMap<string, TimelineActionLayout>,
): number {
  if (row.actions.length === 0) return TIMELINE_LANE_HEIGHT
  const firstEntry = layout.get(row.actions[0]!.id)
  const totalSubLanes = firstEntry?.totalSubLanes ?? 1
  return Math.max(TIMELINE_LANE_HEIGHT, totalSubLanes * TIMELINE_LANE_HEIGHT)
}
