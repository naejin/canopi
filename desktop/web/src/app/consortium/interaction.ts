import {
  LABEL_WIDTH,
  xToPhase,
  type ConsortiumBarLayout,
  type ConsortiumHitResult,
} from '../../canvas/consortium-renderer'
import { getConsortiumCanonicalName } from '../../target'
import type { Consortium } from '../../types/design'
import {
  beginConsortiumDocumentEdit,
  type ConsortiumDocumentEditTransaction,
  moveConsortiumEntryInArray,
  reorderConsortiumEntryInArray,
} from '../design-edit'
import {
  CONSORTIUM_STRATUM_COUNT,
  LAST_SUCCESSION_PHASE_INDEX,
  clampSuccessionPhaseBoundary,
  clampSuccessionPhaseIndex,
  stratumAtRow,
} from './time-model'

export type ConsortiumDragState = ConsortiumMoveDragState | ConsortiumResizeDragState

export interface ConsortiumMoveDragState {
  readonly type: 'move'
  readonly canonicalName: string
  readonly startMouseX: number
  readonly originalStartPhase: number
  readonly originalEndPhase: number
  readonly cachedRect: DOMRect
  readonly edit: ConsortiumDocumentEditTransaction
}

export interface ConsortiumResizeDragState {
  readonly type: 'resize'
  readonly canonicalName: string
  readonly edge: 'left' | 'right'
  readonly originalStartPhase: number
  readonly originalEndPhase: number
  readonly cachedRect: DOMRect
  readonly edit: ConsortiumDocumentEditTransaction
}

export interface ConsortiumDragSnapshot {
  readonly bars: readonly ConsortiumBarLayout[]
  readonly consortiums: readonly Consortium[]
  readonly rowHeights: readonly number[]
  readonly rowOffsets: readonly number[]
  readonly canvasWidth: number
}

export function beginConsortiumDrag({
  hit,
  bar,
  startMouseX,
  cachedRect,
}: {
  readonly hit: ConsortiumHitResult
  readonly bar: ConsortiumBarLayout
  readonly startMouseX: number
  readonly cachedRect: DOMRect
}): ConsortiumDragState {
  const edit = beginConsortiumDocumentEdit()
  if (hit.edge === 'body') {
    return {
      type: 'move',
      canonicalName: hit.canonicalName,
      startMouseX,
      originalStartPhase: bar.startPhase,
      originalEndPhase: bar.endPhase,
      cachedRect,
      edit,
    }
  }

  return {
    type: 'resize',
    canonicalName: hit.canonicalName,
    edge: hit.edge,
    originalStartPhase: bar.startPhase,
    originalEndPhase: bar.endPhase,
    cachedRect,
    edit,
  }
}

export function previewConsortiumDrag(
  drag: ConsortiumDragState,
  snapshot: ConsortiumDragSnapshot,
  pointer: { readonly mouseX: number; readonly mouseY: number },
): void {
  if (drag.type === 'move') {
    previewConsortiumMoveDrag(drag, snapshot, pointer)
    return
  }
  previewConsortiumResizeDrag(drag, snapshot, pointer.mouseX)
}

export function commitConsortiumDrag(drag: ConsortiumDragState | null): void {
  drag?.edit.commit()
}

function previewConsortiumMoveDrag(
  drag: ConsortiumMoveDragState,
  snapshot: ConsortiumDragSnapshot,
  pointer: { readonly mouseX: number; readonly mouseY: number },
): void {
  const contentWidth = snapshot.canvasWidth - LABEL_WIDTH
  const phaseDelta =
    xToPhase(pointer.mouseX, contentWidth)
    - xToPhase(drag.startMouseX - drag.cachedRect.left, contentWidth)
  const newStart = Math.round(clampSuccessionPhaseIndex(drag.originalStartPhase + phaseDelta))
  const duration = drag.originalEndPhase - drag.originalStartPhase
  const newEnd = Math.min(LAST_SUCCESSION_PHASE_INDEX, newStart + duration)
  const adjustedStart = newEnd - duration

  const rowIndex = rowIndexForPointerY(pointer.mouseY, snapshot.rowOffsets)
  const newStratum = stratumAtRow(rowIndex)

  const bar = snapshot.bars.find((candidate) => candidate.canonicalName === drag.canonicalName)
  if (!bar) return

  if (newStratum === bar.stratum && adjustedStart === bar.startPhase && newEnd === bar.endPhase) {
    previewConsortiumSameStratumReorder(drag, snapshot, pointer.mouseY, rowIndex, bar)
    return
  }

  if (bar.startPhase === adjustedStart && bar.endPhase === newEnd && bar.stratum === newStratum) return
  drag.edit.preview((consortiums) => moveConsortiumEntryInArray(
    consortiums,
    drag.canonicalName,
    { stratum: newStratum, startPhase: adjustedStart, endPhase: newEnd },
  ))
}

function previewConsortiumSameStratumReorder(
  drag: ConsortiumMoveDragState,
  snapshot: ConsortiumDragSnapshot,
  mouseY: number,
  rowIndex: number,
  bar: ConsortiumBarLayout,
): void {
  const rowY = snapshot.rowOffsets[rowIndex]!
  const rowHeight = snapshot.rowHeights[rowIndex] ?? 36
  const targetSubLane = Math.max(
    0,
    Math.min(
      bar.totalSubLanes - 1,
      Math.floor((mouseY - rowY) / (rowHeight / bar.totalSubLanes)),
    ),
  )
  if (targetSubLane === bar.subLane) return

  const sameStratum = snapshot.bars.filter((candidate) => candidate.stratum === bar.stratum)
  const targetBar = sameStratum[targetSubLane]
  if (!targetBar) return

  const targetArrayIdx = snapshot.consortiums.findIndex(
    (consortium) => getConsortiumCanonicalName(consortium) === targetBar.canonicalName,
  )
  if (targetArrayIdx === -1) return

  drag.edit.preview((consortiums) => reorderConsortiumEntryInArray(
    consortiums,
    drag.canonicalName,
    targetArrayIdx,
  ))
}

function previewConsortiumResizeDrag(
  drag: ConsortiumResizeDragState,
  snapshot: ConsortiumDragSnapshot,
  mouseX: number,
): void {
  const contentWidth = snapshot.canvasWidth - LABEL_WIDTH
  const phase = Math.round(xToPhase(mouseX, contentWidth))
  const bar = snapshot.bars.find((candidate) => candidate.canonicalName === drag.canonicalName)

  if (drag.edge === 'left') {
    const clampedPhase = clampSuccessionPhaseIndex(phase)
    const newStart = Math.min(clampedPhase, drag.originalEndPhase)
    if (bar && bar.startPhase === newStart) return
    drag.edit.preview((consortiums) => moveConsortiumEntryInArray(
      consortiums,
      drag.canonicalName,
      { startPhase: newStart, endPhase: drag.originalEndPhase },
    ))
    return
  }

  const clampedPhase = clampSuccessionPhaseBoundary(phase)
  const newEnd = Math.max(clampedPhase - 1, drag.originalStartPhase)
  if (bar && bar.endPhase === newEnd) return
  drag.edit.preview((consortiums) => moveConsortiumEntryInArray(
    consortiums,
    drag.canonicalName,
    { startPhase: drag.originalStartPhase, endPhase: newEnd },
  ))
}

function rowIndexForPointerY(
  mouseY: number,
  rowOffsets: readonly number[],
): number {
  let rowIndex = CONSORTIUM_STRATUM_COUNT - 1
  for (let i = 0; i < CONSORTIUM_STRATUM_COUNT; i++) {
    if (mouseY < rowOffsets[i + 1]!) {
      rowIndex = i
      break
    }
  }
  return Math.max(0, Math.min(CONSORTIUM_STRATUM_COUNT - 1, rowIndex))
}
