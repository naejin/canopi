import { createPortal } from 'preact/compat'
import { useCallback, useEffect, useMemo, useRef } from 'preact/hooks'
import { useCanvasRenderer } from './useCanvasRenderer'
import { useSignal, useSignalEffect } from '@preact/signals'
import { t } from '../../i18n'
import { locale, theme } from '../../app/settings/state'
import { plantSpeciesColorDefaults } from '../../canvas/plant-species-color-defaults'
import { currentDesign } from '../../state/design'
import {
  ACTION_TYPES,
  clearPlanningHoveredTargets,
  clearPlanningSelectedTargetsForOrigin,
  setPlanningHoveredTargets,
  setPlanningSelectedTargets,
  useTimelinePlanningProjection,
  type TimelineActionLayout,
  type TimelineActionTypeRow,
  type TimelinePlanningAction,
} from '../../app/planning-projection'
import {
  addTimelineAction,
  deleteTimelineAction,
  updateTimelineAction,
} from '../../app/timeline/controller'
import {
  createTimelineActionFromFormData,
  formDataFromTimelineAction,
  timelineActionPatchFromFormData,
} from '../../app/timeline/editing'
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
} from '../../app/timeline/interaction'
import { isEditableTarget } from '../../canvas/runtime/interaction/pointer-utils'
import {
  LABEL_SIDEBAR_WIDTH,
  RULER_HEIGHT,
  computeTimelineRowOffsets,
  hitTestAction,
  renderTimeline,
  type TimelineRenderState,
} from '../../canvas/timeline-renderer'
import { dateToX, snapToDay, toISODate, xToDate } from '../../canvas/timeline-math'
import type { PanelTarget, TimelineAction } from '../../types/design'
import { TimelinePopover, type PopoverFormData } from './TimelinePopover'
import styles from './InteractiveTimeline.module.css'

export type Granularity = TimelineGranularity

interface InteractiveTimelineProps {
  selectedId: string | null
  onSelect: (id: string | null) => void
}

interface PopoverState {
  mode: 'add' | 'edit'
  anchorX: number
  anchorY: number
  actionId?: string
  formData: PopoverFormData
  speciesList: Array<{ canonical_name: string; display_name: string }>
}

interface PendingClick {
  type: 'add' | 'edit'
  clientX: number
  clientY: number
  anchorX: number
  anchorY: number
  actionId?: string
  actionType?: string
  date?: string
}

const EMPTY_ACTIONS: TimelineAction[] = []
const EMPTY_PANEL_TARGETS: readonly PanelTarget[] = []

function setTimelineHoveredPanelTargets(targets: readonly PanelTarget[]): void {
  setPlanningHoveredTargets(targets)
}

function setTimelineSelectedPanelTargets(targets: readonly PanelTarget[]): void {
  setPlanningSelectedTargets('timeline', targets)
}

export function clearTimelineSelectedPanelTargets(): void {
  clearPlanningSelectedTargetsForOrigin('timeline')
}

export function InteractiveTimeline({
  selectedId,
  onSelect,
}: InteractiveTimelineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const cachedRectRef = useRef<DOMRect | null>(null)
  const granularity = useSignal<Granularity>('month')
  const pxPerDay = useSignal(TIMELINE_GRANULARITY_PX_PER_DAY.month)
  const scrollX = useSignal(0)
  const hoveredId = useSignal<string | null>(null)
  const tooltipState = useSignal<{ x: number; y: number; action: TimelinePlanningAction } | null>(null)
  const popoverState = useSignal<PopoverState | null>(null)
  const dragState = useRef<TimelineDragState | null>(null)
  const pendingClick = useRef<PendingClick | null>(null)
  const rowsRef = useRef<readonly TimelineActionTypeRow[]>([])
  const layoutRef = useRef<ReadonlyMap<string, TimelineActionLayout>>(new Map())
  const dragOriginMsRef = useRef<number | null>(null)
  const dragOriginDateRef = useRef<Date | null>(null)
  const computedOriginMsRef = useRef(0)
  const autoScrollRafRef = useRef<number | null>(null)
  const autoScrollAccumRef = useRef(0)
  const lastDragClientXRef = useRef(0)
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  const actions = currentDesign.value?.timeline ?? EMPTY_ACTIONS
  const speciesColors = plantSpeciesColorDefaults.value
  const todayMs = useMemo(() => Date.now(), [])
  const activeLocale = locale.value
  const projection = useTimelinePlanningProjection({
    actions,
    fallbackOriginMs: todayMs,
    locale: activeLocale,
  })
  const rows = projection.rows
  const layout = projection.layout
  const originMs = projection.originMs
  const originDate = useMemo(() => new Date(originMs), [originMs])
  const rowOffsets = useMemo(() => computeTimelineRowOffsets(rows, layout), [rows, layout])
  const projectionRef = useRef(projection)
  projectionRef.current = projection
  rowsRef.current = rows
  layoutRef.current = layout
  const rowOffsetsRef = useRef(rowOffsets)
  rowOffsetsRef.current = rowOffsets
  computedOriginMsRef.current = originMs

  // Set canvas height for native scrolling (like ConsortiumChart)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const totalHeight = rowOffsets[rowOffsets.length - 1] ?? RULER_HEIGHT
    canvas.style.height = `${totalHeight}px`
    cachedRectRef.current = null
  }, [rowOffsets])

  useSignalEffect(() => {
    const hoveredActionId = hoveredId.value
    if (!hoveredActionId) return
    const current = currentDesign.value?.timeline ?? EMPTY_ACTIONS
    if (current.some((action) => action.id === hoveredActionId)) return
    hoveredId.value = null
    clearPlanningHoveredTargets()
  })

  const renderStateRef = useRef<TimelineRenderState>(null!)
  renderStateRef.current = {
    originDate: dragOriginDateRef.current ?? originDate,
    pxPerDay: pxPerDay.value,
    scrollX: scrollX.value,
    selectedId,
    hoveredId: hoveredId.value,
    locale: activeLocale,
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
  }, [actions, originMs, pxPerDay.value, scrollX.value, selectedId, hoveredId.value, activeLocale, theme.value, speciesColors, granularity.value], cachedRectRef)

  const handleWheel = useCallback((event: WheelEvent) => {
    if (!(event.ctrlKey || event.metaKey)) return // let native scroll handle vertical
    event.preventDefault()
    const drag = dragState.current
    if (drag?.type === 'move' || drag?.type === 'resize') return
    if (popoverState.peek()) popoverState.value = null

    // Zoom: ctrl+wheel or pinch gesture
    const factor = event.deltaY > 0 ? 0.9 : 1.1
    const prev = pxPerDay.peek()
    const next = Math.max(0.2, Math.min(20, prev * factor))
    if (next !== prev) {
      // Keep the point under the cursor stationary
      const canvas = canvasRef.current
      if (canvas) {
        const rect = cachedRectRef.current ?? canvas.getBoundingClientRect()
        const mouseX = event.clientX - rect.left - LABEL_SIDEBAR_WIDTH
        const dayAtCursor = (scrollX.peek() + mouseX) / prev
        scrollX.value = dayAtCursor * next - mouseX
      }
      pxPerDay.value = next
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.addEventListener('wheel', handleWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  function stopAutoScroll(): void {
    const rafId = autoScrollRafRef.current
    if (rafId != null) {
      cancelAnimationFrame(rafId)
      autoScrollRafRef.current = null
    }
  }

  function autoScrollTick(): void {
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
    applyTimelineEditDragDelta(drag, lastDragClientXRef.current - drag.startMouseX + autoScrollAccumRef.current)
    autoScrollRafRef.current = requestAnimationFrame(autoScrollTick)
  }

  function updateAutoScroll(mouseX: number, chartWidth: number): void {
    const speed = timelineAutoScrollSpeed(mouseX, chartWidth)
    if (speed !== 0) {
      if (autoScrollRafRef.current == null) {
        autoScrollRafRef.current = requestAnimationFrame(autoScrollTick)
      }
    } else {
      stopAutoScroll()
    }
  }

  const handleContainerScroll = useCallback(() => {
    cachedRectRef.current = null
    stopAutoScroll()
    if (hoveredId.peek() !== null) hoveredId.value = null
    if (tooltipState.peek()) tooltipState.value = null
    if (popoverState.peek()) popoverState.value = null
    setTimelineHoveredPanelTargets(EMPTY_PANEL_TARGETS)
    if (canvasRef.current) canvasRef.current.style.cursor = 'default'
  }, [])

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

    // Close popover on any left click, then fall through to process the click
    let popoverWasOpen = false
    if (popoverState.peek()) {
      popoverState.value = null
      popoverWasOpen = true
    }

    // Ruler controls
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
      // Sidebar is read-only - no add popover
      if (mouseX < LABEL_SIDEBAR_WIDTH) return
      // Dismiss-only: don't reopen add popover on the same click that closed one
      if (popoverWasOpen) return
      // Click on empty chart space - prepare add popover
      const { originDate: o, pxPerDay: ppd, scrollX: sx } = renderStateRef.current
      const chartX = mouseX - LABEL_SIDEBAR_WIDTH + sx
      const clickDate = snapToDay(xToDate(chartX, o, ppd))
      // Determine action type from row
      const offsets = rowOffsetsRef.current
      const adjustedY = mouseY
      let rowActionType = ACTION_TYPES[0]!
      for (let i = 0; i < offsets.length - 1; i++) {
        if (adjustedY >= offsets[i]! && adjustedY < offsets[i + 1]!) {
          rowActionType = ACTION_TYPES[i] ?? ACTION_TYPES[0]!
          break
        }
      }
      pendingClick.current = {
        type: 'add',
        clientX: event.clientX,
        clientY: event.clientY,
        anchorX: event.clientX,
        anchorY: event.clientY,
        actionType: rowActionType,
        date: toISODate(clickDate),
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

    // Body hit - prepare edit popover (opens on mouseup if no drag)
    pendingClick.current = {
      type: 'edit',
      clientX: event.clientX,
      clientY: event.clientY,
      anchorX: event.clientX,
      anchorY: event.clientY,
      actionId: hit.action.id,
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
  }, [])

  const handleMouseMove = useCallback((event: MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const drag = dragState.current
    const rect = drag?.cachedRect ?? (cachedRectRef.current ??= canvas.getBoundingClientRect())
    const mouseX = event.clientX - rect.left
    const mouseY = event.clientY - rect.top

    // Clear tooltip during any drag
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
      setTimelineHoveredPanelTargets(EMPTY_PANEL_TARGETS)
      if (tooltipState.peek()) tooltipState.value = null
    }
    const newCursor = hit
      ? (hit.edge === 'left' || hit.edge === 'right' ? 'ew-resize' : 'grab')
      : mouseY < RULER_HEIGHT ? 'default' : 'crosshair'
    if (canvas.style.cursor !== newCursor) canvas.style.cursor = newCursor
  }, [])

  const handleMouseLeave = useCallback(() => {
    if (hoveredId.value !== null) hoveredId.value = null
    if (tooltipState.peek()) tooltipState.value = null
    setTimelineHoveredPanelTargets(EMPTY_PANEL_TARGETS)
    if (canvasRef.current) canvasRef.current.style.cursor = 'default'
  }, [])

  const handleCanvasMouseMove = useCallback((e: MouseEvent) => {
    if (!dragState.current) handleMouseMove(e)
  }, [handleMouseMove])

  const handleMouseUp = useCallback((event: MouseEvent) => {
    stopAutoScroll()
    const drag = dragState.current
    commitTimelineDrag(drag)
    if (drag?.type === 'resize' || drag?.type === 'pan') document.body.style.cursor = ''

    // Unfreeze coordinate origin and compensate scrollX to prevent visual jump
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

    // Check pending click for popover opening
    const pending = pendingClick.current
    pendingClick.current = null
    if (!pending) return
    const dx = Math.abs(event.clientX - pending.clientX)
    const dy = Math.abs(event.clientY - pending.clientY)
    if (dx + dy >= TIMELINE_CLICK_THRESHOLD) return

    const speciesList = [...projectionRef.current.speciesList]

    if (pending.type === 'add') {
      const startDate = pending.date!
      const endDate = toISODate(new Date(new Date(startDate).getTime() + 14 * 86400000))
      popoverState.value = {
        mode: 'add',
        anchorX: pending.anchorX,
        anchorY: pending.anchorY,
        formData: {
          action_type: pending.actionType!,
          start_date: startDate,
          end_date: endDate,
          description: '',
          species_canonical: null,
        },
        speciesList,
      }
    } else if (pending.type === 'edit' && pending.actionId) {
      // Read live action from document (may have moved during sub-threshold drag)
      const a = (currentDesign.peek()?.timeline ?? EMPTY_ACTIONS).find((act) => act.id === pending.actionId)
      if (!a) return
      popoverState.value = {
        mode: 'edit',
        anchorX: pending.anchorX,
        anchorY: pending.anchorY,
        actionId: pending.actionId,
        formData: formDataFromTimelineAction(a),
        speciesList,
      }
    }
  }, [])

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
      setTimelineHoveredPanelTargets(EMPTY_PANEL_TARGETS)
      clearTimelineSelectedPanelTargets()
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (popoverState.peek()) return
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

  const handlePopoverSave = useCallback((data: PopoverFormData) => {
    const ps = popoverState.peek()
    if (!ps) return

    if (ps.mode === 'add') {
      const id = crypto.randomUUID()
      addTimelineAction(createTimelineActionFromFormData(id, data))
      onSelectRef.current(id)
    } else if (ps.actionId) {
      updateTimelineAction(ps.actionId, timelineActionPatchFromFormData(data))
    }
    popoverState.value = null
  }, [])

  const handlePopoverDelete = useCallback(() => {
    const ps = popoverState.peek()
    if (!ps?.actionId) return
    deleteTimelineAction(ps.actionId)
    onSelectRef.current(null)
    clearTimelineSelectedPanelTargets()
    popoverState.value = null
  }, [])

  const handlePopoverCancel = useCallback(() => {
    popoverState.value = null
  }, [])

  const ps = popoverState.value
  const tip = tooltipState.value

  return (
    <div ref={containerRef} className={styles.container} onScroll={handleContainerScroll}>
      <canvas
        ref={canvasRef}
        className={styles.timeline}
        onMouseDown={handleMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseLeave={handleMouseLeave}
        aria-label={t('canvas.timeline.title')}
      />
      {tip && !ps && (
        <div className={styles.tooltip} style={{ left: Math.min(tip.x + 12, (containerRef.current?.clientWidth ?? 300) - 230), top: tip.y + 12 }}>
          <div className={styles.tooltipType}>{t(`canvas.timeline.type_${tip.action.actionType}`)}</div>
          {tip.action.startDate && (
            <div className={styles.tooltipDates}>
              {tip.action.startDate}{tip.action.endDate ? ` - ${tip.action.endDate}` : ''}
            </div>
          )}
          {tip.action.description && (
            <div className={styles.tooltipDesc}>
              {tip.action.description.length > 50 ? tip.action.description.slice(0, 50) + '...' : tip.action.description}
            </div>
          )}
        </div>
      )}
      {ps && createPortal(
        <TimelinePopover
          mode={ps.mode}
          anchorX={ps.anchorX}
          anchorY={ps.anchorY}
          initialData={ps.formData}
          speciesList={ps.speciesList}
          onSave={handlePopoverSave}
          onDelete={ps.mode === 'edit' ? handlePopoverDelete : undefined}
          onCancel={handlePopoverCancel}
        />,
        document.body,
      )}
    </div>
  )
}
