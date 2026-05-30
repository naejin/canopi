import { useCallback, useEffect, useMemo, useRef } from 'preact/hooks'
import { useSignal, useSignalEffect } from '@preact/signals'
import { currentDesign } from '../document-session/store'
import {
  ACTION_TYPES,
  type TimelineActionLayout,
  type TimelineActionTypeRow,
  type TimelinePlanningAction,
  type TimelinePlanningProjection,
} from '../planning-projection'
import {
  LABEL_SIDEBAR_WIDTH,
  RULER_HEIGHT,
  hitTestAction,
  type TimelineRenderState,
} from '../../canvas/timeline-renderer'
import { dateToX, snapToDay, toISODate, xToDate } from '../../canvas/timeline-math'
import { createUuid } from '../../utils/ids'
import type { TimelineAction } from '../../types/design'
import type { TimelineActionFormData } from './editing'
import {
  TIMELINE_CLICK_THRESHOLD,
  TIMELINE_GRANULARITY_PX_PER_DAY,
  applyTimelineEditDragDelta,
  commitTimelineDrag,
  createTimelineMoveDrag,
  createTimelineOriginFreeze,
  createTimelinePanDrag,
  createTimelineResizeDrag,
  hitTestTimelineRulerControls,
  isTimelineEditDrag,
  nextTimelineGranularity,
  restoreTimelineOriginScroll,
  timelineAutoScrollSpeed,
  updateTimelinePanScrollX,
  type TimelineDragState,
  type TimelineGranularity,
} from './interaction'
import {
  clearTimelineHoveredPanelTargets,
  clearTimelineSelectedPanelTargets,
  deleteSelectedTimelineAction,
  deleteTimelineActionPopover,
  openTimelineActionPopover,
  saveTimelineActionPopover,
  type TimelineActionPendingClick,
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
  readonly rows: readonly TimelineActionTypeRow[]
  readonly layout: ReadonlyMap<string, TimelineActionLayout>
  readonly rowOffsets: number[]
  readonly projection: TimelinePlanningProjection
  readonly originDate: Date
  readonly originMs: number
  readonly selectedId: string | null
  readonly onSelect: (id: string | null) => void
  readonly locale: string
  readonly speciesColors: Record<string, string>
}

export interface TimelineCanvasWorkbench {
  readonly cachedRectRef: { current: DOMRect | null }
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

interface PendingTimelineClick {
  readonly clientX: number
  readonly clientY: number
  readonly popover: TimelineActionPendingClick
}

const EMPTY_ACTIONS: TimelineAction[] = []

export function useTimelineCanvasWorkbench({
  canvasRef,
  rows,
  layout,
  rowOffsets,
  projection,
  originDate,
  originMs,
  selectedId,
  onSelect,
  locale,
  speciesColors,
}: TimelineCanvasWorkbenchOptions): TimelineCanvasWorkbench {
  const cachedRectRef = useRef<DOMRect | null>(null)
  const granularity = useSignal<TimelineGranularity>('month')
  const pxPerDay = useSignal(TIMELINE_GRANULARITY_PX_PER_DAY.month)
  const scrollX = useSignal(0)
  const hoveredId = useSignal<string | null>(null)
  const tooltipState = useSignal<TimelineTooltipState | null>(null)
  const popoverState = useSignal<TimelineActionPopoverState | null>(null)
  const dragState = useRef<TimelineDragState | null>(null)
  const pendingClick = useRef<PendingTimelineClick | null>(null)
  const rowsRef = useRef<readonly TimelineActionTypeRow[]>([])
  const layoutRef = useRef<ReadonlyMap<string, TimelineActionLayout>>(new Map())
  const rowOffsetsRef = useRef<number[]>(rowOffsets)
  const projectionRef = useRef(projection)
  const dragOriginMsRef = useRef<number | null>(null)
  const dragOriginDateRef = useRef<Date | null>(null)
  const computedOriginMsRef = useRef(0)
  const autoScrollRafRef = useRef<number | null>(null)
  const autoScrollAccumRef = useRef(0)
  const lastDragClientXRef = useRef(0)
  const selectedIdRef = useRef(selectedId)
  const onSelectRef = useRef(onSelect)

  selectedIdRef.current = selectedId
  onSelectRef.current = onSelect
  rowsRef.current = rows
  layoutRef.current = layout
  rowOffsetsRef.current = rowOffsets
  projectionRef.current = projection
  computedOriginMsRef.current = originMs

  useSignalEffect(() => {
    const hoveredActionId = hoveredId.value
    if (!hoveredActionId) return
    const current = currentDesign.value?.timeline ?? EMPTY_ACTIONS
    if (current.some((action) => action.id === hoveredActionId)) return
    hoveredId.value = null
    clearTimelineHoveredPanelTargets()
  })

  const renderState = useMemo<TimelineRenderState>(() => ({
    originDate: dragOriginDateRef.current ?? originDate,
    pxPerDay: pxPerDay.value,
    scrollX: scrollX.value,
    selectedId,
    hoveredId: hoveredId.value,
    locale,
    speciesColors,
    granularity: granularity.value,
  }), [
    originDate,
    pxPerDay.value,
    scrollX.value,
    selectedId,
    hoveredId.value,
    locale,
    speciesColors,
    granularity.value,
  ])

  const renderStateRef = useRef(renderState)
  renderStateRef.current = renderState

  const stopAutoScroll = useCallback(() => {
    const rafId = autoScrollRafRef.current
    if (rafId != null) {
      cancelAnimationFrame(rafId)
      autoScrollRafRef.current = null
    }
  }, [])

  const autoScrollTick = useCallback(() => {
    if (autoScrollRafRef.current == null) return
    const drag = dragState.current
    if (!isTimelineEditDrag(drag)) {
      stopAutoScroll()
      return
    }
    const mouseX = lastDragClientXRef.current - drag.cachedRect.left
    const speed = timelineAutoScrollSpeed(mouseX, drag.cachedRect.width)
    if (speed === 0) {
      stopAutoScroll()
      return
    }
    scrollX.value = scrollX.peek() + speed
    autoScrollAccumRef.current += speed
    applyTimelineEditDragDelta(
      drag,
      lastDragClientXRef.current - drag.startMouseX + autoScrollAccumRef.current,
    )
    autoScrollRafRef.current = requestAnimationFrame(autoScrollTick)
  }, [scrollX, stopAutoScroll])

  const updateAutoScroll = useCallback((mouseX: number, chartWidth: number): void => {
    const speed = timelineAutoScrollSpeed(mouseX, chartWidth)
    if (speed !== 0) {
      if (autoScrollRafRef.current == null) {
        autoScrollRafRef.current = requestAnimationFrame(autoScrollTick)
      }
    } else {
      stopAutoScroll()
    }
  }, [autoScrollTick, stopAutoScroll])

  const handleWheel = useCallback((event: WheelEvent) => {
    if (!(event.ctrlKey || event.metaKey)) return
    event.preventDefault()
    const drag = dragState.current
    if (drag?.type === 'move' || drag?.type === 'resize') return
    if (popoverState.peek()) popoverState.value = null

    const factor = event.deltaY > 0 ? 0.9 : 1.1
    const prev = pxPerDay.peek()
    const next = Math.max(0.2, Math.min(20, prev * factor))
    if (next !== prev) {
      const canvas = canvasRef.current
      if (canvas) {
        const rect = cachedRectRef.current ?? canvas.getBoundingClientRect()
        const mouseX = event.clientX - rect.left - LABEL_SIDEBAR_WIDTH
        const dayAtCursor = (scrollX.peek() + mouseX) / prev
        scrollX.value = dayAtCursor * next - mouseX
      }
      pxPerDay.value = next
    }
  }, [canvasRef, popoverState, pxPerDay, scrollX])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.addEventListener('wheel', handleWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', handleWheel)
  }, [canvasRef, handleWheel])

  const handleContainerScroll = useCallback(() => {
    cachedRectRef.current = null
    stopAutoScroll()
    if (hoveredId.peek() !== null) hoveredId.value = null
    if (tooltipState.peek()) tooltipState.value = null
    if (popoverState.peek()) popoverState.value = null
    clearTimelineHoveredPanelTargets()
    if (canvasRef.current) canvasRef.current.style.cursor = 'default'
  }, [canvasRef, hoveredId, popoverState, stopAutoScroll, tooltipState])

  const handleMouseDown = useCallback((event: MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const mouseX = event.clientX - rect.left
    const mouseY = event.clientY - rect.top

    if (event.button === 1) {
      event.preventDefault()
      dragState.current = createTimelinePanDrag({
        startMouseX: event.clientX,
        startScrollX: scrollX.peek(),
        cachedRect: rect,
      })
      document.body.style.cursor = 'grabbing'
      return
    }

    if (event.button !== 0) return

    let popoverWasOpen = false
    if (popoverState.peek()) {
      popoverState.value = null
      popoverWasOpen = true
    }

    if (mouseY < RULER_HEIGHT) {
      const rulerHit = hitTestTimelineRulerControls(mouseX, mouseY)
      if (rulerHit === 'granularity') {
        const next = nextTimelineGranularity(granularity.peek())
        granularity.value = next
        pxPerDay.value = TIMELINE_GRANULARITY_PX_PER_DAY[next]
        return
      }
      if (rulerHit === 'today') {
        const r = cachedRectRef.current ?? canvas.getBoundingClientRect()
        const chartWidth = r.width - LABEL_SIDEBAR_WIDTH
        const { originDate: o, pxPerDay: ppd } = renderStateRef.current
        scrollX.value = dateToX(new Date(), o, ppd) - chartWidth / 2
        return
      }
      return
    }

    const hit = hitTestAction(
      mouseX,
      mouseY,
      rowsRef.current,
      layoutRef.current,
      renderStateRef.current,
      rowOffsetsRef.current,
    )

    if (!hit) {
      if (mouseX < LABEL_SIDEBAR_WIDTH) return
      if (popoverWasOpen) return
      const { originDate: o, pxPerDay: ppd, scrollX: sx } = renderStateRef.current
      const chartX = mouseX - LABEL_SIDEBAR_WIDTH + sx
      const clickDate = snapToDay(xToDate(chartX, o, ppd))
      const offsets = rowOffsetsRef.current
      let rowActionType = ACTION_TYPES[0]!
      for (let i = 0; i < offsets.length - 1; i++) {
        if (mouseY >= offsets[i]! && mouseY < offsets[i + 1]!) {
          rowActionType = ACTION_TYPES[i] ?? ACTION_TYPES[0]!
          break
        }
      }
      pendingClick.current = {
        clientX: event.clientX,
        clientY: event.clientY,
        popover: {
          type: 'add',
          anchorX: event.clientX,
          anchorY: event.clientY,
          actionType: rowActionType,
          date: toISODate(clickDate),
        },
      }
      dragState.current = createTimelinePanDrag({
        startMouseX: event.clientX,
        startScrollX: scrollX.peek(),
        cachedRect: rect,
      })
      return
    }

    onSelectRef.current(hit.action.id)
    setTimelineSelectedPanelTargets(hit.action.targets)

    if (!hit.action.startDate) return

    if (hit.edge === 'left' || hit.edge === 'right') {
      const freeze = createTimelineOriginFreeze(computedOriginMsRef.current)
      dragOriginMsRef.current = freeze.originMs
      dragOriginDateRef.current = freeze.originDate
      lastDragClientXRef.current = event.clientX
      stopAutoScroll()
      autoScrollAccumRef.current = 0
      dragState.current = createTimelineResizeDrag({
        hit,
        startMouseX: event.clientX,
        cachedRect: rect,
        pxPerDaySnapshot: pxPerDay.peek(),
      })
      document.body.style.cursor = 'ew-resize'
      return
    }

    pendingClick.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      popover: {
        type: 'edit',
        anchorX: event.clientX,
        anchorY: event.clientY,
        actionId: hit.action.id,
      },
    }

    const freeze = createTimelineOriginFreeze(computedOriginMsRef.current)
    dragOriginMsRef.current = freeze.originMs
    dragOriginDateRef.current = freeze.originDate
    lastDragClientXRef.current = event.clientX
    stopAutoScroll()
    autoScrollAccumRef.current = 0
    dragState.current = createTimelineMoveDrag({
      hit,
      startMouseX: event.clientX,
      cachedRect: rect,
      pxPerDaySnapshot: pxPerDay.peek(),
    })
  }, [canvasRef, granularity, popoverState, pxPerDay, scrollX, stopAutoScroll])

  const handleMouseMove = useCallback((event: MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const drag = dragState.current
    const rect = drag?.cachedRect ?? (cachedRectRef.current ??= canvas.getBoundingClientRect())
    const mouseX = event.clientX - rect.left
    const mouseY = event.clientY - rect.top

    if (drag && tooltipState.peek()) tooltipState.value = null

    if (drag?.type === 'pan') {
      if (document.body.style.cursor !== 'grabbing') document.body.style.cursor = 'grabbing'
      const newScrollX = updateTimelinePanScrollX(drag, event.clientX)
      if (scrollX.peek() !== newScrollX) scrollX.value = newScrollX
      return
    }

    if (isTimelineEditDrag(drag)) {
      lastDragClientXRef.current = event.clientX
      const autoScrollPx = autoScrollAccumRef.current
      applyTimelineEditDragDelta(drag, event.clientX - drag.startMouseX + autoScrollPx)
      updateAutoScroll(mouseX, drag.cachedRect.width)
      return
    }

    const hit = hitTestAction(
      mouseX,
      mouseY,
      rowsRef.current,
      layoutRef.current,
      renderStateRef.current,
      rowOffsetsRef.current,
    )

    if (hit) {
      if (hoveredId.value !== hit.action.id) hoveredId.value = hit.action.id
      setTimelineHoveredPanelTargets(hit.action.targets)
      if (!popoverState.peek()) {
        tooltipState.value = { x: mouseX, y: mouseY, action: hit.action }
      }
    } else {
      if (hoveredId.value !== null) hoveredId.value = null
      clearTimelineHoveredPanelTargets()
      if (tooltipState.peek()) tooltipState.value = null
    }
    const newCursor = hit
      ? (hit.edge === 'left' || hit.edge === 'right' ? 'ew-resize' : 'grab')
      : mouseY < RULER_HEIGHT ? 'default' : 'crosshair'
    if (canvas.style.cursor !== newCursor) canvas.style.cursor = newCursor
  }, [canvasRef, hoveredId, popoverState, scrollX, tooltipState, updateAutoScroll])

  const handleMouseLeave = useCallback(() => {
    if (hoveredId.value !== null) hoveredId.value = null
    if (tooltipState.peek()) tooltipState.value = null
    clearTimelineHoveredPanelTargets()
    if (canvasRef.current) canvasRef.current.style.cursor = 'default'
  }, [canvasRef, hoveredId, tooltipState])

  const handleCanvasMouseMove = useCallback((event: MouseEvent) => {
    if (!dragState.current) handleMouseMove(event)
  }, [handleMouseMove])

  const handleMouseUp = useCallback((event: MouseEvent) => {
    stopAutoScroll()
    const drag = dragState.current
    commitTimelineDrag(drag)
    if (drag?.type === 'resize' || drag?.type === 'pan') document.body.style.cursor = ''

    const frozenMs = dragOriginMsRef.current
    if (frozenMs != null) {
      const realMs = computedOriginMsRef.current
      dragOriginMsRef.current = null
      dragOriginDateRef.current = null
      scrollX.value = restoreTimelineOriginScroll({
        frozenOriginMs: frozenMs,
        realOriginMs: realMs,
        scrollX: scrollX.peek(),
        pxPerDay: pxPerDay.peek(),
      })
    }

    dragState.current = null

    const pending = pendingClick.current
    pendingClick.current = null
    if (!pending) return
    const dx = Math.abs(event.clientX - pending.clientX)
    const dy = Math.abs(event.clientY - pending.clientY)
    if (dx + dy >= TIMELINE_CLICK_THRESHOLD) return

    popoverState.value = openTimelineActionPopover({
      pendingClick: pending.popover,
      speciesList: projectionRef.current.speciesList,
    })
  }, [popoverState, pxPerDay, scrollX, stopAutoScroll])

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (dragState.current) handleMouseMove(event)
    }
    const onUp = (event: MouseEvent) => {
      handleMouseUp(event)
    }

    const onLeave = () => {
      if (isTimelineEditDrag(dragState.current)) {
        stopAutoScroll()
      }
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.documentElement.addEventListener('mouseleave', onLeave)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.documentElement.removeEventListener('mouseleave', onLeave)
      stopAutoScroll()
      const drag = dragState.current
      commitTimelineDrag(drag)
      if (drag?.type === 'resize' || drag?.type === 'pan') document.body.style.cursor = ''
      dragState.current = null
      dragOriginMsRef.current = null
      dragOriginDateRef.current = null
      pendingClick.current = null
      clearTimelineHoveredPanelTargets()
      clearTimelineSelectedPanelTargets()
    }
  }, [handleMouseMove, handleMouseUp, stopAutoScroll])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (popoverState.peek()) return
      if (!selectedIdRef.current) return
      if (isEditableTarget(event.target)) return
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        const result = deleteSelectedTimelineAction(selectedIdRef.current)
        if (hoveredId.value !== null) hoveredId.value = null
        if ('selectedId' in result) onSelectRef.current(result.selectedId ?? null)
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
    if ('selectedId' in result) onSelectRef.current(result.selectedId ?? null)
    popoverState.value = null
  }, [popoverState])

  const handlePopoverDelete = useCallback(() => {
    const ps = popoverState.peek()
    if (!ps) return
    const result = deleteTimelineActionPopover(ps)
    if ('selectedId' in result) onSelectRef.current(result.selectedId ?? null)
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
    renderState,
    renderDeps: [
      rows,
      layout,
      rowOffsets,
      originMs,
      pxPerDay.value,
      scrollX.value,
      selectedId,
      hoveredId.value,
      locale,
      speciesColors,
      granularity.value,
    ],
    tooltip: tooltipState.value,
    popover: popoverState.value,
    invalidateLayout,
    handleContainerScroll,
    handleMouseDown,
    handleCanvasMouseMove,
    handleMouseLeave,
    handlePopoverSave,
    handlePopoverDelete,
    handlePopoverCancel,
  }
}
