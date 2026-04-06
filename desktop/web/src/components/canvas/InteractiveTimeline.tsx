import { useCallback, useEffect, useRef } from 'preact/hooks'
import { useCanvasRenderer } from './useCanvasRenderer'
import { useSignal } from '@preact/signals'
import { t } from '../../i18n'
import { locale } from '../../state/app'
import { currentDesign } from '../../state/document'
import {
  deleteTimelineAction,
  updateTimelineAction,
} from '../../state/timeline-actions'
import { markDocumentDirty } from '../../state/document-mutations'
import {
  LABEL_SIDEBAR_WIDTH,
  RULER_HEIGHT,
  computeLayout,
  groupActionsBySpecies,
  hitTestAction,
  renderTimeline,
  type ActionLayout,
  type SpeciesRow,
  type TimelineRenderState,
} from '../../canvas/timeline-renderer'
import { dateToX, snapToDay, toISODate } from '../../canvas/timeline-math'
import type { TimelineAction } from '../../types/design'
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
      originalStartDate: string
      originalEndDate: string | null
    }
  | {
      type: 'pan'
      startMouseX: number
      startMouseY: number
      startScrollX: number
      startScrollY: number
    }
  | null

export function InteractiveTimeline({
  granularity,
  selectedId,
  onSelect,
  onEditRequest,
  scrollToTodayRef,
}: InteractiveTimelineProps) {
  void locale.value

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pxPerDay = useSignal(GRANULARITY_PX_PER_DAY[granularity])
  const scrollX = useSignal(0)
  const scrollY = useSignal(0)
  const hoveredId = useSignal<string | null>(null)
  const dragState = useRef<DragState>(null)
  const rowsRef = useRef<SpeciesRow[]>([])
  const layoutRef = useRef<Map<string, ActionLayout>>(new Map())

  useEffect(() => {
    pxPerDay.value = GRANULARITY_PX_PER_DAY[granularity]
  }, [granularity])

  const actions = currentDesign.value?.timeline ?? []
  const originDate = computeOriginDate(actions)

  rowsRef.current = groupActionsBySpecies(actions)
  layoutRef.current = computeLayout(rowsRef.current)

  const renderState: TimelineRenderState = {
    originDate,
    pxPerDay: pxPerDay.value,
    scrollX: scrollX.value,
    selectedId,
    hoveredId: hoveredId.value,
  }

  useCanvasRenderer(canvasRef, (ctx, width, height) => {
    renderTimeline(
      ctx,
      width,
      height,
      rowsRef.current,
      layoutRef.current,
      renderState,
      scrollY.value,
    )
  }, [renderState, scrollY.value])

  const handleWheel = useCallback((event: WheelEvent) => {
    event.preventDefault()

    scrollX.value += event.deltaX || event.deltaY
    if (event.shiftKey) {
      scrollY.value = Math.max(0, scrollY.value + event.deltaY)
    }
  }, [])

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
        startScrollX: scrollX.value,
        startScrollY: scrollY.value,
      }
      return
    }

    if (event.button !== 0) return

    const hit = hitTestAction(
      mouseX,
      mouseY,
      rowsRef.current,
      layoutRef.current,
      renderState,
      scrollY.value,
    )

    if (!hit) {
      onSelect(null)
      return
    }

    onSelect(hit.action.id)

    if (event.detail === 2) {
      onEditRequest(hit.action)
      return
    }

    if (!hit.action.start_date) return

    dragState.current = {
      type: 'move',
      actionId: hit.action.id,
      startMouseX: event.clientX,
      originalStartDate: hit.action.start_date,
      originalEndDate: hit.action.end_date,
    }
  }, [renderState, scrollY.value, onEditRequest, onSelect])

  const handleMouseMove = useCallback((event: MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const mouseX = event.clientX - rect.left
    const mouseY = event.clientY - rect.top
    const drag = dragState.current

    if (drag?.type === 'pan') {
      scrollX.value = drag.startScrollX - (event.clientX - drag.startMouseX)
      scrollY.value = Math.max(0, drag.startScrollY - (event.clientY - drag.startMouseY))
      return
    }

    if (drag?.type === 'move') {
      const dayDelta = (event.clientX - drag.startMouseX) / pxPerDay.value
      const start = snapToDay(new Date(new Date(drag.originalStartDate).getTime() + dayDelta * 86400000))
      let endDate: string | null = null
      if (drag.originalEndDate) {
        const duration = new Date(drag.originalEndDate).getTime() - new Date(drag.originalStartDate).getTime()
        endDate = toISODate(new Date(start.getTime() + duration))
      }
      updateTimelineAction(
        drag.actionId,
        { start_date: toISODate(start), end_date: endDate },
        { markDirty: false },
      )
      return
    }

    const hit = hitTestAction(
      mouseX,
      mouseY,
      rowsRef.current,
      layoutRef.current,
      renderState,
      scrollY.value,
    )

    if (hit) {
      hoveredId.value = hit.action.id
      canvas.style.cursor = 'grab'
    } else {
      hoveredId.value = null
      canvas.style.cursor = mouseY < RULER_HEIGHT ? 'default' : 'crosshair'
    }
  }, [renderState, scrollY.value])

  const handleMouseUp = useCallback(() => {
    const drag = dragState.current
    if (drag && drag.type !== 'pan') {
      markDocumentDirty()
    }
    dragState.current = null
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
    }
  }, [handleMouseMove, handleMouseUp])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!selectedId) return
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        deleteTimelineAction(selectedId)
        onSelect(null)
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onSelect, selectedId])

  useEffect(() => {
    if (!scrollToTodayRef) return
    scrollToTodayRef.current = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const chartWidth = rect.width - LABEL_SIDEBAR_WIDTH
      scrollX.value = dateToX(new Date(), originDate, pxPerDay.value) - chartWidth / 2
    }
    return () => {
      scrollToTodayRef.current = null
    }
  }, [scrollToTodayRef, originDate])

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

function computeOriginDate(actions: TimelineAction[]): Date {
  let earliest = new Date()
  for (const action of actions) {
    if (!action.start_date) continue
    const next = new Date(action.start_date)
    if (next < earliest) earliest = next
  }
  return new Date(earliest.getTime() - 30 * 86400000)
}
