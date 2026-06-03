import { useCallback, useEffect, useMemo, useRef } from 'preact/hooks'
import {
  useTimelinePlanningSurface,
  type TimelineActionLayout,
  type TimelineActionTypeRow,
} from '../planning-projection'
import {
  RULER_HEIGHT,
  computeTimelineRowOffsets,
  type TimelineRenderState,
} from '../../canvas/timeline-renderer'
import type { TimelineAction } from '../../types/design'
import type { TimelineActionFormData } from './editing'
import {
  createTimelineActionInteractionWorkbench,
  type TimelineActionInteractionWorkbench,
  type TimelineTooltipState,
} from './interaction-workbench'
import type { TimelineActionPopoverState } from './workbench'

interface MutableDomRef<T> {
  current: T | null
}

export interface TimelineCanvasWorkbenchOptions {
  readonly canvasRef: MutableDomRef<HTMLCanvasElement>
}

export interface TimelineCanvasWorkbench {
  readonly cachedRectRef: { current: DOMRect | null }
  readonly rows: readonly TimelineActionTypeRow[]
  readonly layout: ReadonlyMap<string, TimelineActionLayout>
  readonly rowOffsets: number[]
  readonly canvasHeight: number
  readonly renderState: TimelineRenderState
  readonly renderDeps: readonly unknown[]
  readonly tooltip: TimelineTooltipState | null
  readonly popover: TimelineActionPopoverState | null
  readonly invalidateLayout: () => void
  readonly handleContainerScroll: () => void
  readonly handleMouseDown: (event: MouseEvent) => void
  readonly handleCanvasMouseMove: (event: MouseEvent) => void
  readonly handleMouseLeave: () => void
  readonly handlePopoverSave: (data: TimelineActionFormData) => void
  readonly handlePopoverDelete: () => void
  readonly handlePopoverCancel: () => void
}

const EMPTY_ACTIONS: TimelineAction[] = []

export function useTimelineCanvasWorkbench({
  canvasRef,
}: TimelineCanvasWorkbenchOptions): TimelineCanvasWorkbench {
  const fallbackOriginMs = useMemo(() => Date.now(), [])
  const {
    actions,
    projection,
    activeLocale,
    speciesColors,
  } = useTimelinePlanningSurface({ fallbackOriginMs })
  const rows = projection.rows
  const layout = projection.layout
  const originMs = projection.originMs
  const originDate = useMemo(() => new Date(originMs), [originMs])
  const rowOffsets = useMemo(() => computeTimelineRowOffsets(rows, layout), [rows, layout])
  const canvasHeight = rowOffsets[rowOffsets.length - 1] ?? RULER_HEIGHT
  const cachedRectRef = useRef<DOMRect | null>(null)
  const interactionWorkbenchRef = useRef<TimelineActionInteractionWorkbench | null>(null)

  if (!interactionWorkbenchRef.current) {
    interactionWorkbenchRef.current = createTimelineActionInteractionWorkbench({
      canvasRef,
      cachedRectRef,
    })
  }
  const interactionWorkbench = interactionWorkbenchRef.current
  interactionWorkbench.updateInputs({
    rows,
    layout,
    rowOffsets,
    projection,
    originDate,
    originMs,
    activeLocale,
    speciesColors,
  })

  const renderState = interactionWorkbench.readRenderState()

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas) canvas.addEventListener('wheel', interactionWorkbench.handleWheel, { passive: false })

    const onMove = (event: MouseEvent) => {
      interactionWorkbench.handleDocumentMouseMove(event)
    }
    const onUp = (event: MouseEvent) => {
      interactionWorkbench.handleDocumentMouseUp(event)
    }
    const onLeave = () => {
      interactionWorkbench.handleDocumentMouseLeave()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      interactionWorkbench.handleKeyDown(event)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.addEventListener('keydown', onKeyDown)
    document.documentElement.addEventListener('mouseleave', onLeave)
    return () => {
      if (canvas) canvas.removeEventListener('wheel', interactionWorkbench.handleWheel)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('keydown', onKeyDown)
      document.documentElement.removeEventListener('mouseleave', onLeave)
      interactionWorkbench.cleanup()
    }
  }, [canvasRef, interactionWorkbench])

  useEffect(() => {
    interactionWorkbench.syncActions(actions ?? EMPTY_ACTIONS)
  }, [actions, interactionWorkbench, interactionWorkbench.hoveredId.value, interactionWorkbench.selectedId.value])

  const invalidateLayout = useCallback(() => {
    cachedRectRef.current = null
  }, [])

  return {
    cachedRectRef,
    rows,
    layout,
    rowOffsets,
    canvasHeight,
    renderState,
    renderDeps: [
      rows,
      layout,
      rowOffsets,
      originMs,
      interactionWorkbench.pxPerDay.value,
      interactionWorkbench.scrollX.value,
      interactionWorkbench.selectedId.value,
      interactionWorkbench.hoveredId.value,
      activeLocale,
      speciesColors,
      interactionWorkbench.granularity.value,
    ],
    tooltip: interactionWorkbench.tooltip.value,
    popover: interactionWorkbench.popover.value,
    invalidateLayout,
    handleContainerScroll: interactionWorkbench.handleContainerScroll,
    handleMouseDown: interactionWorkbench.handleMouseDown,
    handleCanvasMouseMove: interactionWorkbench.handleCanvasMouseMove,
    handleMouseLeave: interactionWorkbench.handleMouseLeave,
    handlePopoverSave: interactionWorkbench.handlePopoverSave,
    handlePopoverDelete: interactionWorkbench.handlePopoverDelete,
    handlePopoverCancel: interactionWorkbench.handlePopoverCancel,
  }
}
