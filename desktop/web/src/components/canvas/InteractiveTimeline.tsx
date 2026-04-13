import { createPortal } from 'preact/compat'
import { useCallback, useEffect, useMemo, useRef } from 'preact/hooks'
import { useCanvasRenderer } from './useCanvasRenderer'
import { useSignal, useSignalEffect } from '@preact/signals'
import { t } from '../../i18n'
import { locale, theme } from '../../app/shell/state'
import { plantSpeciesColors } from '../../state/canvas'
import { currentDesign } from '../../state/document'
import { currentCanvasSession } from '../../canvas/session'
import {
  clearHoveredPanelTargets,
  clearSelectedPanelTargetsForOrigin,
  setHoveredPanelTargets,
  setSelectedPanelTargets,
} from '../../app/panel-targets/coordinator'
import {
  addTimelineAction,
  deleteTimelineAction,
  updateTimelineAction,
} from '../../state/timeline-actions'
import { isEditableTarget } from '../../canvas/runtime/interaction/pointer-utils'
import { markDocumentDirty } from '../../state/document-mutations'
import {
  ACTION_TYPES,
  LABEL_SIDEBAR_WIDTH,
  RULER_HEIGHT,
  rulerControlBounds,
  computeLayout,
  computeTimelineRowOffsets,
  groupActionsByType,
  hitTestAction,
  renderTimeline,
  type ActionLayout,
  type ActionTypeRow,
  type TimelineRenderState,
} from '../../canvas/timeline-renderer'
import { dateToX, snapToDay, toISODate, xToDate } from '../../canvas/timeline-math'
import { MANUAL_TARGET, getTimelineHoverTargets, speciesTarget } from '../../panel-targets'
import type { PanelTarget, TimelineAction } from '../../types/design'
import { TimelinePopover, type PopoverFormData } from './TimelinePopover'
import styles from './InteractiveTimeline.module.css'

export type Granularity = 'month' | 'year'

const GRANULARITY_PX_PER_DAY: Record<Granularity, number> = {
  month: 5,
  year: 0.8,
}

// Must match pillY / pillH in timeline-renderer.ts ruler controls
const RULER_BTN_Y = (28 - 18) / 2  // (RULER_HEIGHT - pillH) / 2 = 5
const RULER_BTN_H = 18
const CLICK_THRESHOLD = 3
const AUTO_SCROLL_EDGE_ZONE = 60
const AUTO_SCROLL_MIN_SPEED = 1
const AUTO_SCROLL_MAX_SPEED = 15

function computeAutoScrollSpeed(mouseX: number, chartWidth: number): number {
  const leftEdge = LABEL_SIDEBAR_WIDTH
  if (mouseX < leftEdge + AUTO_SCROLL_EDGE_ZONE) {
    const depth = leftEdge + AUTO_SCROLL_EDGE_ZONE - mouseX
    const ratio = Math.min(depth / AUTO_SCROLL_EDGE_ZONE, 1)
    return -(AUTO_SCROLL_MIN_SPEED + (AUTO_SCROLL_MAX_SPEED - AUTO_SCROLL_MIN_SPEED) * ratio * ratio)
  }
  if (mouseX > chartWidth - AUTO_SCROLL_EDGE_ZONE) {
    const depth = mouseX - (chartWidth - AUTO_SCROLL_EDGE_ZONE)
    const ratio = Math.min(depth / AUTO_SCROLL_EDGE_ZONE, 1)
    return AUTO_SCROLL_MIN_SPEED + (AUTO_SCROLL_MAX_SPEED - AUTO_SCROLL_MIN_SPEED) * ratio * ratio
  }
  return 0
}

function hitTestRulerControls(x: number, y: number): 'granularity' | 'today' | null {
  if (y < RULER_BTN_Y || y > RULER_BTN_Y + RULER_BTN_H) return null
  const { mo, yr, today } = rulerControlBounds
  if (x >= mo.x && x <= mo.x + mo.w) return 'granularity'
  if (x >= yr.x && x <= yr.x + yr.w) return 'granularity'
  if (x >= today.x && x <= today.x + today.w) return 'today'
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
      startScrollX: number
      cachedRect: DOMRect
    }
  | null

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
  action?: TimelineAction
  actionType?: string
  date?: string
}

const EMPTY_ACTIONS: TimelineAction[] = []
const EMPTY_PANEL_TARGETS: readonly PanelTarget[] = []

function setTimelineHoveredPanelTargets(targets: readonly PanelTarget[]): void {
  setHoveredPanelTargets(targets)
}

function setTimelineSelectedPanelTargets(targets: readonly PanelTarget[]): void {
  setSelectedPanelTargets('timeline', targets)
}

export function clearTimelineSelectedPanelTargets(): void {
  clearSelectedPanelTargetsForOrigin('timeline')
}

function buildSpeciesList(): Array<{ canonical_name: string; display_name: string }> {
  const session = currentCanvasSession.value
  if (!session) return []
  const plants = session.getPlacedPlants()
  const names = session.getLocalizedCommonNames()
  const seen = new Set<string>()
  const result: Array<{ canonical_name: string; display_name: string }> = []
  for (const plant of plants) {
    if (seen.has(plant.canonical_name)) continue
    seen.add(plant.canonical_name)
    result.push({
      canonical_name: plant.canonical_name,
      display_name: names.get(plant.canonical_name) ?? plant.canonical_name,
    })
  }
  result.sort((a, b) => a.display_name.localeCompare(b.display_name))
  return result
}

export function InteractiveTimeline({
  selectedId,
  onSelect,
}: InteractiveTimelineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const cachedRectRef = useRef<DOMRect | null>(null)
  const granularity = useSignal<Granularity>('month')
  const pxPerDay = useSignal(GRANULARITY_PX_PER_DAY.month)
  const scrollX = useSignal(0)
  const hoveredId = useSignal<string | null>(null)
  const tooltipState = useSignal<{ x: number; y: number; action: TimelineAction } | null>(null)
  const popoverState = useSignal<PopoverState | null>(null)
  const dragState = useRef<DragState>(null)
  const pendingClick = useRef<PendingClick | null>(null)
  const rowsRef = useRef<ActionTypeRow[]>([])
  const layoutRef = useRef<Map<string, ActionLayout>>(new Map())
  const lastDragDates = useRef<{ start: string; end: string | null }>({ start: '', end: null })
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
    clearHoveredPanelTargets()
  })

  const renderStateRef = useRef<TimelineRenderState>(null!)
  renderStateRef.current = {
    originDate: dragOriginDateRef.current ?? originDate,
    pxPerDay: pxPerDay.value,
    scrollX: scrollX.value,
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
  }, [actions, originMs, pxPerDay.value, scrollX.value, selectedId, hoveredId.value, locale.value, theme.value, speciesColors, granularity.value], cachedRectRef)

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

  function applyDragDelta(drag: NonNullable<DragState> & { type: 'move' | 'resize' }, totalPxDelta: number): void {
    const dayDelta = totalPxDelta / drag.pxPerDaySnapshot
    const deltaMs = dayDelta * 86400000

    if (drag.type === 'move') {
      const start = snapToDay(new Date(drag.originalStartMs + deltaMs))
      const startStr = toISODate(start)
      const endDate = drag.durationMs != null
        ? toISODate(new Date(start.getTime() + drag.durationMs))
        : null
      if (startStr === lastDragDates.current.start && endDate === lastDragDates.current.end) return
      lastDragDates.current = { start: startStr, end: endDate }
      updateTimelineAction(drag.actionId, { start_date: startStr, end_date: endDate }, { markDirty: false })
    } else if (drag.edge === 'left') {
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
  }

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
    if (!drag || (drag.type !== 'move' && drag.type !== 'resize')) {
      stopAutoScroll()
      return
    }
    const mouseX = lastDragClientXRef.current - drag.cachedRect.left
    const speed = computeAutoScrollSpeed(mouseX, drag.cachedRect.width)
    if (speed === 0) {
      stopAutoScroll()
      return
    }
    scrollX.value = scrollX.peek() + speed
    autoScrollAccumRef.current += speed
    applyDragDelta(drag, lastDragClientXRef.current - drag.startMouseX + autoScrollAccumRef.current)
    autoScrollRafRef.current = requestAnimationFrame(autoScrollTick)
  }

  function updateAutoScroll(mouseX: number, chartWidth: number): void {
    const speed = computeAutoScrollSpeed(mouseX, chartWidth)
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
      dragState.current = {
        type: 'pan',
        startMouseX: event.clientX,
        startScrollX: scrollX.peek(),
        cachedRect: rect,
      }
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
      const rulerHit = hitTestRulerControls(mouseX, mouseY)
      if (rulerHit === 'granularity') {
        const next: Granularity = granularity.peek() === 'month' ? 'year' : 'month'
        granularity.value = next
        pxPerDay.value = GRANULARITY_PX_PER_DAY[next]
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
      dragState.current = {
        type: 'pan',
        startMouseX: event.clientX,
        startScrollX: scrollX.peek(),
        cachedRect: rect,
      }
      return
    }

    onSelectRef.current(hit.action.id)
    setTimelineSelectedPanelTargets(getTimelineHoverTargets(hit.action))

    if (!hit.action.start_date) return

    const startMs = new Date(hit.action.start_date).getTime()
    const endMs = hit.action.end_date ? new Date(hit.action.end_date).getTime() : null

    if (hit.edge === 'left' || hit.edge === 'right') {
      dragOriginMsRef.current = computedOriginMsRef.current
      dragOriginDateRef.current = new Date(computedOriginMsRef.current)
      lastDragClientXRef.current = event.clientX
      stopAutoScroll()
      autoScrollAccumRef.current = 0
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

    // Body hit - prepare edit popover (opens on mouseup if no drag)
    pendingClick.current = {
      type: 'edit',
      clientX: event.clientX,
      clientY: event.clientY,
      anchorX: event.clientX,
      anchorY: event.clientY,
      actionId: hit.action.id,
      action: hit.action,
    }

    const durationMs = endMs != null ? endMs - startMs : null
    dragOriginMsRef.current = computedOriginMsRef.current
    dragOriginDateRef.current = new Date(computedOriginMsRef.current)
    lastDragClientXRef.current = event.clientX
    stopAutoScroll()
    autoScrollAccumRef.current = 0
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

    // Clear tooltip during any drag
    if (drag && tooltipState.peek()) tooltipState.value = null

    if (drag?.type === 'pan') {
      if (document.body.style.cursor !== 'grabbing') document.body.style.cursor = 'grabbing'
      const newScrollX = drag.startScrollX - (event.clientX - drag.startMouseX)
      if (scrollX.peek() !== newScrollX) scrollX.value = newScrollX
      return
    }

    if (drag?.type === 'move' || drag?.type === 'resize') {
      lastDragClientXRef.current = event.clientX
      const autoScrollPx = autoScrollAccumRef.current
      applyDragDelta(drag, event.clientX - drag.startMouseX + autoScrollPx)
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
      setTimelineHoveredPanelTargets(getTimelineHoverTargets(hit.action))
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
    if (drag && (drag.type === 'move' || drag.type === 'resize') && drag.hasMutated) {
      markDocumentDirty()
    }
    if (drag?.type === 'resize' || drag?.type === 'pan') document.body.style.cursor = ''

    // Unfreeze coordinate origin and compensate scrollX to prevent visual jump
    const frozenMs = dragOriginMsRef.current
    if (frozenMs != null) {
      const realMs = computedOriginMsRef.current
      dragOriginMsRef.current = null
      dragOriginDateRef.current = null
      if (frozenMs !== realMs) {
        const deltaDays = (frozenMs - realMs) / 86400000
        scrollX.value = scrollX.peek() + deltaDays * pxPerDay.peek()
      }
    }

    dragState.current = null
    lastDragDates.current = { start: '', end: null }

    // Check pending click for popover opening
    const pending = pendingClick.current
    pendingClick.current = null
    if (!pending) return
    const dx = Math.abs(event.clientX - pending.clientX)
    const dy = Math.abs(event.clientY - pending.clientY)
    if (dx + dy >= CLICK_THRESHOLD) return

    const sl = buildSpeciesList()

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
        speciesList: sl,
      }
    } else if (pending.type === 'edit' && pending.actionId) {
      // Read live action from document (may have moved during sub-threshold drag)
      const a = (currentDesign.peek()?.timeline ?? EMPTY_ACTIONS).find((act) => act.id === pending.actionId)
      if (!a) return
      const existingSpecies = a.targets.find((tgt) => tgt.kind === 'species')
      popoverState.value = {
        mode: 'edit',
        anchorX: pending.anchorX,
        anchorY: pending.anchorY,
        actionId: pending.actionId,
        formData: {
          action_type: a.action_type,
          start_date: a.start_date ?? '',
          end_date: a.end_date ?? '',
          description: a.description,
          species_canonical: existingSpecies?.kind === 'species' ? existingSpecies.canonical_name : null,
        },
        speciesList: sl,
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
      if (dragState.current?.type === 'move' || dragState.current?.type === 'resize') {
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
      if (drag && (drag.type === 'move' || drag.type === 'resize') && drag.hasMutated) {
        markDocumentDirty()
      }
      if (drag?.type === 'resize' || drag?.type === 'pan') document.body.style.cursor = ''
      dragState.current = null
      dragOriginMsRef.current = null
      dragOriginDateRef.current = null
      lastDragDates.current = { start: '', end: null }
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

    const targets = data.species_canonical
      ? [speciesTarget(data.species_canonical)]
      : [MANUAL_TARGET]

    if (ps.mode === 'add') {
      const id = crypto.randomUUID()
      addTimelineAction({
        id,
        action_type: data.action_type,
        description: data.description,
        start_date: data.start_date || null,
        end_date: data.end_date || null,
        recurrence: null,
        targets,
        depends_on: null,
        completed: false,
      })
      onSelectRef.current(id)
    } else if (ps.actionId) {
      updateTimelineAction(ps.actionId, {
        action_type: data.action_type,
        description: data.description,
        start_date: data.start_date || null,
        end_date: data.end_date || null,
        targets,
      })
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
          <div className={styles.tooltipType}>{t(`canvas.timeline.type_${tip.action.action_type}`)}</div>
          {tip.action.start_date && (
            <div className={styles.tooltipDates}>
              {tip.action.start_date}{tip.action.end_date ? ` - ${tip.action.end_date}` : ''}
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

function computeOriginMs(actions: TimelineAction[], fallbackMs: number): number {
  let earliest = Infinity
  for (const action of actions) {
    if (!action.start_date) continue
    const ms = new Date(action.start_date).getTime()
    if (ms < earliest) earliest = ms
  }
  return (isFinite(earliest) ? earliest : fallbackMs) - 30 * 86400000
}
