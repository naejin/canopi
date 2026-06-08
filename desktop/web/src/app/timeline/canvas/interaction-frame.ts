import type {
  ActionType,
  TimelinePlanningAction,
  TimelinePlanningProjection,
} from '../../planning-projection'
import { ACTION_TYPES } from '../../planning-projection'
import {
  TIMELINE_LABEL_SIDEBAR_WIDTH,
  TIMELINE_RULER_HEIGHT,
  findTimelineActionTypeAtY,
  hitTestTimelineActionGeometry,
  type TimelineActionCanvasGeometry,
} from './geometry'
import { snapToDay, toISODate, xToDate } from '../../../canvas/timeline-math'
import {
  clearTimelineHoveredPanelTargets,
  clearTimelineSelectedPanelTargets,
  deleteSelectedTimelineAction,
  deleteTimelineActionPopover,
  openTimelineActionPopover,
  saveTimelineActionPopover,
  setTimelineHoveredPanelTargets,
  setTimelineSelectedPanelTargets,
  type TimelineActionPendingClick,
  type TimelineActionPopoverState,
} from '../workbench'
import type { TimelineActionFormData } from '../editing'
import { createUuid } from '../../../utils/ids'
import { isEditableTarget } from '../../../canvas/runtime/interaction/pointer-utils'
import {
  TIMELINE_CLICK_THRESHOLD,
  applyTimelineEditDragDelta,
  commitTimelineDrag,
  createTimelineMoveDrag,
  createTimelineOriginFreeze,
  createTimelinePanDrag,
  createTimelineResizeDrag,
  isTimelineEditDrag,
  restoreTimelineOriginScroll,
  timelineAutoScrollSpeed,
  updateTimelinePanScrollX,
  type TimelineDragState,
} from '../interaction'

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
}

export interface TimelineActionInteractionFramePopoverDelegate {
  get(): TimelineActionPopoverState | null
  set(next: TimelineActionPopoverState | null): void
  isOpen(): boolean
  close(): boolean
}

export interface TimelineActionInteractionFrameSelectionDelegate {
  getSelectedId(): string | null
  selectAction(action: TimelinePlanningAction): void
  setSelectedId(actionId: string | null): void
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
  readonly geometryRef: MutableRef<TimelineActionCanvasGeometry>
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
  syncActions(actions: readonly { readonly id: string }[]): void
  handleMouseDown(event: MouseEvent): void
  handleCanvasMouseMove(event: MouseEvent): void
  handleMouseLeave(): void
  handleContainerScroll(): void
  handleDocumentMouseMove(event: MouseEvent): void
  handleDocumentMouseUp(event: MouseEvent): void
  handleDocumentMouseLeave(): void
  handleWheel(event: WheelEvent): void
  handleKeyDown(event: KeyboardEvent): void
  handlePopoverSave(data: TimelineActionFormData): void
  handlePopoverDelete(): void
  handlePopoverCancel(): void
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
  geometryRef,
  projectionRef,
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
  let selectedActionId: string | null = null
  let hoveredActionId: string | null = null

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

    popover.set(openTimelineActionPopover({
      pendingClick: pending.popover,
      speciesList: projectionRef.current.speciesList,
    }))
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

  const applySelectedIdResult = (result: { readonly selectedId?: string | null }): void => {
    if (!('selectedId' in result)) return
    selectedActionId = result.selectedId ?? null
    selection.setSelectedId(selectedActionId)
  }

  const clearHover = (): void => {
    hoveredActionId = null
    hover.clear()
    clearTimelineHoveredPanelTargets()
  }

  const clearSelection = (): void => {
    selectedActionId = null
    selection.setSelectedId(null)
    selection.clear()
    clearTimelineSelectedPanelTargets()
  }

  return {
    getFrozenOriginDate: () => dragOriginDate,

    syncActions(actions): void {
      const liveIds = new Set(actions.map((action) => action.id))
      if (selectedActionId && !liveIds.has(selectedActionId)) clearSelection()
      if (hoveredActionId && !liveIds.has(hoveredActionId)) clearHover()
    },

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
      if (mouseY < TIMELINE_RULER_HEIGHT) {
        return
      }

      const geometry = geometryRef.current
      const hit = hitTestTimelineActionGeometry(geometry, { x: mouseX, y: mouseY })

      if (!hit) {
        if (mouseX < TIMELINE_LABEL_SIDEBAR_WIDTH || popoverWasOpen) return
        const { originDate, pxPerDay, scrollX } = geometry.state
        const chartX = mouseX - TIMELINE_LABEL_SIDEBAR_WIDTH + scrollX
        const clickDate = snapToDay(xToDate(chartX, originDate, pxPerDay))
        const rowActionType = (
          findTimelineActionTypeAtY(geometry, mouseY) ?? ACTION_TYPES[0]!
        ) as ActionType
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

      selectedActionId = hit.action.id
      selection.setSelectedId(hit.action.id)
      selection.selectAction(hit.action)
      setTimelineSelectedPanelTargets(hit.action.targets)
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

      const hit = hitTestTimelineActionGeometry(geometryRef.current, { x: mouseX, y: mouseY })

      if (hit) {
        hoveredActionId = hit.action.id
        setTimelineHoveredPanelTargets(hit.action.targets)
        hover.showAction(hit.action, { x: mouseX, y: mouseY })
      } else {
        clearHover()
      }

      const nextCursor = hit
        ? (hit.edge === 'left' || hit.edge === 'right' ? 'ew-resize' : 'grab')
        : mouseY < TIMELINE_RULER_HEIGHT ? 'default' : 'crosshair'
      if (canvas.style.cursor !== nextCursor) canvas.style.cursor = nextCursor
    },

    handleMouseLeave(): void {
      clearHover()
      if (canvasRef.current) canvasRef.current.style.cursor = 'default'
    },

    handleContainerScroll(): void {
      cachedRectRef.current = null
      stopAutoScroll()
      clearHover()
      popover.close()
      if (canvasRef.current) canvasRef.current.style.cursor = 'default'
    },

    handleDocumentMouseMove(event: MouseEvent): void {
      const drag = dragState
      if (drag?.type === 'pan') {
        if (document.body.style.cursor !== 'grabbing') document.body.style.cursor = 'grabbing'
        hover.hideTooltip()
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
        const mouseX = event.clientX - rect.left - TIMELINE_LABEL_SIDEBAR_WIDTH
        const dayAtCursor = (view.getScrollX() + mouseX) / previousPxPerDay
        view.setScrollX(dayAtCursor * nextPxPerDay - mouseX)
      }
      view.setPxPerDay(nextPxPerDay)
    },

    handleKeyDown(event: KeyboardEvent): void {
      if (popover.get()) return
      const activeSelectedId = selectedActionId ?? selection.getSelectedId()
      if (!activeSelectedId) return
      if (isEditableTarget(event.target)) return
      if (event.key !== 'Delete' && event.key !== 'Backspace') return

      event.preventDefault()
      clearHover()
      applySelectedIdResult(deleteSelectedTimelineAction(activeSelectedId))
    },

    handlePopoverSave(data: TimelineActionFormData): void {
      const currentPopover = popover.get()
      if (!currentPopover) return

      const result = saveTimelineActionPopover({
        popover: currentPopover,
        data,
        createId: createUuid,
      })
      applySelectedIdResult(result)
      popover.set(null)
    },

    handlePopoverDelete(): void {
      const currentPopover = popover.get()
      if (!currentPopover) return

      applySelectedIdResult(deleteTimelineActionPopover(currentPopover))
      popover.set(null)
    },

    handlePopoverCancel(): void {
      popover.set(null)
    },

    abortActiveDrag,

    cleanup(): void {
      finishDrag(null)
      clearHover()
      clearSelection()
    },
  }
}
