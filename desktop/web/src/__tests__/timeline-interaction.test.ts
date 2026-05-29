import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyTimelineEditDragDelta,
  commitTimelineDrag,
  createTimelineMoveDrag,
  createTimelinePanDrag,
  createTimelineResizeDrag,
  restoreTimelineOriginScroll,
  updateTimelinePanScrollX,
} from '../app/timeline/interaction'
import { projectTimelineAction } from '../app/planning-projection'
import { currentDesign, nonCanvasRevision, nonCanvasSavedRevision } from '../state/design'
import { speciesTarget } from '../panel-targets'
import type { CanopiFile, TimelineAction } from '../types/design'

function makeRect(): DOMRect {
  return {
    left: 0,
    top: 0,
    right: 400,
    bottom: 200,
    width: 400,
    height: 200,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect
}

function makeAction(overrides: Partial<TimelineAction> = {}): TimelineAction {
  return {
    id: 'task-1',
    action_type: 'planting',
    description: 'Plant apple',
    start_date: '2026-04-10',
    end_date: '2026-04-12',
    recurrence: null,
    targets: [speciesTarget('Malus domestica')],
    depends_on: null,
    completed: false,
    order: 0,
    ...overrides,
  }
}

function makeDesign(action: TimelineAction): CanopiFile {
  return {
    version: 2,
    name: 'Timeline interaction test',
    description: null,
    location: null,
    north_bearing_deg: null,
    plant_species_colors: {},
    layers: [],
    plants: [],
    zones: [],
    annotations: [],
    consortiums: [],
    groups: [],
    timeline: [action],
    budget: [],
    extra: {},
    created_at: '2026-04-08T00:00:00.000Z',
    updated_at: '2026-04-08T00:00:00.000Z',
  }
}

describe('Timeline interaction', () => {
  beforeEach(() => {
    currentDesign.value = makeDesign(makeAction())
    nonCanvasRevision.value = 0
    nonCanvasSavedRevision.value = 0
  })

  it('previews and commits Timeline Action move drags through one module interface', () => {
    const action = currentDesign.value!.timeline[0]!
    const drag = createTimelineMoveDrag({
      hit: { action: projectTimelineAction(action), edge: 'body' },
      startMouseX: 100,
      cachedRect: makeRect(),
      pxPerDaySnapshot: 5,
    })

    expect(drag).not.toBeNull()
    applyTimelineEditDragDelta(drag!, 10)

    expect(currentDesign.value!.timeline[0]).toMatchObject({
      start_date: '2026-04-12',
      end_date: '2026-04-14',
    })
    expect(nonCanvasRevision.value).toBe(0)

    commitTimelineDrag(drag)
    expect(nonCanvasRevision.value).toBe(1)
  })

  it('previews right-edge resize drags without caller-owned edit transactions', () => {
    const action = currentDesign.value!.timeline[0]!
    const drag = createTimelineResizeDrag({
      hit: { action: projectTimelineAction(action), edge: 'right' },
      startMouseX: 100,
      cachedRect: makeRect(),
      pxPerDaySnapshot: 5,
    })

    expect(drag).not.toBeNull()
    applyTimelineEditDragDelta(drag!, 15)
    commitTimelineDrag(drag)

    expect(currentDesign.value!.timeline[0]).toMatchObject({
      start_date: '2026-04-10',
      end_date: '2026-04-15',
    })
    expect(nonCanvasRevision.value).toBe(1)
  })

  it('keeps pan and origin-freeze math behind interaction helpers', () => {
    const pan = createTimelinePanDrag({
      startMouseX: 200,
      startScrollX: 40,
      cachedRect: makeRect(),
    })

    expect(updateTimelinePanScrollX(pan, 250)).toBe(-10)
    expect(restoreTimelineOriginScroll({
      frozenOriginMs: new Date('2026-04-10T00:00:00.000Z').getTime(),
      realOriginMs: new Date('2026-04-08T00:00:00.000Z').getTime(),
      scrollX: 20,
      pxPerDay: 5,
    })).toBe(30)
  })
})
