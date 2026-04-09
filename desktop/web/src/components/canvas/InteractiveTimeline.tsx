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
  RULER_BTN_MO,
  RULER_BTN_TODAY,
  RULER_BTN_YR,
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

const RULER_BTN_Y = 4
const RULER_BTN_H = 20

function hitTestRulerControls(x: number, y: number): 'granularity' | 'today' | null {
  if (y < RULER_BTN_Y || y > RULER_BTN_Y + RULER_BTN_H) return null
  if (x >= RULER_BTN_MO.x && x <= RULER_BTN_MO.x + RULER_BTN_MO.w) return 'granularity'
  if (x >= RULER_BTN_YR.x && x <= RULER_BTN_YR.x + RULER_BTN_YR.w) return 'granularity'
  if (x >= RULER_BTN_TODAY.x && x <= RULER_BTN_TODAY.x + RULER_BTN_TODAY.w) return 'today'
  return null
}

interface InteractiveTimelineProps {
  selectedId: string | null
  onSelect: (id: string | null) => void
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
      type: 'resize'
      actionId: string
      edge: 'left' | 'right'
      startMouseX: number
      originalStartMs: number
      originalEndMs: number | null
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
  selectedId,
  onSelect,
}: InteractiveTimelineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cachedRectRef = useRef<DOMRect | null>(null)
  const granularity = useSignal<Granularity>('month')
  const pxPerDay = useSignal(GRANULARITY_PX_PER_DAY.month)
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
    granularity: granularity.value,
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
  }, [originMs, pxPerDay.value, scrollX.value, selectedId, hoveredId.value, scrollY.value, locale.value, theme.value, speciesColors, granularity.value], cachedRectRef)

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

    // Ruler controls
    if (mouseY < RULER_HEIGHT) {
      const rulerHit = hitTestRulerControls(mouseX, mouseY)
      if (rulerHit === 'granularity') {
        const next: Granularity = granularity.peek() === 'month' ? 'year' : 'month'
        granularity.value = next
        pxPerDay.value = GRANULARITY_PX_PER_DAY[next]
        return
      }
      if (rulerHit === 'today') {
        const canvas = canvasRef.current
        if (canvas) {
          const r = cachedRectRef.current ?? canvas.getBoundingClientRect()
          const chartWidth = r.width - LABEL_SIDEBAR_WIDTH
          const { originDate: o, pxPerDay: ppd } = renderStateRef.current
          scrollX.value = dateToX(new Date(), o, ppd) - chartWidth / 2
        }
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
      onSelectRef.current(null)
      clearTimelineSelectedPanelTargets()
      return
    }

    onSelectRef.current(hit.action.id)
    setTimelineSelectedPanelTargets(getTimelineHoverTargets(hit.action))

    if (!hit.action.start_date) return

    const startMs = new Date(hit.action.start_date).getTime()
    const endMs = hit.action.end_date ? new Date(hit.action.end_date).getTime() : null

    if (hit.edge === 'left' || hit.edge === 'right') {
      dragState.current = {
        type: 'resize',
        actionId: hit.action.id,
        edge: hit.edge,
        startMouseX: event.clientX,
        originalStartMs: startMs,
        originalEndMs: endMs,
        pxPerDaySnapshot: pxPerDay.peek(),
        cachedRect: rect,
        hasMutated: false,
      }
      document.body.style.cursor = 'ew-resize'
      return
    }

    const durationMs = endMs != null ? endMs - startMs : null
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

    if (drag?.type === 'resize') {
      const dayDelta = (event.clientX - drag.startMouseX) / drag.pxPerDaySnapshot
      const deltaMs = dayDelta * 86400000
      if (drag.edge === 'left') {
        const newStartMs = drag.originalStartMs + deltaMs
        const maxStartMs = drag.originalEndMs != null ? drag.originalEndMs : drag.originalStartMs + 86400000
        const clampedStart = snapToDay(new Date(Math.min(newStartMs, maxStartMs)))
        const startStr = toISODate(clampedStart)
        const endStr = drag.originalEndMs != null ? toISODate(new Date(drag.originalEndMs)) : null
        if (startStr === lastDragDates.current.start && endStr === lastDragDates.current.end) return
        lastDragDates.current = { start: startStr, end: endStr }
        updateTimelineAction(drag.actionId, { start_date: startStr }, { markDirty: false })
      } else {
        const originalEnd = drag.originalEndMs ?? drag.originalStartMs + 86400000
        const newEndMs = originalEnd + deltaMs
        const clampedEnd = snapToDay(new Date(Math.max(newEndMs, drag.originalStartMs)))
        const endStr = toISODate(clampedEnd)
        const startStr = toISODate(new Date(drag.originalStartMs))
        if (startStr === lastDragDates.current.start && endStr === lastDragDates.current.end) return
        lastDragDates.current = { start: startStr, end: endStr }
        updateTimelineAction(drag.actionId, { end_date: endStr }, { markDirty: false })
      }
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
    const newCursor = hit
      ? (hit.edge === 'left' || hit.edge === 'right' ? 'ew-resize' : 'grab')
      : mouseY < RULER_HEIGHT ? 'default' : 'crosshair'
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
    if (drag && (drag.type === 'move' || drag.type === 'resize') && drag.hasMutated) {
      markDocumentDirty()
    }
    if (drag?.type === 'resize') document.body.style.cursor = ''
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
      const drag = dragState.current
      if (drag && (drag.type === 'move' || drag.type === 'resize') && drag.hasMutated) {
        markDocumentDirty()
      }
      if (drag?.type === 'resize') document.body.style.cursor = ''
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
