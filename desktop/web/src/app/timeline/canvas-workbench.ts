import { useCallback, useEffect, useMemo, useRef } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import {
  useTimelinePlanningSurface,
  type TimelineActionLayout,
  type TimelineActionTypeRow,
  type TimelinePlanningAction,
} from '../planning-projection'
import {
  RULER_HEIGHT,
  computeTimelineRowOffsets,
  type TimelineRenderState,
} from '../../canvas/timeline-renderer'
import type { TimelineAction } from '../../types/design'
import type { TimelineActionFormData } from './editing'
import {
  TIMELINE_GRANULARITY_PX_PER_DAY,
  type TimelineGranularity,
} from './interaction'
import {
  createTimelineActionInteractionFrame,
  type TimelineActionInteractionFrame,
} from './interaction-frame'
import {
  type TimelineActionPopoverState,
} from './workbench'

interface MutableDomRef<T> {
  current: T | null
}

export type TimelineTooltipState = {
  x: number
  y: number
  action: TimelinePlanningAction
}

export interface TimelineCanvasWorkbenchOptions {
  readonly canvasRef: MutableDomRef<HTMLCanvasElement>
}

export interface TimelineCanvasWorkbench {
  readonly cachedRectRef: { current: DOMRect | null }
  readonly rows: readonly TimelineActionTypeRow[]
  readonly layout: ReadonlyMap<string, TimelineActionLayout>
  readonly rowOffsets: number[]
  readonly canvasHeight: number
  readonly renderState: TimelineRenderState
  readonly renderDeps: readonly unknown[]
  readonly tooltip: TimelineTooltipState | null
  readonly popover: TimelineActionPopoverState | null
  readonly invalidateLayout: () => void
  readonly handleContainerScroll: () => void
  readonly handleMouseDown: (event: MouseEvent) => void
  readonly handleCanvasMouseMove: (event: MouseEvent) => void
  readonly handleMouseLeave: () => void
  readonly handlePopoverSave: (data: TimelineActionFormData) => void
  readonly handlePopoverDelete: () => void
  readonly handlePopoverCancel: () => void
}

const EMPTY_ACTIONS: TimelineAction[] = []

export function useTimelineCanvasWorkbench({
  canvasRef,
}: TimelineCanvasWorkbenchOptions): TimelineCanvasWorkbench {
  const fallbackOriginMs = useMemo(() => Date.now(), [])
  const {
    actions,
    projection,
    activeLocale,
    speciesColors,
  } = useTimelinePlanningSurface({ fallbackOriginMs })
  const rows = projection.rows
  const layout = projection.layout
  const originMs = projection.originMs
  const originDate = useMemo(() => new Date(originMs), [originMs])
  const rowOffsets = useMemo(() => computeTimelineRowOffsets(rows, layout), [rows, layout])
  const canvasHeight = rowOffsets[rowOffsets.length - 1] ?? RULER_HEIGHT
  const cachedRectRef = useRef<DOMRect | null>(null)
  const granularity = useSignal<TimelineGranularity>('month')
  const pxPerDay = useSignal(TIMELINE_GRANULARITY_PX_PER_DAY.month)
  const scrollX = useSignal(0)
  const selectedId = useSignal<string | null>(null)
  const hoveredId = useSignal<string | null>(null)
  const tooltipState = useSignal<TimelineTooltipState | null>(null)
  const popoverState = useSignal<TimelineActionPopoverState | null>(null)
  const rowsRef = useRef<readonly TimelineActionTypeRow[]>([])
  const layoutRef = useRef<ReadonlyMap<string, TimelineActionLayout>>(new Map())
  const rowOffsetsRef = useRef<number[]>(rowOffsets)
  const projectionRef = useRef(projection)
  const computedOriginMsRef = useRef(0)
  const interactionFrameRef = useRef<TimelineActionInteractionFrame | null>(null)

  rowsRef.current = rows
  layoutRef.current = layout
  rowOffsetsRef.current = rowOffsets
  projectionRef.current = projection
  computedOriginMsRef.current = originMs

  const renderState = useMemo<TimelineRenderState>(() => ({
    originDate: interactionFrameRef.current?.getFrozenOriginDate() ?? originDate,
    pxPerDay: pxPerDay.value,
    scrollX: scrollX.value,
    selectedId: selectedId.value,
    hoveredId: hoveredId.value,
    locale: activeLocale,
    speciesColors,
    granularity: granularity.value,
  }), [
    originDate,
    pxPerDay.value,
    scrollX.value,
    selectedId.value,
    hoveredId.value,
    activeLocale,
    speciesColors,
    granularity.value,
  ])

  const renderStateRef = useRef(renderState)
  renderStateRef.current = renderState

  if (!interactionFrameRef.current) {
    interactionFrameRef.current = createTimelineActionInteractionFrame({
      canvasRef,
      cachedRectRef,
      rowsRef,
      layoutRef,
      rowOffsetsRef,
      renderStateRef,
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
        getGranularity: () => granularity.peek(),
        setGranularity: (next) => {
          granularity.value = next
        },
      },
      popover: {
        get: () => popoverState.peek(),
        set: (next) => {
          popoverState.value = next
        },
        isOpen: () => popoverState.peek() !== null,
        close: () => {
          if (!popoverState.peek()) return false
          popoverState.value = null
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
          if (hoveredId.value !== action.id) hoveredId.value = action.id
          if (!popoverState.peek()) {
            tooltipState.value = { x: point.x, y: point.y, action }
          }
        },
        clear: () => {
          if (hoveredId.value !== null) hoveredId.value = null
          if (tooltipState.peek()) tooltipState.value = null
        },
        hideTooltip: () => {
          if (tooltipState.peek()) tooltipState.value = null
        },
      },
    })
  }
  const interactionFrame = interactionFrameRef.current

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas) canvas.addEventListener('wheel', interactionFrame.handleWheel, { passive: false })

    const onMove = (event: MouseEvent) => {
      interactionFrame.handleDocumentMouseMove(event)
    }
    const onUp = (event: MouseEvent) => {
      interactionFrame.handleDocumentMouseUp(event)
    }
    const onLeave = () => {
      interactionFrame.handleDocumentMouseLeave()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      interactionFrame.handleKeyDown(event)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.addEventListener('keydown', onKeyDown)
    document.documentElement.addEventListener('mouseleave', onLeave)
    return () => {
      if (canvas) canvas.removeEventListener('wheel', interactionFrame.handleWheel)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('keydown', onKeyDown)
      document.documentElement.removeEventListener('mouseleave', onLeave)
      interactionFrame.cleanup()
    }
  }, [canvasRef, interactionFrame])

  useEffect(() => {
    interactionFrame.syncActions(actions ?? EMPTY_ACTIONS)
  }, [actions, hoveredId.value, interactionFrame, selectedId.value])

  const invalidateLayout = useCallback(() => {
    cachedRectRef.current = null
  }, [])

  return {
    cachedRectRef,
    rows,
    layout,
    rowOffsets,
    canvasHeight,
    renderState,
    renderDeps: [
      rows,
      layout,
      rowOffsets,
      originMs,
      pxPerDay.value,
      scrollX.value,
      selectedId.value,
      hoveredId.value,
      activeLocale,
      speciesColors,
      granularity.value,
    ],
    tooltip: tooltipState.value,
    popover: popoverState.value,
    invalidateLayout,
    handleContainerScroll: interactionFrame.handleContainerScroll,
    handleMouseDown: interactionFrame.handleMouseDown,
    handleCanvasMouseMove: interactionFrame.handleCanvasMouseMove,
    handleMouseLeave: interactionFrame.handleMouseLeave,
    handlePopoverSave: interactionFrame.handlePopoverSave,
    handlePopoverDelete: interactionFrame.handlePopoverDelete,
    handlePopoverCancel: interactionFrame.handlePopoverCancel,
  }
}
