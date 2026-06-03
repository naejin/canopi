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
import { createUuid } from '../../utils/ids'
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
  clearTimelineHoveredPanelTargets,
  clearTimelineSelectedPanelTargets,
  deleteSelectedTimelineAction,
  deleteTimelineActionPopover,
  openTimelineActionPopover,
  saveTimelineActionPopover,
  type TimelineActionPopoverState,
} from './workbench'
import { setTimelineHoveredPanelTargets, setTimelineSelectedPanelTargets } from './workbench'
import { isEditableTarget } from '../../canvas/runtime/interaction/pointer-utils'

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
  const selectedIdRef = useRef<string | null>(null)
  const interactionFrameRef = useRef<TimelineActionInteractionFrame | null>(null)

  selectedIdRef.current = selectedId.value
  rowsRef.current = rows
  layoutRef.current = layout
  rowOffsetsRef.current = rowOffsets
  projectionRef.current = projection
  computedOriginMsRef.current = originMs

  useEffect(() => {
    const current = actions ?? EMPTY_ACTIONS
    const selectedActionId = selectedId.value
    if (selectedActionId && !current.some((action) => action.id === selectedActionId)) {
      selectedId.value = null
      clearTimelineSelectedPanelTargets()
    }

    const hoveredActionId = hoveredId.value
    if (hoveredActionId && !current.some((action) => action.id === hoveredActionId)) {
      hoveredId.value = null
      clearTimelineHoveredPanelTargets()
    }
  }, [actions, hoveredId.value, selectedId.value])

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
        isOpen: () => popoverState.peek() !== null,
        close: () => {
          if (!popoverState.peek()) return false
          popoverState.value = null
          return true
        },
        openPendingClick: (pendingClick) => {
          popoverState.value = openTimelineActionPopover({
            pendingClick,
            speciesList: projectionRef.current.speciesList,
          })
        },
      },
      selection: {
        selectAction: (action) => {
          selectedId.value = action.id
          setTimelineSelectedPanelTargets(action.targets)
        },
        clear: clearTimelineSelectedPanelTargets,
      },
      hover: {
        showAction: (action, point) => {
          if (hoveredId.value !== action.id) hoveredId.value = action.id
          setTimelineHoveredPanelTargets(action.targets)
          if (!popoverState.peek()) {
            tooltipState.value = { x: point.x, y: point.y, action }
          }
        },
        clear: () => {
          if (hoveredId.value !== null) hoveredId.value = null
          clearTimelineHoveredPanelTargets()
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

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.documentElement.addEventListener('mouseleave', onLeave)
    return () => {
      if (canvas) canvas.removeEventListener('wheel', interactionFrame.handleWheel)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.documentElement.removeEventListener('mouseleave', onLeave)
      interactionFrame.cleanup()
    }
  }, [canvasRef, interactionFrame])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (popoverState.peek()) return
      if (!selectedIdRef.current) return
      if (isEditableTarget(event.target)) return
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        const result = deleteSelectedTimelineAction(selectedIdRef.current)
        if (hoveredId.value !== null) hoveredId.value = null
        if ('selectedId' in result) selectedId.value = result.selectedId ?? null
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [hoveredId, popoverState])

  const handlePopoverSave = useCallback((data: TimelineActionFormData) => {
    const ps = popoverState.peek()
    if (!ps) return

    const result = saveTimelineActionPopover({
      popover: ps,
      data,
      createId: createUuid,
    })
    if ('selectedId' in result) selectedId.value = result.selectedId ?? null
    popoverState.value = null
  }, [popoverState])

  const handlePopoverDelete = useCallback(() => {
    const ps = popoverState.peek()
    if (!ps) return
    const result = deleteTimelineActionPopover(ps)
    if ('selectedId' in result) selectedId.value = result.selectedId ?? null
    popoverState.value = null
  }, [popoverState])

  const handlePopoverCancel = useCallback(() => {
    popoverState.value = null
  }, [popoverState])

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
    handlePopoverSave,
    handlePopoverDelete,
    handlePopoverCancel,
  }
}
