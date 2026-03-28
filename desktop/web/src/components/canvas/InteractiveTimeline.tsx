import { useRef, useEffect, useCallback } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { t } from '../../i18n'
import { locale } from '../../state/app'
import { currentDesign, nonCanvasRevision } from '../../state/document'
import {
  renderTimeline,
  hitTestAction,
  groupActionsBySpecies,
  computeLayout,
  RULER_HEIGHT,
  LABEL_SIDEBAR_WIDTH,
  type TimelineRenderState,
  type SpeciesRow,
  type ActionLayout,
} from '../../canvas/timeline-renderer'
import { dateToX, xToDate, snapToDay, toISODate } from '../../canvas/timeline-math'
import type { TimelineAction } from '../../types/design'
import styles from './InteractiveTimeline.module.css'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ZOOM_FACTOR = 1.15
const MIN_PX_PER_DAY = 0.3
const MAX_PX_PER_DAY = 60

export type Granularity = 'week' | 'month' | 'year'

const GRANULARITY_PX_PER_DAY: Record<Granularity, number> = {
  week: 20,
  month: 5,
  year: 0.8,
}

export interface InteractiveTimelineProps {
  granularity: Granularity
  selectedId: string | null
  onSelect: (id: string | null) => void
  onEditRequest: (action: TimelineAction) => void
  /** Ref that will be populated with a scrollToToday function */
  scrollToTodayRef?: { current: (() => void) | null }
}

// ---------------------------------------------------------------------------
// Drag state types
// ---------------------------------------------------------------------------

interface DragMove {
  type: 'move'
  actionId: string
  startMouseX: number
  originalStartDate: string
  originalEndDate: string | null
  offsetDays: number // days from start_date to the click point
}

interface DragResize {
  type: 'resize'
  actionId: string
  edge: 'left' | 'right'
  startMouseX: number
  originalStartDate: string
  originalEndDate: string
}

interface DragPan {
  type: 'pan'
  startMouseX: number
  startMouseY: number
  startScrollX: number
  startScrollY: number
}

type DragState = DragMove | DragResize | DragPan | null

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function InteractiveTimeline({ granularity, selectedId, onSelect, onEditRequest, scrollToTodayRef }: InteractiveTimelineProps) {
  void locale.value

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pxPerDay = useSignal(GRANULARITY_PX_PER_DAY[granularity])
  const scrollX = useSignal(0)
  const scrollY = useSignal(0)
  const hoveredId = useSignal<string | null>(null)
  const dragState = useRef<DragState>(null)

  // Cache for layout computation
  const rowsRef = useRef<SpeciesRow[]>([])
  const layoutRef = useRef<Map<string, ActionLayout>>(new Map())

  // Sync pxPerDay when granularity changes
  useEffect(() => {
    pxPerDay.value = GRANULARITY_PX_PER_DAY[granularity]
  }, [granularity])

  const actions = currentDesign.value?.timeline ?? []
  const originDate = _computeOriginDate(actions)

  // Recompute layout
  const rows = groupActionsBySpecies(actions)
  const layout = computeLayout(rows)
  rowsRef.current = rows
  layoutRef.current = layout

  const renderState: TimelineRenderState = {
    originDate,
    pxPerDay: pxPerDay.value,
    scrollX: scrollX.value,
    selectedId,
    hoveredId: hoveredId.value,
  }

  // ---- Drawing ------------------------------------------------------------

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return

    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    renderTimeline(
      ctx,
      rect.width,
      rect.height,
      rowsRef.current,
      layoutRef.current,
      renderState,
      scrollY.value,
    )
  }, [renderState, scrollY.value])

  // Redraw whenever renderState or scrollY changes
  useEffect(() => {
    redraw()
  }, [redraw])

  // ResizeObserver — only needs to be set up once (redraw is stable enough via ref)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const observer = new ResizeObserver(() => redraw())
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [redraw])

  // ---- Scroll / Zoom -------------------------------------------------------

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()

    if (e.ctrlKey || e.metaKey) {
      // Zoom — centered on cursor
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left - LABEL_SIDEBAR_WIDTH

      const oldPxPerDay = pxPerDay.value
      const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR
      const newPxPerDay = Math.min(MAX_PX_PER_DAY, Math.max(MIN_PX_PER_DAY, oldPxPerDay * factor))

      // Keep point under cursor fixed
      const worldXUnderCursor = (scrollX.value + mx) / oldPxPerDay
      scrollX.value = worldXUnderCursor * newPxPerDay - mx

      pxPerDay.value = newPxPerDay
    } else {
      // Pan
      scrollX.value += e.deltaX || e.deltaY
      if (e.shiftKey) {
        scrollY.value = Math.max(0, scrollY.value + e.deltaY)
      }
    }
  }, [])

  // ---- Mouse interactions ---------------------------------------------------

  const handleMouseDown = useCallback((e: MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    // Middle-click pan
    if (e.button === 1) {
      e.preventDefault()
      dragState.current = {
        type: 'pan',
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startScrollX: scrollX.value,
        startScrollY: scrollY.value,
      }
      return
    }

    // Left-click
    if (e.button !== 0) return

    const hit = hitTestAction(
      mx, my,
      rowsRef.current,
      layoutRef.current,
      renderState,
      scrollY.value,
    )

    if (hit) {
      onSelect(hit.action.id)

      // Double-click to edit
      if (e.detail === 2) {
        onEditRequest(hit.action)
        return
      }

      const action = hit.action
      if (!action.start_date) return

      if (hit.edge === 'left' || hit.edge === 'right') {
        // Start resize drag
        const endDate = action.end_date ?? toISODate(
          new Date(new Date(action.start_date).getTime() + 86400000)
        )
        dragState.current = {
          type: 'resize',
          actionId: action.id,
          edge: hit.edge,
          startMouseX: e.clientX,
          originalStartDate: action.start_date,
          originalEndDate: endDate,
        }
      } else {
        // Start move drag
        const startMs = new Date(action.start_date).getTime()
        // How many days from action start to the click position?
        const clickDate = xToDate(
          (mx - LABEL_SIDEBAR_WIDTH + scrollX.value),
          originDate,
          pxPerDay.value,
        )
        const offsetDays = (clickDate.getTime() - startMs) / 86400000

        dragState.current = {
          type: 'move',
          actionId: action.id,
          startMouseX: e.clientX,
          originalStartDate: action.start_date,
          originalEndDate: action.end_date,
          offsetDays,
        }
      }
    } else {
      onSelect(null)
    }
  }, [renderState, scrollY.value, originDate, onSelect, onEditRequest])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    const drag = dragState.current

    if (drag?.type === 'pan') {
      scrollX.value = drag.startScrollX - (e.clientX - drag.startMouseX)
      scrollY.value = Math.max(0, drag.startScrollY - (e.clientY - drag.startMouseY))
      return
    }

    if (drag?.type === 'move') {
      // Compute new start date from mouse position
      const dayDelta = (e.clientX - drag.startMouseX) / pxPerDay.value
      const origStart = new Date(drag.originalStartDate)
      const newStart = snapToDay(new Date(origStart.getTime() + dayDelta * 86400000))

      let newEnd: string | null = null
      if (drag.originalEndDate) {
        const origEnd = new Date(drag.originalEndDate)
        const durationMs = origEnd.getTime() - origStart.getTime()
        newEnd = toISODate(new Date(newStart.getTime() + durationMs))
      }

      _updateAction(drag.actionId, {
        start_date: toISODate(newStart),
        end_date: newEnd,
      })
      return
    }

    if (drag?.type === 'resize') {
      const dayDelta = (e.clientX - drag.startMouseX) / pxPerDay.value

      if (drag.edge === 'right') {
        const origEnd = new Date(drag.originalEndDate)
        const newEnd = snapToDay(new Date(origEnd.getTime() + dayDelta * 86400000))
        // Don't allow end before start
        const startMs = new Date(drag.originalStartDate).getTime()
        if (newEnd.getTime() <= startMs) return
        _updateAction(drag.actionId, { end_date: toISODate(newEnd) })
      } else {
        const origStart = new Date(drag.originalStartDate)
        const newStart = snapToDay(new Date(origStart.getTime() + dayDelta * 86400000))
        // Don't allow start after end
        const endMs = new Date(drag.originalEndDate).getTime()
        if (newStart.getTime() >= endMs) return
        _updateAction(drag.actionId, { start_date: toISODate(newStart) })
      }
      return
    }

    // No active drag — update cursor and hover state
    const hit = hitTestAction(
      mx, my,
      rowsRef.current,
      layoutRef.current,
      renderState,
      scrollY.value,
    )

    if (hit) {
      hoveredId.value = hit.action.id
      if (hit.edge === 'left' || hit.edge === 'right') {
        canvas.style.cursor = 'ew-resize'
      } else {
        canvas.style.cursor = 'grab'
      }
    } else {
      hoveredId.value = null
      canvas.style.cursor = my < RULER_HEIGHT ? 'default' : 'crosshair'
    }
  }, [renderState, scrollY.value])

  const handleMouseUp = useCallback(() => {
    const drag = dragState.current
    if (drag && drag.type !== 'pan') {
      // Commit the change — already live-updated via _updateAction
      nonCanvasRevision.value++
    }
    dragState.current = null
  }, [])

  // Global mouse listeners for drag continuation outside canvas
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragState.current) handleMouseMove(e)
    }
    const onUp = () => {
      if (dragState.current) handleMouseUp()
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [handleMouseMove, handleMouseUp])

  // ---- Keyboard -------------------------------------------------------------

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!selectedId) return

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        _deleteAction(selectedId)
        onSelect(null)
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [selectedId, onSelect])

  // ---- Scroll to today (exposed via ref) ------------------------------------

  useEffect(() => {
    if (scrollToTodayRef) {
      scrollToTodayRef.current = () => {
        const todayX = dateToX(new Date(), originDate, pxPerDay.value)
        const canvas = canvasRef.current
        if (!canvas) return
        const rect = canvas.getBoundingClientRect()
        const chartWidth = rect.width - LABEL_SIDEBAR_WIDTH
        scrollX.value = todayX - chartWidth / 2
      }
    }
    return () => {
      if (scrollToTodayRef) scrollToTodayRef.current = null
    }
  })

  return (
    <canvas
      ref={canvasRef}
      className={styles.timeline}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      aria-label={t('canvas.timeline.title')}
    />
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _computeOriginDate(actions: TimelineAction[]): Date {
  let earliest = new Date()
  for (const a of actions) {
    if (a.start_date) {
      const d = new Date(a.start_date)
      if (d < earliest) earliest = d
    }
  }
  // Pad 30 days before earliest
  return new Date(earliest.getTime() - 30 * 86400000)
}

/** Update a single action in-place via currentDesign mutation. */
function _updateAction(actionId: string, patch: Partial<TimelineAction>) {
  const design = currentDesign.value
  if (!design) return

  currentDesign.value = {
    ...design,
    timeline: design.timeline.map((a) =>
      a.id === actionId ? { ...a, ...patch } : a
    ),
  }
  // Note: nonCanvasRevision is NOT incremented here — only on mouseUp (commit)
}

/** Delete an action from the design. */
function _deleteAction(actionId: string) {
  const design = currentDesign.value
  if (!design) return

  currentDesign.value = {
    ...design,
    timeline: design.timeline.filter((a) => a.id !== actionId),
  }
  nonCanvasRevision.value++
}

