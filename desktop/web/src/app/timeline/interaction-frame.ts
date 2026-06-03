import type {
  ActionType,
  TimelineActionLayout,
  TimelineActionTypeRow,
  TimelinePlanningAction,
  TimelinePlanningProjection,
} from '../planning-projection'
import { ACTION_TYPES } from '../planning-projection'
import {
  LABEL_SIDEBAR_WIDTH,
  RULER_HEIGHT,
  hitTestAction,
  type TimelineRenderState,
} from '../../canvas/timeline-renderer'
import { dateToX, snapToDay, toISODate, xToDate } from '../../canvas/timeline-math'
import type { TimelineActionPendingClick } from './workbench'
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

interface MutableRef<T> {
  current: T
}

interface MutableDomRef<T> {
  current: T | null
}

export interface TimelineActionInteractionFrameView {
  getScrollX(): number
  setScrollX(next: number): void
  getPxPerDay(): number
  setPxPerDay(next: number): void
  getGranularity(): TimelineGranularity
  setGranularity(next: TimelineGranularity): void
}

export interface TimelineActionInteractionFramePopoverDelegate {
  isOpen(): boolean
  close(): boolean
  openPendingClick(pendingClick: TimelineActionPendingClick): void
}

export interface TimelineActionInteractionFrameSelectionDelegate {
  selectAction(action: TimelinePlanningAction): void
  clear(): void
}

export interface TimelineActionInteractionFrameHoverDelegate {
  showAction(action: TimelinePlanningAction, point: { readonly x: number; readonly y: number }): void
  clear(): void
  hideTooltip(): void
}

export interface TimelineActionInteractionFrameAnimation {
  requestAnimationFrame(callback: FrameRequestCallback): number
  cancelAnimationFrame(id: number): void
}

export interface TimelineActionInteractionFrameOptions {
  readonly canvasRef: MutableDomRef<HTMLCanvasElement>
  readonly cachedRectRef: MutableDomRef<DOMRect>
  readonly rowsRef: MutableRef<readonly TimelineActionTypeRow[]>
  readonly layoutRef: MutableRef<ReadonlyMap<string, TimelineActionLayout>>
  readonly rowOffsetsRef: MutableRef<number[]>
  readonly renderStateRef: MutableRef<TimelineRenderState>
  readonly projectionRef: MutableRef<TimelinePlanningProjection>
  readonly computedOriginMsRef: MutableRef<number>
  readonly view: TimelineActionInteractionFrameView
  readonly popover: TimelineActionInteractionFramePopoverDelegate
  readonly selection: TimelineActionInteractionFrameSelectionDelegate
  readonly hover: TimelineActionInteractionFrameHoverDelegate
  readonly animation?: TimelineActionInteractionFrameAnimation
}

export interface TimelineActionInteractionFrame {
  getFrozenOriginDate(): Date | null
  handleMouseDown(event: MouseEvent): void
  handleCanvasMouseMove(event: MouseEvent): void
  handleMouseLeave(): void
  handleContainerScroll(): void
  handleDocumentMouseMove(event: MouseEvent): void
  handleDocumentMouseUp(event: MouseEvent): void
  handleDocumentMouseLeave(): void
  handleWheel(event: WheelEvent): void
  abortActiveDrag(): void
  cleanup(): void
}

interface PendingTimelineClick {
  readonly clientX: number
  readonly clientY: number
  readonly popover: TimelineActionPendingClick
}

export function createTimelineActionInteractionFrame({
  canvasRef,
  cachedRectRef,
  rowsRef,
  layoutRef,
  rowOffsetsRef,
  renderStateRef,
  computedOriginMsRef,
  view,
  popover,
  hover,
  selection,
  animation = {
    requestAnimationFrame: (callback) => requestAnimationFrame(callback),
    cancelAnimationFrame: (id) => cancelAnimationFrame(id),
  },
}: TimelineActionInteractionFrameOptions): TimelineActionInteractionFrame {
  let dragState: TimelineDragState | null = null
  let pendingClick: PendingTimelineClick | null = null
  let dragOriginMs: number | null = null
  let dragOriginDate: Date | null = null
  let autoScrollRafId: number | null = null
  let autoScrollAccumPx = 0
  let lastDragClientX = 0

  const stopAutoScroll = (): void => {
    const rafId = autoScrollRafId
    if (rafId != null) {
      animation.cancelAnimationFrame(rafId)
      autoScrollRafId = null
    }
  }

  const autoScrollTick = (): void => {
    if (autoScrollRafId == null) return
    const drag = dragState
    if (!isTimelineEditDrag(drag)) {
      stopAutoScroll()
      return
    }
    const mouseX = lastDragClientX - drag.cachedRect.left
    const speed = timelineAutoScrollSpeed(mouseX, drag.cachedRect.width)
    if (speed === 0) {
      stopAutoScroll()
      return
    }
    view.setScrollX(view.getScrollX() + speed)
    autoScrollAccumPx += speed
    applyTimelineEditDragDelta(
      drag,
      lastDragClientX - drag.startMouseX + autoScrollAccumPx,
    )
    autoScrollRafId = animation.requestAnimationFrame(autoScrollTick)
  }

  const updateAutoScroll = (mouseX: number, chartWidth: number): void => {
    const speed = timelineAutoScrollSpeed(mouseX, chartWidth)
    if (speed !== 0) {
      if (autoScrollRafId == null) {
        autoScrollRafId = animation.requestAnimationFrame(autoScrollTick)
      }
    } else {
      stopAutoScroll()
    }
  }

  const restoreFrozenOrigin = (): void => {
    if (dragOriginMs == null) return
    const frozenMs = dragOriginMs
    dragOriginMs = null
    dragOriginDate = null
    view.setScrollX(restoreTimelineOriginScroll({
      frozenOriginMs: frozenMs,
      realOriginMs: computedOriginMsRef.current,
      scrollX: view.getScrollX(),
      pxPerDay: view.getPxPerDay(),
    }))
  }

  const finishDrag = (event: MouseEvent | null): void => {
    stopAutoScroll()
    const drag = dragState
    commitTimelineDrag(drag)
    if (drag?.type === 'resize' || drag?.type === 'pan') document.body.style.cursor = ''
    restoreFrozenOrigin()
    dragState = null

    if (!event) {
      pendingClick = null
      return
    }

    const pending = pendingClick
    pendingClick = null
    if (!pending) return
    const dx = Math.abs(event.clientX - pending.clientX)
    const dy = Math.abs(event.clientY - pending.clientY)
    if (dx + dy >= TIMELINE_CLICK_THRESHOLD) return

    popover.openPendingClick(pending.popover)
  }

  const abortActiveDrag = (): void => {
    stopAutoScroll()
    const drag = dragState
    if (isTimelineEditDrag(drag)) drag.edit.abort()
    if (drag?.type === 'resize' || drag?.type === 'pan') document.body.style.cursor = ''
    restoreFrozenOrigin()
    dragState = null
    pendingClick = null
  }

  return {
    getFrozenOriginDate: () => dragOriginDate,

    handleMouseDown(event: MouseEvent): void {
      const canvas = canvasRef.current
      if (!canvas) return

      const rect = canvas.getBoundingClientRect()
      const mouseX = event.clientX - rect.left
      const mouseY = event.clientY - rect.top

      if (event.button === 1) {
        event.preventDefault()
        dragState = createTimelinePanDrag({
          startMouseX: event.clientX,
          startScrollX: view.getScrollX(),
          cachedRect: rect,
        })
        document.body.style.cursor = 'grabbing'
        return
      }

      if (event.button !== 0) return

      const popoverWasOpen = popover.close()
      if (mouseY < RULER_HEIGHT) {
        const rulerHit = hitTestTimelineRulerControls(mouseX, mouseY)
        if (rulerHit === 'granularity') {
          const next = nextTimelineGranularity(view.getGranularity())
          view.setGranularity(next)
          view.setPxPerDay(TIMELINE_GRANULARITY_PX_PER_DAY[next])
          return
        }
        if (rulerHit === 'today') {
          const r = cachedRectRef.current ?? canvas.getBoundingClientRect()
          const chartWidth = r.width - LABEL_SIDEBAR_WIDTH
          const { originDate, pxPerDay } = renderStateRef.current
          view.setScrollX(dateToX(new Date(), originDate, pxPerDay) - chartWidth / 2)
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
        if (mouseX < LABEL_SIDEBAR_WIDTH || popoverWasOpen) return
        const { originDate, pxPerDay, scrollX } = renderStateRef.current
        const chartX = mouseX - LABEL_SIDEBAR_WIDTH + scrollX
        const clickDate = snapToDay(xToDate(chartX, originDate, pxPerDay))
        const offsets = rowOffsetsRef.current
        let rowActionType: ActionType = ACTION_TYPES[0]!
        for (let i = 0; i < offsets.length - 1; i++) {
          if (mouseY >= offsets[i]! && mouseY < offsets[i + 1]!) {
            rowActionType = ACTION_TYPES[i] ?? ACTION_TYPES[0]!
            break
          }
        }
        pendingClick = {
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
        dragState = createTimelinePanDrag({
          startMouseX: event.clientX,
          startScrollX: view.getScrollX(),
          cachedRect: rect,
        })
        return
      }

      selection.selectAction(hit.action)
      if (!hit.action.startDate) return

      const freeze = createTimelineOriginFreeze(computedOriginMsRef.current)
      dragOriginMs = freeze.originMs
      dragOriginDate = freeze.originDate
      lastDragClientX = event.clientX
      stopAutoScroll()
      autoScrollAccumPx = 0

      if (hit.edge === 'left' || hit.edge === 'right') {
        dragState = createTimelineResizeDrag({
          hit,
          startMouseX: event.clientX,
          cachedRect: rect,
          pxPerDaySnapshot: view.getPxPerDay(),
        })
        document.body.style.cursor = 'ew-resize'
        return
      }

      pendingClick = {
        clientX: event.clientX,
        clientY: event.clientY,
        popover: {
          type: 'edit',
          anchorX: event.clientX,
          anchorY: event.clientY,
          actionId: hit.action.id,
        },
      }
      dragState = createTimelineMoveDrag({
        hit,
        startMouseX: event.clientX,
        cachedRect: rect,
        pxPerDaySnapshot: view.getPxPerDay(),
      })
    },

    handleCanvasMouseMove(event: MouseEvent): void {
      if (dragState) return

      const canvas = canvasRef.current
      if (!canvas) return

      const rect = cachedRectRef.current ??= canvas.getBoundingClientRect()
      const mouseX = event.clientX - rect.left
      const mouseY = event.clientY - rect.top

      const hit = hitTestAction(
        mouseX,
        mouseY,
        rowsRef.current,
        layoutRef.current,
        renderStateRef.current,
        rowOffsetsRef.current,
      )

      if (hit) {
        hover.showAction(hit.action, { x: mouseX, y: mouseY })
      } else {
        hover.clear()
      }

      const nextCursor = hit
        ? (hit.edge === 'left' || hit.edge === 'right' ? 'ew-resize' : 'grab')
        : mouseY < RULER_HEIGHT ? 'default' : 'crosshair'
      if (canvas.style.cursor !== nextCursor) canvas.style.cursor = nextCursor
    },

    handleMouseLeave(): void {
      hover.clear()
      if (canvasRef.current) canvasRef.current.style.cursor = 'default'
    },

    handleContainerScroll(): void {
      cachedRectRef.current = null
      stopAutoScroll()
      hover.clear()
      popover.close()
      if (canvasRef.current) canvasRef.current.style.cursor = 'default'
    },

    handleDocumentMouseMove(event: MouseEvent): void {
      const drag = dragState
      if (drag?.type === 'pan') {
        if (document.body.style.cursor !== 'grabbing') document.body.style.cursor = 'grabbing'
        const nextScrollX = updateTimelinePanScrollX(drag, event.clientX)
        if (view.getScrollX() !== nextScrollX) view.setScrollX(nextScrollX)
        return
      }

      if (isTimelineEditDrag(drag)) {
        lastDragClientX = event.clientX
        const autoScrollPx = autoScrollAccumPx
        hover.hideTooltip()
        applyTimelineEditDragDelta(drag, event.clientX - drag.startMouseX + autoScrollPx)
        updateAutoScroll(event.clientX - drag.cachedRect.left, drag.cachedRect.width)
      }
    },

    handleDocumentMouseUp(event: MouseEvent): void {
      finishDrag(event)
    },

    handleDocumentMouseLeave(): void {
      if (isTimelineEditDrag(dragState)) stopAutoScroll()
    },

    handleWheel(event: WheelEvent): void {
      if (!(event.ctrlKey || event.metaKey)) return
      event.preventDefault()
      if (isTimelineEditDrag(dragState)) return
      if (popover.isOpen()) popover.close()

      const factor = event.deltaY > 0 ? 0.9 : 1.1
      const previousPxPerDay = view.getPxPerDay()
      const nextPxPerDay = Math.max(0.2, Math.min(20, previousPxPerDay * factor))
      if (nextPxPerDay === previousPxPerDay) return

      const canvas = canvasRef.current
      if (canvas) {
        const rect = cachedRectRef.current ?? canvas.getBoundingClientRect()
        const mouseX = event.clientX - rect.left - LABEL_SIDEBAR_WIDTH
        const dayAtCursor = (view.getScrollX() + mouseX) / previousPxPerDay
        view.setScrollX(dayAtCursor * nextPxPerDay - mouseX)
      }
      view.setPxPerDay(nextPxPerDay)
    },

    abortActiveDrag,

    cleanup(): void {
      finishDrag(null)
      hover.clear()
      selection.clear()
    },
  }
}
