import { beforeEach, describe, expect, it } from 'vitest'
import {
  ACTION_TYPES,
  computeTimelineActionLayout,
  groupTimelineActionsByType,
  type TimelinePlanningProjection,
} from '../app/planning-projection'
import { createTimelineActionInteractionFrame } from '../app/timeline/interaction-frame'
import {
  LABEL_SIDEBAR_WIDTH,
  RULER_HEIGHT,
  computeTimelineRowOffsets,
  type TimelineRenderState,
} from '../canvas/timeline-renderer'
import type { TimelineActionPendingClick } from '../app/timeline/workbench'
import { currentDesign, nonCanvasRevision } from './support/design-session-state'
import { speciesTarget } from '../target'
import type { CanopiFile, TimelineAction } from '../types/design'

function makeRect(): DOMRect {
  return {
    left: 0,
    top: 0,
    right: 500,
    bottom: 260,
    width: 500,
    height: 260,
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
    name: 'Timeline frame test',
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
    budget_currency: 'EUR',
    extra: {},
    created_at: '2026-04-08T00:00:00.000Z',
    updated_at: '2026-04-08T00:00:00.000Z',
  }
}

function createFrameHarness({
  actions = [],
  initialScrollX = 40,
}: {
  readonly actions?: readonly TimelineAction[]
  readonly initialScrollX?: number
} = {}) {
  const canvas = document.createElement('canvas')
  const rect = makeRect()
  canvas.getBoundingClientRect = () => rect
  const rows = actions.length > 0
    ? groupTimelineActionsByType(actions)
    : ACTION_TYPES.map((actionType) => ({ actionType, actions: [] }))
  const layout = actions.length > 0 ? computeTimelineActionLayout(rows) : new Map()
  const rowOffsets = computeTimelineRowOffsets(rows, layout)
  const renderState: TimelineRenderState = {
    originDate: new Date('2026-04-01T00:00:00.000Z'),
    pxPerDay: 5,
    scrollX: initialScrollX,
    selectedId: null,
    hoveredId: null,
    locale: 'en',
    speciesColors: {},
    granularity: 'month',
  }
  const projection: TimelinePlanningProjection = {
    rows,
    layout,
    speciesList: [],
    originMs: renderState.originDate.getTime(),
  }
  let scrollX = renderState.scrollX
  let pxPerDay = renderState.pxPerDay
  let granularity: 'month' | 'year' = 'month'
  const openedPendingClicks: TimelineActionPendingClick[] = []
  const selectedActionIds: string[] = []
  const computedOriginMsRef = { current: projection.originMs }
  let selectionClearCount = 0
  let hoverClearCount = 0
  let nextFrameId = 1
  const animationCallbacks = new Map<number, FrameRequestCallback>()

  const frame = createTimelineActionInteractionFrame({
    canvasRef: { current: canvas },
    cachedRectRef: { current: null },
    rowsRef: { current: rows },
    layoutRef: { current: layout },
    rowOffsetsRef: { current: rowOffsets },
    renderStateRef: { current: renderState },
    projectionRef: { current: projection },
    computedOriginMsRef,
    view: {
      getScrollX: () => scrollX,
      setScrollX: (next) => {
        scrollX = next
        renderState.scrollX = next
      },
      getPxPerDay: () => pxPerDay,
      setPxPerDay: (next) => {
        pxPerDay = next
        renderState.pxPerDay = next
      },
      getGranularity: () => granularity,
      setGranularity: (next) => {
        granularity = next
      },
    },
    popover: {
      isOpen: () => false,
      close: () => false,
      openPendingClick: (pendingClick) => {
        openedPendingClicks.push(pendingClick)
      },
    },
    selection: {
      selectAction: (action) => {
        selectedActionIds.push(action.id)
      },
      clear: () => {
        selectionClearCount++
      },
    },
    hover: {
      showAction: () => {},
      clear: () => {
        hoverClearCount++
      },
      hideTooltip: () => {},
    },
    animation: {
      requestAnimationFrame: (callback) => {
        const id = nextFrameId++
        animationCallbacks.set(id, callback)
        return id
      },
      cancelAnimationFrame: (id) => {
        animationCallbacks.delete(id)
      },
    },
  })

  return {
    canvas,
    frame,
    get scrollX() {
      return scrollX
    },
    openedPendingClicks,
    selectedActionIds,
    computedOriginMsRef,
    get selectionClearCount() {
      return selectionClearCount
    },
    get hoverClearCount() {
      return hoverClearCount
    },
    get scheduledAnimationFrames() {
      return animationCallbacks.size
    },
    flushAnimationFrame() {
      const next = animationCallbacks.entries().next().value
      if (!next) return false
      const [id, callback] = next
      animationCallbacks.delete(id)
      callback(0)
      return true
    },
    chartY: RULER_HEIGHT + 12,
    chartX: LABEL_SIDEBAR_WIDTH + 80,
  }
}

describe('Timeline Action interaction frame', () => {
  beforeEach(() => {
    document.body.style.cursor = ''
    nonCanvasRevision.value = 0
  })

  it('owns pan drag state and cursor cleanup behind the frame seam', () => {
    const harness = createFrameHarness()

    harness.frame.handleMouseDown(new MouseEvent('mousedown', {
      button: 1,
      clientX: harness.chartX,
      clientY: harness.chartY,
      bubbles: true,
    }))

    expect(document.body.style.cursor).toBe('grabbing')

    harness.frame.handleDocumentMouseMove(new MouseEvent('mousemove', {
      clientX: harness.chartX + 30,
      clientY: harness.chartY,
      bubbles: true,
    }))

    expect(harness.scrollX).toBe(10)

    harness.frame.handleDocumentMouseUp(new MouseEvent('mouseup', {
      clientX: harness.chartX + 30,
      clientY: harness.chartY,
      bubbles: true,
    }))

    expect(document.body.style.cursor).toBe('')
    expect(harness.openedPendingClicks).toEqual([])
  })

  it('previews and commits move drags while restoring a frozen planning origin', () => {
    const action = makeAction()
    currentDesign.value = makeDesign(action)
    const harness = createFrameHarness({ actions: [action], initialScrollX: 0 })

    harness.frame.handleMouseDown(new MouseEvent('mousedown', {
      button: 0,
      clientX: LABEL_SIDEBAR_WIDTH + 50,
      clientY: harness.chartY,
      bubbles: true,
    }))

    expect(harness.selectedActionIds).toEqual(['task-1'])

    harness.frame.handleDocumentMouseMove(new MouseEvent('mousemove', {
      clientX: LABEL_SIDEBAR_WIDTH + 60,
      clientY: harness.chartY,
      bubbles: true,
    }))

    expect(currentDesign.value!.timeline[0]).toMatchObject({
      start_date: '2026-04-12',
      end_date: '2026-04-14',
    })
    expect(nonCanvasRevision.value).toBe(0)

    harness.computedOriginMsRef.current = new Date('2026-03-30T00:00:00.000Z').getTime()
    harness.frame.handleDocumentMouseUp(new MouseEvent('mouseup', {
      clientX: LABEL_SIDEBAR_WIDTH + 60,
      clientY: harness.chartY,
      bubbles: true,
    }))

    expect(nonCanvasRevision.value).toBe(1)
    expect(harness.scrollX).toBe(10)
    expect(harness.openedPendingClicks).toEqual([])
  })

  it('previews and commits right-edge resize drags through the frame', () => {
    const action = makeAction({ end_date: '2026-04-16' })
    currentDesign.value = makeDesign(action)
    const harness = createFrameHarness({ actions: [action], initialScrollX: 0 })

    harness.frame.handleMouseDown(new MouseEvent('mousedown', {
      button: 0,
      clientX: LABEL_SIDEBAR_WIDTH + 73,
      clientY: harness.chartY,
      bubbles: true,
    }))

    expect(document.body.style.cursor).toBe('ew-resize')

    harness.frame.handleDocumentMouseMove(new MouseEvent('mousemove', {
      clientX: LABEL_SIDEBAR_WIDTH + 83,
      clientY: harness.chartY,
      bubbles: true,
    }))

    expect(currentDesign.value!.timeline[0]).toMatchObject({
      start_date: '2026-04-10',
      end_date: '2026-04-18',
    })
    expect(nonCanvasRevision.value).toBe(0)

    harness.frame.handleDocumentMouseUp(new MouseEvent('mouseup', {
      clientX: LABEL_SIDEBAR_WIDTH + 83,
      clientY: harness.chartY,
      bubbles: true,
    }))

    expect(nonCanvasRevision.value).toBe(1)
    expect(document.body.style.cursor).toBe('')
  })

  it('auto-scrolls edit drags near the chart edge', () => {
    const action = makeAction({ end_date: '2026-04-16' })
    currentDesign.value = makeDesign(action)
    const harness = createFrameHarness({ actions: [action], initialScrollX: 0 })

    harness.frame.handleMouseDown(new MouseEvent('mousedown', {
      button: 0,
      clientX: LABEL_SIDEBAR_WIDTH + 60,
      clientY: harness.chartY,
      bubbles: true,
    }))

    harness.frame.handleDocumentMouseMove(new MouseEvent('mousemove', {
      clientX: 495,
      clientY: harness.chartY,
      bubbles: true,
    }))

    expect(harness.scheduledAnimationFrames).toBe(1)

    const startAfterPointerMove = currentDesign.value!.timeline[0]!.start_date!
    const scrollAfterPointerMove = harness.scrollX

    expect(harness.flushAnimationFrame()).toBe(true)

    expect(harness.scrollX).toBeGreaterThan(scrollAfterPointerMove)
    expect(Date.parse(currentDesign.value!.timeline[0]!.start_date!))
      .toBeGreaterThan(Date.parse(startAfterPointerMove))

    harness.frame.handleDocumentMouseUp(new MouseEvent('mouseup', {
      clientX: 495,
      clientY: harness.chartY,
      bubbles: true,
    }))
  })

  it('opens edit pending clicks without dirtying no-op drags', () => {
    const action = makeAction({ end_date: '2026-04-16' })
    currentDesign.value = makeDesign(action)
    const harness = createFrameHarness({ actions: [action], initialScrollX: 0 })

    harness.frame.handleMouseDown(new MouseEvent('mousedown', {
      button: 0,
      clientX: LABEL_SIDEBAR_WIDTH + 60,
      clientY: harness.chartY,
      bubbles: true,
    }))
    harness.frame.handleDocumentMouseUp(new MouseEvent('mouseup', {
      button: 0,
      clientX: LABEL_SIDEBAR_WIDTH + 60,
      clientY: harness.chartY,
      bubbles: true,
    }))

    expect(nonCanvasRevision.value).toBe(0)
    expect(currentDesign.value!.timeline[0]).toMatchObject({
      start_date: '2026-04-10',
      end_date: '2026-04-16',
    })
    expect(harness.openedPendingClicks).toEqual([{
      type: 'edit',
      anchorX: LABEL_SIDEBAR_WIDTH + 60,
      anchorY: harness.chartY,
      actionId: 'task-1',
    }])
  })

  it('aborts active edit drags without committing previewed dates', () => {
    const action = makeAction({ end_date: '2026-04-16' })
    currentDesign.value = makeDesign(action)
    const harness = createFrameHarness({ actions: [action], initialScrollX: 0 })

    harness.frame.handleMouseDown(new MouseEvent('mousedown', {
      button: 0,
      clientX: LABEL_SIDEBAR_WIDTH + 60,
      clientY: harness.chartY,
      bubbles: true,
    }))
    harness.frame.handleDocumentMouseMove(new MouseEvent('mousemove', {
      clientX: LABEL_SIDEBAR_WIDTH + 70,
      clientY: harness.chartY,
      bubbles: true,
    }))

    expect(currentDesign.value!.timeline[0]).toMatchObject({
      start_date: '2026-04-12',
      end_date: '2026-04-18',
    })

    harness.frame.abortActiveDrag()

    expect(currentDesign.value!.timeline[0]).toMatchObject({
      start_date: '2026-04-10',
      end_date: '2026-04-16',
    })
    expect(nonCanvasRevision.value).toBe(0)
    expect(harness.openedPendingClicks).toEqual([])
  })

  it('cleans up active edit drags and scheduled autoscroll on unmount', () => {
    const action = makeAction({ end_date: '2026-04-16' })
    currentDesign.value = makeDesign(action)
    const harness = createFrameHarness({ actions: [action], initialScrollX: 0 })

    harness.frame.handleMouseDown(new MouseEvent('mousedown', {
      button: 0,
      clientX: LABEL_SIDEBAR_WIDTH + 60,
      clientY: harness.chartY,
      bubbles: true,
    }))
    harness.frame.handleDocumentMouseMove(new MouseEvent('mousemove', {
      clientX: 495,
      clientY: harness.chartY,
      bubbles: true,
    }))

    expect(harness.scheduledAnimationFrames).toBe(1)

    harness.frame.cleanup()

    expect(harness.scheduledAnimationFrames).toBe(0)
    expect(nonCanvasRevision.value).toBe(1)
    expect(harness.hoverClearCount).toBe(1)
    expect(harness.selectionClearCount).toBe(1)
    expect(harness.openedPendingClicks).toEqual([])
  })
})
