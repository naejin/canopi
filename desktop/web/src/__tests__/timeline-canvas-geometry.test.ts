import { describe, expect, it } from 'vitest'
import {
  computeTimelineActionLayout,
  groupTimelineActionsByType,
} from '../app/planning-projection'
import {
  TIMELINE_LABEL_SIDEBAR_WIDTH,
  TIMELINE_LANE_HEIGHT,
  TIMELINE_RULER_HEIGHT,
  createTimelineActionCanvasGeometry,
  hitTestTimelineActionGeometry,
  type TimelineActionCanvasGeometryState,
} from '../app/timeline/canvas/geometry'
import { MANUAL_TARGET } from '../target'
import type { TimelineAction } from '../types/design'

function action(overrides: Partial<TimelineAction> = {}): TimelineAction {
  return {
    id: 'timeline-1',
    action_type: 'planting',
    description: 'Plant tree',
    start_date: '2026-04-10',
    end_date: '2026-04-16',
    recurrence: null,
    targets: [MANUAL_TARGET],
    depends_on: null,
    completed: false,
    order: 0,
    ...overrides,
  }
}

const GEOMETRY_STATE: TimelineActionCanvasGeometryState = {
  originDate: new Date('2026-04-01T00:00:00.000Z'),
  pxPerDay: 5,
  scrollX: 0,
}

describe('Timeline Action Canvas geometry', () => {
  it('computes shared row offsets, canvas height, and hit boxes for stacked actions', () => {
    const rows = groupTimelineActionsByType([
      action({ id: 'timeline-1' }),
      action({ id: 'timeline-2', description: 'Mulch tree' }),
    ])
    const layout = computeTimelineActionLayout(rows)

    const geometry = createTimelineActionCanvasGeometry({
      rows,
      layout,
      state: GEOMETRY_STATE,
    })

    expect(geometry.rowOffsets).toEqual([
      TIMELINE_RULER_HEIGHT,
      TIMELINE_RULER_HEIGHT + TIMELINE_LANE_HEIGHT * 2,
      TIMELINE_RULER_HEIGHT + TIMELINE_LANE_HEIGHT * 3,
      TIMELINE_RULER_HEIGHT + TIMELINE_LANE_HEIGHT * 4,
      TIMELINE_RULER_HEIGHT + TIMELINE_LANE_HEIGHT * 5,
      TIMELINE_RULER_HEIGHT + TIMELINE_LANE_HEIGHT * 6,
      TIMELINE_RULER_HEIGHT + TIMELINE_LANE_HEIGHT * 7,
    ])
    expect(geometry.canvasHeight).toBe(TIMELINE_RULER_HEIGHT + TIMELINE_LANE_HEIGHT * 7)

    expect(hitTestTimelineActionGeometry(geometry, {
      x: TIMELINE_LABEL_SIDEBAR_WIDTH + 60,
      y: TIMELINE_RULER_HEIGHT + 16,
    })).toMatchObject({
      action: { id: 'timeline-1' },
      edge: 'body',
    })
    expect(hitTestTimelineActionGeometry(geometry, {
      x: TIMELINE_LABEL_SIDEBAR_WIDTH + 60,
      y: TIMELINE_RULER_HEIGHT + TIMELINE_LANE_HEIGHT + 16,
    })).toMatchObject({
      action: { id: 'timeline-2' },
      edge: 'body',
    })
  })
})
