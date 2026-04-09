import { useCallback, useEffect, useMemo, useRef } from 'preact/hooks'
import { useCanvasRenderer } from './useCanvasRenderer'
import { useSignal } from '@preact/signals'
import { t } from '../../i18n'
import { locale, theme } from '../../state/app'
import { hoveredPanelTargets, plantSpeciesColors, selectedPanelTargetOrigin, selectedPanelTargets } from '../../state/canvas'
import { currentDesign } from '../../state/document'
import {
  deleteTimelineAction,
  updateTimelineAction,
} from '../../state/timeline-actions'
import { isEditableTarget } from '../../canvas/runtime/interaction/pointer-utils'
import { markDocumentDirty } from '../../state/document-mutations'
import {
  LABEL_SIDEBAR_WIDTH,
  RULER_HEIGHT,
  computeLayout,
  computeTimelineRowOffsets,
  groupActionsByType,
  hitTestAction,
  renderTimeline,
  type ActionLayout,
  type ActionTypeRow,
  type TimelineRenderState,
} from '../../canvas/timeline-renderer'
import { dateToX, snapToDay, toISODate } from '../../canvas/timeline-math'
import { getTimelineHoverTargets, panelTargetsEqual } from '../../panel-targets'
import type { PanelTarget, TimelineAction } from '../../types/design'
import styles from './InteractiveTimeline.module.css'

export type Granularity = 'month' | 'year'

const GRANULARITY_PX_PER_DAY: Record<Granularity, number> = {
  month: 5,
  year: 0.8,
}

interface InteractiveTimelineProps {
  granularity: Granularity
  selectedId: string | null
  onSelect: (id: string | null) => void
  onEditRequest: (action: TimelineAction) => void
  scrollToTodayRef?: { current: (() => void) | null }
}

type DragState =
  | {
      type: 'move'
      actionId: string
      startMouseX: number
      originalStartMs: number
      durationMs: number | null
      pxPerDaySnapshot: number
      cachedRect: DOMRect
      hasMutated: boolean
    }
  | {
      type: 'pan'
      startMouseX: number
      startMouseY: number
      startScrollX: number
      startScrollY: number
      cachedRect: DOMRect
    }
  | null

const EMPTY_ACTIONS: TimelineAction[] = []
const EMPTY_PANEL_TARGETS: readonly PanelTarget[] = []

function setTimelineHoveredPanelTargets(targets: readonly PanelTarget[]): void {
  if (!panelTargetsEqual(hoveredPanelTargets.peek(), targets)) {
    hoveredPanelTargets.value = targets
  }
}

function setTimelineSelectedPanelTargets(targets: readonly PanelTarget[]): void {
  if (!panelTargetsEqual(selectedPanelTargets.peek(), targets)) {
    selectedPanelTargets.value = targets
  }
  selectedPanelTargetOrigin.value = targets.length > 0 ? 'timeline' : null
}

function clearTimelineSelectedPanelTargets(): void {
  if (selectedPanelTargetOrigin.peek() !== 'timeline') return
  if (selectedPanelTargets.peek().length > 0) selectedPanelTargets.value = []
  selectedPanelTargetOrigin.value = null
}

export function InteractiveTimeline({
  granularity,
  selectedId,
  onSelect,
  onEditRequest,
  scrollToTodayRef,
}: InteractiveTimelineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cachedRectRef = useRef<DOMRect | null>(null)
  const pxPerDay = useSignal(GRANULARITY_PX_PER_DAY[granularity])
  const scrollX = useSignal(0)
  const scrollY = useSignal(0)
  const hoveredId = useSignal<string | null>(null)
  const dragState = useRef<DragState>(null)
  const rowsRef = useRef<ActionTypeRow[]>([])
  const layoutRef = useRef<Map<string, ActionLayout>>(new Map())
  const lastDragDates = useRef<{ start: string; end: string | null }>({ start: '', end: null })
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const onEditRequestRef = useRef(onEditRequest)
  onEditRequestRef.current = onEditRequest

  // Guard: only write when granularity actually changed (avoids signal write in render body)
  const nextPxPerDay = GRANULARITY_PX_PER_DAY[granularity]
  if (pxPerDay.peek() !== nextPxPerDay) pxPerDay.value = nextPxPerDay

  const actions = currentDesign.value?.timeline ?? EMPTY_ACTIONS
  const speciesColors = plantSpeciesColors.value
  const todayMs = useMemo(() => Date.now(), [])
  const originMs = useMemo(() => computeOriginMs(actions, todayMs), [actions, todayMs])
  const originDate = useMemo(() => new Date(originMs), [originMs])

  const rows = useMemo(() => groupActionsByType(actions), [actions])
  const layout = useMemo(() => computeLayout(rows), [rows])
  const rowOffsets = useMemo(() => computeTimelineRowOffsets(rows, layout), [rows, layout])
  rowsRef.current = rows
  layoutRef.current = layout
  const rowOffsetsRef = useRef(rowOffsets)
  rowOffsetsRef.current = rowOffsets

  useEffect(() => {
    const hoveredActionId = hoveredId.value
    if (!hoveredActionId) return
    if (actions.some((action) => action.id === hoveredActionId)) return
    hoveredId.value = null
    setTimelineHoveredPanelTargets(EMPTY_PANEL_TARGETS)
  }, [actions, hoveredId.value])

  const renderStateRef = useRef<TimelineRenderState>(null!)
  renderStateRef.current = {
    originDate,
    pxPerDay: pxPerDay.value,
    scrollX: scrollX.value,
    scrollY: scrollY.value,
    selectedId,
    hoveredId: hoveredId.value,
    locale: locale.value,
    speciesColors,
  }

  useCanvasRenderer(canvasRef, (ctx, width, height) => {
    renderTimeline(
      ctx,
      width,
      height,
      rowsRef.current,
      layoutRef.current,
      renderStateRef.current,
      t,
      rowOffsetsRef.current,
    )
  }, [originMs, pxPerDay.value, scrollX.value, selectedId, hoveredId.value, scrollY.value, locale.value, theme.value, speciesColors], cachedRectRef)

  const handleWheel = useCallback((event: WheelEvent) => {
    event.preventDefault()

    if (event.shiftKey) {
      scrollY.value = Math.max(0, scrollY.peek() + event.deltaY)
    } else {
      scrollX.value = scrollX.peek() + (event.deltaX || event.deltaY)
    }
  }, [])

  // Attach wheel listener imperatively with { passive: false } so preventDefault() works.
  // JSX onWheel registers as passive by default — preventDefault() silently fails.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.addEventListener('wheel', handleWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  const handleMouseDown = useCallback((event: MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const mouseX = event.clientX - rect.left
    const mouseY = event.clientY - rect.top

    if (event.button === 1) {
      event.preventDefault()
      dragState.current = {
        type: 'pan',
        startMouseX: event.clientX,
        startMouseY: event.clientY,
        startScrollX: scrollX.peek(),
        startScrollY: scrollY.peek(),
        cachedRect: rect,
      }
      return
    }

    if (event.button !== 0) return

    const hit = hitTestAction(
      mouseX,
      mouseY,
      rowsRef.current,
      layoutRef.current,
      renderStateRef.current,
      rowOffsetsRef.current,
    )

    if (!hit) {
      onSelectRef.current(null)
      clearTimelineSelectedPanelTargets()
      return
    }

    onSelectRef.current(hit.action.id)
    setTimelineSelectedPanelTargets(getTimelineHoverTargets(hit.action))

    if (event.detail === 2) {
      onEditRequestRef.current(hit.action)
      return
    }

    if (!hit.action.start_date) return

    const startMs = new Date(hit.action.start_date).getTime()
    const durationMs = hit.action.end_date
      ? new Date(hit.action.end_date).getTime() - startMs
      : null
    dragState.current = {
      type: 'move',
      actionId: hit.action.id,
      startMouseX: event.clientX,
      originalStartMs: startMs,
      durationMs,
      pxPerDaySnapshot: pxPerDay.peek(),
      cachedRect: rect,
      hasMutated: false,
    }
  }, [])

  const handleMouseMove = useCallback((event: MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const drag = dragState.current
    const rect = drag?.cachedRect ?? (cachedRectRef.current ??= canvas.getBoundingClientRect())
    const mouseX = event.clientX - rect.left
    const mouseY = event.clientY - rect.top

    if (drag?.type === 'pan') {
      const newScrollX = drag.startScrollX - (event.clientX - drag.startMouseX)
      const newScrollY = Math.max(0, drag.startScrollY - (event.clientY - drag.startMouseY))
      if (scrollX.peek() !== newScrollX) scrollX.value = newScrollX
      if (scrollY.peek() !== newScrollY) scrollY.value = newScrollY
      return
    }

    if (drag?.type === 'move') {
      const dayDelta = (event.clientX - drag.startMouseX) / drag.pxPerDaySnapshot
      const start = snapToDay(new Date(drag.originalStartMs + dayDelta * 86400000))
      const startStr = toISODate(start)
      const endDate = drag.durationMs != null
        ? toISODate(new Date(start.getTime() + drag.durationMs))
        : null
      if (startStr === lastDragDates.current.start && endDate === lastDragDates.current.end) return
      lastDragDates.current = { start: startStr, end: endDate }
      updateTimelineAction(
        drag.actionId,
        { start_date: startStr, end_date: endDate },
        { markDirty: false },
      )
      drag.hasMutated = true
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
      setTimelineHoveredPanelTargets(getTimelineHoverTargets(hit.action))
    } else {
      if (hoveredId.value !== null) hoveredId.value = null
      setTimelineHoveredPanelTargets(EMPTY_PANEL_TARGETS)
    }
    const newCursor = hit ? 'grab' : mouseY < RULER_HEIGHT ? 'default' : 'crosshair'
    if (canvas.style.cursor !== newCursor) canvas.style.cursor = newCursor
  }, [])

  const handleMouseLeave = useCallback(() => {
    if (hoveredId.value !== null) hoveredId.value = null
    setTimelineHoveredPanelTargets(EMPTY_PANEL_TARGETS)
    if (canvasRef.current) canvasRef.current.style.cursor = 'default'
  }, [])

  const handleCanvasMouseMove = useCallback((e: MouseEvent) => {
    if (!dragState.current) handleMouseMove(e)
  }, [handleMouseMove])

  const handleMouseUp = useCallback(() => {
    const drag = dragState.current
    if (drag && drag.type === 'move' && drag.hasMutated) {
      markDocumentDirty()
    }
    dragState.current = null
    lastDragDates.current = { start: '', end: null }
  }, [])

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (dragState.current) handleMouseMove(event)
    }
    const onUp = () => {
      if (dragState.current) handleMouseUp()
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      if (dragState.current?.type === 'move' && dragState.current.hasMutated) {
        markDocumentDirty()
      }
      dragState.current = null
      lastDragDates.current = { start: '', end: null }
      setTimelineHoveredPanelTargets(EMPTY_PANEL_TARGETS)
      clearTimelineSelectedPanelTargets()
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!selectedIdRef.current) return
      if (isEditableTarget(event.target)) return
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        deleteTimelineAction(selectedIdRef.current)
        if (hoveredId.value !== null) hoveredId.value = null
        setTimelineHoveredPanelTargets(EMPTY_PANEL_TARGETS)
        clearTimelineSelectedPanelTargets()
        onSelectRef.current(null)
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!scrollToTodayRef) return
    scrollToTodayRef.current = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const chartWidth = rect.width - LABEL_SIDEBAR_WIDTH
      const { originDate: o, pxPerDay: ppd } = renderStateRef.current
      scrollX.value = dateToX(new Date(), o, ppd) - chartWidth / 2
    }
    return () => {
      scrollToTodayRef.current = null
    }
  }, [scrollToTodayRef])

  return (
    <canvas
      ref={canvasRef}
      className={styles.timeline}
      onMouseDown={handleMouseDown}
      onMouseMove={handleCanvasMouseMove}
      onMouseLeave={handleMouseLeave}
      aria-label={t('canvas.timeline.title')}
    />
  )
}

function computeOriginMs(actions: TimelineAction[], fallbackMs: number): number {
  let earliest = Infinity
  for (const action of actions) {
    if (!action.start_date) continue
    const ms = new Date(action.start_date).getTime()
    if (ms < earliest) earliest = ms
  }
  return (isFinite(earliest) ? earliest : fallbackMs) - 30 * 86400000
}
