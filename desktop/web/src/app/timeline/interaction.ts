import type { TimelineActionEditSession } from './editing'
import {
  beginTimelineActionEdit,
  compensateFrozenTimelineOriginScroll,
  computeTimelineAutoScrollSpeed,
} from './editing'
import {
  TIMELINE_LABEL_SIDEBAR_WIDTH,
  type TimelineActionHitResult,
} from './canvas/geometry'

export const TIMELINE_CLICK_THRESHOLD = 3

export type TimelineDragState =
  | TimelineMoveDragState
  | TimelineResizeDragState
  | TimelinePanDragState

export interface TimelineMoveDragState {
  readonly type: 'move'
  readonly startMouseX: number
  readonly cachedRect: DOMRect
  readonly edit: TimelineActionEditSession
}

export interface TimelineResizeDragState {
  readonly type: 'resize'
  readonly startMouseX: number
  readonly cachedRect: DOMRect
  readonly edit: TimelineActionEditSession
}

export interface TimelinePanDragState {
  readonly type: 'pan'
  readonly startMouseX: number
  readonly startScrollX: number
  readonly cachedRect: DOMRect
}

export interface TimelineOriginFreeze {
  readonly originMs: number
  readonly originDate: Date
}

export function createTimelinePanDrag({
  startMouseX,
  startScrollX,
  cachedRect,
}: {
  readonly startMouseX: number
  readonly startScrollX: number
  readonly cachedRect: DOMRect
}): TimelinePanDragState {
  return {
    type: 'pan',
    startMouseX,
    startScrollX,
    cachedRect,
  }
}

export function createTimelineMoveDrag({
  hit,
  startMouseX,
  cachedRect,
  pxPerDaySnapshot,
}: {
  readonly hit: TimelineActionHitResult
  readonly startMouseX: number
  readonly cachedRect: DOMRect
  readonly pxPerDaySnapshot: number
}): TimelineMoveDragState | null {
  if (!hit.action.startDate) return null

  const startMs = new Date(hit.action.startDate).getTime()
  const endMs = hit.action.endDate ? new Date(hit.action.endDate).getTime() : null
  const durationMs = endMs != null ? endMs - startMs : null

  return {
    type: 'move',
    startMouseX,
    cachedRect,
    edit: beginTimelineActionEdit({
      type: 'move',
      actionId: hit.action.id,
      originalStartMs: startMs,
      durationMs,
      pxPerDaySnapshot,
    }),
  }
}

export function createTimelineResizeDrag({
  hit,
  startMouseX,
  cachedRect,
  pxPerDaySnapshot,
}: {
  readonly hit: TimelineActionHitResult
  readonly startMouseX: number
  readonly cachedRect: DOMRect
  readonly pxPerDaySnapshot: number
}): TimelineResizeDragState | null {
  if (!hit.action.startDate || (hit.edge !== 'left' && hit.edge !== 'right')) return null

  const startMs = new Date(hit.action.startDate).getTime()
  const endMs = hit.action.endDate ? new Date(hit.action.endDate).getTime() : null

  return {
    type: 'resize',
    startMouseX,
    cachedRect,
    edit: beginTimelineActionEdit({
      type: 'resize',
      actionId: hit.action.id,
      edge: hit.edge,
      originalStartMs: startMs,
      originalEndMs: endMs,
      pxPerDaySnapshot,
    }),
  }
}

export function isTimelineEditDrag(
  drag: TimelineDragState | null,
): drag is TimelineMoveDragState | TimelineResizeDragState {
  return drag?.type === 'move' || drag?.type === 'resize'
}

export function applyTimelineEditDragDelta(
  drag: TimelineMoveDragState | TimelineResizeDragState,
  totalPxDelta: number,
): void {
  drag.edit.applyPixelDelta(totalPxDelta)
}

export function updateTimelinePanScrollX(
  drag: TimelinePanDragState,
  clientX: number,
): number {
  return drag.startScrollX - (clientX - drag.startMouseX)
}

export function timelineAutoScrollSpeed(
  mouseX: number,
  chartWidth: number,
): number {
  return computeTimelineAutoScrollSpeed(mouseX, chartWidth, TIMELINE_LABEL_SIDEBAR_WIDTH)
}

export function createTimelineOriginFreeze(originMs: number): TimelineOriginFreeze {
  return {
    originMs,
    originDate: new Date(originMs),
  }
}

export function restoreTimelineOriginScroll({
  frozenOriginMs,
  realOriginMs,
  scrollX,
  pxPerDay,
}: {
  readonly frozenOriginMs: number
  readonly realOriginMs: number
  readonly scrollX: number
  readonly pxPerDay: number
}): number {
  return compensateFrozenTimelineOriginScroll({
    frozenOriginMs,
    realOriginMs,
    scrollX,
    pxPerDay,
  })
}

export function commitTimelineDrag(drag: TimelineDragState | null): void {
  if (isTimelineEditDrag(drag)) drag.edit.commit()
}
