import { signal, type ReadonlySignal } from '@preact/signals'
import type {
  TimelineActionLayout,
  TimelineActionTypeRow,
  TimelinePlanningAction,
  TimelinePlanningProjection,
} from '../../planning-projection'
import type { TimelineRenderState } from '../../../canvas/timeline-renderer'
import {
  DEFAULT_TIMELINE_PX_PER_DAY,
  createTimelineActionCanvasGeometry,
  type TimelineActionCanvasGeometryState,
  type TimelineActionCanvasGeometry,
} from './geometry'
import {
  createTimelineActionInteractionFrame,
  type TimelineActionInteractionFrame,
  type TimelineActionInteractionFrameAnimation,
} from './interaction-frame'
import type { TimelineActionPopoverState } from '../workbench'
import type { TimelineActionFormData } from '../editing'

interface MutableRef<T> {
  current: T
}

interface MutableDomRef<T> {
  current: T | null
}

export type TimelineTooltipState = {
  x: number
  y: number
  action: TimelinePlanningAction
}

export interface TimelineActionCanvasControllerInputs {
  readonly rows: readonly TimelineActionTypeRow[]
  readonly layout: ReadonlyMap<string, TimelineActionLayout>
  readonly projection: TimelinePlanningProjection
  readonly originDate: Date
  readonly originMs: number
  readonly activeLocale: string
  readonly speciesColors: Record<string, string>
}

export interface TimelineActionCanvasControllerOptions {
  readonly canvasRef: MutableDomRef<HTMLCanvasElement>
  readonly cachedRectRef: MutableDomRef<DOMRect>
  readonly animation?: TimelineActionInteractionFrameAnimation
}

export interface TimelineActionCanvasController {
  readonly pxPerDay: ReadonlySignal<number>
  readonly scrollX: ReadonlySignal<number>
  readonly selectedId: ReadonlySignal<string | null>
  readonly hoveredId: ReadonlySignal<string | null>
  readonly tooltip: ReadonlySignal<TimelineTooltipState | null>
  readonly popover: ReadonlySignal<TimelineActionPopoverState | null>
  updateInputs(inputs: TimelineActionCanvasControllerInputs): void
  readRenderState(): TimelineRenderState
  readGeometry(): TimelineActionCanvasGeometry
  getFrozenOriginDate(): Date | null
  syncActions(actions: readonly { readonly id: string }[]): void
  handleContainerScroll(): void
  handleMouseDown(event: MouseEvent): void
  handleCanvasMouseMove(event: MouseEvent): void
  handleMouseLeave(): void
  handleDocumentMouseMove(event: MouseEvent): void
  handleDocumentMouseUp(event: MouseEvent): void
  handleDocumentMouseLeave(): void
  handleWheel(event: WheelEvent): void
  handleKeyDown(event: KeyboardEvent): void
  handlePopoverSave(data: TimelineActionFormData): void
  handlePopoverDelete(): void
  handlePopoverCancel(): void
  cleanup(): void
}

const EMPTY_ROWS: readonly TimelineActionTypeRow[] = []
const EMPTY_LAYOUT: ReadonlyMap<string, TimelineActionLayout> = new Map()
const EMPTY_PROJECTION: TimelinePlanningProjection = {
  rows: EMPTY_ROWS,
  layout: EMPTY_LAYOUT,
  speciesList: [],
  originMs: 0,
}

interface TimelineActionCanvasGeometryInputs {
  readonly rows: readonly TimelineActionTypeRow[]
  readonly layout: ReadonlyMap<string, TimelineActionLayout>
  readonly state: TimelineActionCanvasGeometryState
}

export function createTimelineActionCanvasController({
  canvasRef,
  cachedRectRef,
  animation,
}: TimelineActionCanvasControllerOptions): TimelineActionCanvasController {
  const rowsRef: MutableRef<readonly TimelineActionTypeRow[]> = { current: EMPTY_ROWS }
  const layoutRef: MutableRef<ReadonlyMap<string, TimelineActionLayout>> = { current: EMPTY_LAYOUT }
  const projectionRef: MutableRef<TimelinePlanningProjection> = { current: EMPTY_PROJECTION }
  const computedOriginMsRef: MutableRef<number> = { current: 0 }

  const pxPerDay = signal(DEFAULT_TIMELINE_PX_PER_DAY)
  const scrollX = signal(0)
  const selectedId = signal<string | null>(null)
  const hoveredId = signal<string | null>(null)
  const tooltip = signal<TimelineTooltipState | null>(null)
  const popover = signal<TimelineActionPopoverState | null>(null)

  let originDate = new Date(0)
  let activeLocale = 'en'
  let speciesColors: Record<string, string> = {}
  let frame: TimelineActionInteractionFrame | null = null

  const renderStateRef: MutableRef<TimelineRenderState> = {
    current: {
      originDate,
      pxPerDay: pxPerDay.peek(),
      scrollX: scrollX.peek(),
      selectedId: selectedId.peek(),
      hoveredId: hoveredId.peek(),
      locale: activeLocale,
      speciesColors,
    },
  }
  const geometryRef: MutableRef<TimelineActionCanvasGeometry> = {
    current: createTimelineActionCanvasGeometry({
      rows: EMPTY_ROWS,
      layout: EMPTY_LAYOUT,
      state: renderStateRef.current,
    }),
  }
  let geometryInputs: TimelineActionCanvasGeometryInputs = {
    rows: EMPTY_ROWS,
    layout: EMPTY_LAYOUT,
    state: {
      originDate,
      pxPerDay: pxPerDay.peek(),
      scrollX: scrollX.peek(),
    },
  }

  function readRenderState(): TimelineRenderState {
    const state: TimelineRenderState = {
      originDate: frame?.getFrozenOriginDate() ?? originDate,
      pxPerDay: pxPerDay.value,
      scrollX: scrollX.value,
      selectedId: selectedId.value,
      hoveredId: hoveredId.value,
      locale: activeLocale,
      speciesColors,
    }
    renderStateRef.current = state
    syncGeometry(state)
    return state
  }

  function readGeometry(): TimelineActionCanvasGeometry {
    return geometryRef.current
  }

  function syncGeometry(state: TimelineRenderState): void {
    const geometryState: TimelineActionCanvasGeometryState = {
      originDate: state.originDate,
      pxPerDay: state.pxPerDay,
      scrollX: state.scrollX,
    }
    if (
      geometryInputs.rows === rowsRef.current
      && geometryInputs.layout === layoutRef.current
      && geometryInputs.state.originDate === geometryState.originDate
      && geometryInputs.state.pxPerDay === geometryState.pxPerDay
      && geometryInputs.state.scrollX === geometryState.scrollX
    ) {
      return
    }

    geometryInputs = {
      rows: rowsRef.current,
      layout: layoutRef.current,
      state: geometryState,
    }
    geometryRef.current = createTimelineActionCanvasGeometry(geometryInputs)
  }

  function activeFrame(): TimelineActionInteractionFrame {
    if (!frame) throw new Error('Timeline Action Canvas controller is not initialized')
    return frame
  }

  frame = createTimelineActionInteractionFrame({
    canvasRef,
    cachedRectRef,
    geometryRef,
    projectionRef,
    computedOriginMsRef,
    view: {
      getScrollX: () => scrollX.peek(),
      setScrollX: (next) => {
        scrollX.value = next
      },
      getPxPerDay: () => pxPerDay.peek(),
      setPxPerDay: (next) => {
        pxPerDay.value = next
      },
    },
    popover: {
      get: () => popover.peek(),
      set: (next) => {
        popover.value = next
      },
      isOpen: () => popover.peek() !== null,
      close: () => {
        if (!popover.peek()) return false
        popover.value = null
        return true
      },
    },
    selection: {
      getSelectedId: () => selectedId.peek(),
      selectAction: (action) => {
        selectedId.value = action.id
      },
      setSelectedId: (actionId) => {
        selectedId.value = actionId
      },
      clear: () => {},
    },
    hover: {
      showAction: (action, point) => {
        if (hoveredId.peek() !== action.id) hoveredId.value = action.id
        if (!popover.peek()) {
          tooltip.value = { x: point.x, y: point.y, action }
        }
      },
      clear: () => {
        if (hoveredId.peek() !== null) hoveredId.value = null
        if (tooltip.peek()) tooltip.value = null
      },
      hideTooltip: () => {
        if (tooltip.peek()) tooltip.value = null
      },
    },
    animation,
  })

  return {
    pxPerDay,
    scrollX,
    selectedId,
    hoveredId,
    tooltip,
    popover,

    updateInputs(inputs): void {
      rowsRef.current = inputs.rows
      layoutRef.current = inputs.layout
      projectionRef.current = inputs.projection
      computedOriginMsRef.current = inputs.originMs
      originDate = inputs.originDate
      activeLocale = inputs.activeLocale
      speciesColors = inputs.speciesColors
      readRenderState()
    },

    readRenderState,
    readGeometry,
    getFrozenOriginDate: () => activeFrame().getFrozenOriginDate(),
    syncActions: (actions) => activeFrame().syncActions(actions),
    handleContainerScroll: () => activeFrame().handleContainerScroll(),
    handleMouseDown: (event) => activeFrame().handleMouseDown(event),
    handleCanvasMouseMove: (event) => activeFrame().handleCanvasMouseMove(event),
    handleMouseLeave: () => activeFrame().handleMouseLeave(),
    handleDocumentMouseMove: (event) => activeFrame().handleDocumentMouseMove(event),
    handleDocumentMouseUp: (event) => activeFrame().handleDocumentMouseUp(event),
    handleDocumentMouseLeave: () => activeFrame().handleDocumentMouseLeave(),
    handleWheel: (event) => activeFrame().handleWheel(event),
    handleKeyDown: (event) => activeFrame().handleKeyDown(event),
    handlePopoverSave: (data) => activeFrame().handlePopoverSave(data),
    handlePopoverDelete: () => activeFrame().handlePopoverDelete(),
    handlePopoverCancel: () => activeFrame().handlePopoverCancel(),
    cleanup: () => activeFrame().cleanup(),
  }
}
