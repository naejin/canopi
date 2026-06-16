import { useCallback, useEffect, useRef } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { createPanelTargetPresentationController } from '../panel-targets/presentation'
import {
  createPlanningCanvasInteractionFrame,
  type PlanningCanvasInteractionFrame,
} from '../planning-canvas/interaction-frame'
import {
  hitTestBar,
  type ConsortiumBarLayout,
} from '../../canvas/consortium-renderer'
import { consortiumTarget } from '../../target'
import type { Consortium } from '../../types/design'
import {
  beginConsortiumDrag,
  commitConsortiumDrag,
  previewConsortiumDrag,
  type ConsortiumDragState,
} from './interaction'

const consortiumTargetPresentation = createPanelTargetPresentationController('consortium')

interface MutableDomRef<T> {
  current: T | null
}

interface ConsortiumDocumentHandlers {
  handleMouseMove(event: MouseEvent): void
  handleMouseUp(event: MouseEvent): void
  handleMouseLeave(): void
}

export interface ConsortiumCanvasWorkbenchOptions {
  readonly canvasRef: MutableDomRef<HTMLCanvasElement>
  readonly bars: readonly ConsortiumBarLayout[]
  readonly consortiums: readonly Consortium[]
  readonly rowHeights: number[]
  readonly rowOffsets: number[]
}

export interface ConsortiumCanvasWorkbench {
  readonly cachedRectRef: { current: DOMRect | null }
  readonly effectiveHoveredCanonical: string | null
  readonly invalidateLayout: () => void
  readonly handleMouseDown: (event: MouseEvent) => void
  readonly handleCanvasMouseMove: (event: MouseEvent) => void
  readonly handleMouseLeave: () => void
}

export function useConsortiumCanvasWorkbench({
  canvasRef,
  bars,
  consortiums,
  rowHeights,
  rowOffsets,
}: ConsortiumCanvasWorkbenchOptions): ConsortiumCanvasWorkbench {
  const cachedRectRef = useRef<DOMRect | null>(null)
  const hoveredCanonical = useSignal<string | null>(null)
  const barsRef = useRef(bars)
  const consortiumsRef = useRef(consortiums)
  const rowHeightsRef = useRef<number[]>(rowHeights)
  const rowOffsetsRef = useRef<number[]>(rowOffsets)
  const documentHandlersRef = useRef<ConsortiumDocumentHandlers>({
    handleMouseMove: () => {},
    handleMouseUp: () => {},
    handleMouseLeave: () => {},
  })
  const planningFrameRef = useRef<PlanningCanvasInteractionFrame | null>(null)

  if (!planningFrameRef.current) {
    planningFrameRef.current = createPlanningCanvasInteractionFrame({
      getHoveredId: () => hoveredCanonical.value,
      setHoveredId: (id) => {
        hoveredCanonical.value = id
      },
      getSelectedId: () => null,
      setSelectedId: () => {},
      clearLocalHover: () => {
        hoveredCanonical.value = null
        if (canvasRef.current) canvasRef.current.style.cursor = 'default'
      },
      clearLocalSelection: () => {},
      targetPresentation: consortiumTargetPresentation,
      documentEvents: {
        handleMouseMove: (event) => {
          documentHandlersRef.current.handleMouseMove(event)
        },
        handleMouseUp: (event) => {
          documentHandlersRef.current.handleMouseUp(event)
        },
        handleMouseLeave: () => {
          documentHandlersRef.current.handleMouseLeave()
        },
        handleKeyDown: () => {},
      },
    })
  }
  const planningFrame = planningFrameRef.current

  barsRef.current = bars
  consortiumsRef.current = consortiums
  rowHeightsRef.current = rowHeights
  rowOffsetsRef.current = rowOffsets

  const canvasHoveredCanonical = consortiumTargetPresentation.readCanvasHoveredSpeciesCanonical()
  const effectiveHoveredCanonical = hoveredCanonical.value ?? canvasHoveredCanonical

  const handleMouseDown = useCallback((event: MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas || event.button !== 0) return

    const rect = canvas.getBoundingClientRect()
    const mouseX = event.clientX - rect.left
    const mouseY = event.clientY - rect.top

    const hit = hitTestBar(
      mouseX,
      mouseY,
      barsRef.current,
      rect.width,
      rowHeightsRef.current,
      rowOffsetsRef.current,
    )
    if (!hit) return

    const bar = barsRef.current.find((candidate) => candidate.canonicalName === hit.canonicalName)
    if (!bar) return

    const drag = beginConsortiumDrag({
      hit,
      bar,
      startMouseX: event.clientX,
      cachedRect: rect,
    })
    if (!drag) return
    const activeDrag: ConsortiumDragState = drag

    planningFrame.beginActiveDrag<ConsortiumDragState>(activeDrag, {
      commit: commitConsortiumDrag,
      abort: (currentDrag) => {
        currentDrag.edit.abort()
      },
    })
  }, [canvasRef, planningFrame])

  const handleMouseMove = useCallback((event: MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const drag = planningFrame.getActiveDrag<ConsortiumDragState>()
    const rect = drag?.cachedRect ?? (cachedRectRef.current ??= canvas.getBoundingClientRect())
    const mouseX = event.clientX - rect.left
    const mouseY = event.clientY - rect.top

    if (drag) {
      previewConsortiumDrag(
        drag,
        {
          bars: barsRef.current,
          consortiums: consortiumsRef.current,
          rowHeights: rowHeightsRef.current,
          rowOffsets: rowOffsetsRef.current,
          canvasWidth: rect.width,
        },
        { mouseX, mouseY },
      )
      return
    }

    const hit = hitTestBar(
      mouseX,
      mouseY,
      barsRef.current,
      rect.width,
      rowHeightsRef.current,
      rowOffsetsRef.current,
    )
    if (hit) {
      if (hoveredCanonical.value !== hit.canonicalName) {
        planningFrame.setHoveredItem({
          id: hit.canonicalName,
          targets: [consortiumTarget(hit.canonicalName)],
        }, () => {})
      }
      canvas.style.cursor = hit.edge === 'body' ? 'grab' : 'ew-resize'
    } else {
      if (hoveredCanonical.value !== null) planningFrame.clearHover()
      canvas.style.cursor = 'default'
    }
  }, [canvasRef, hoveredCanonical, planningFrame])

  const handleMouseLeave = useCallback(() => {
    if (hoveredCanonical.value !== null) planningFrame.clearHover()
    if (canvasRef.current) canvasRef.current.style.cursor = 'default'
  }, [canvasRef, hoveredCanonical, planningFrame])

  const handleCanvasMouseMove = useCallback((event: MouseEvent) => {
    if (!planningFrame.getActiveDrag<ConsortiumDragState>()) handleMouseMove(event)
  }, [handleMouseMove, planningFrame])

  const handleMouseUp = useCallback(() => {
    planningFrame.finishActiveDrag<ConsortiumDragState>()
  }, [planningFrame])

  documentHandlersRef.current = {
    handleMouseMove: (event: MouseEvent) => {
      if (planningFrame.getActiveDrag<ConsortiumDragState>()) handleMouseMove(event)
    },
    handleMouseUp: () => {
      handleMouseUp()
    },
    handleMouseLeave: () => {},
  }

  useEffect(() => {
    const disposeDocumentListeners = planningFrame.installDocumentListeners({
      canvasRef,
    })
    return () => {
      disposeDocumentListeners()
      planningFrame.finishActiveDrag<ConsortiumDragState>()
      planningFrame.cleanup()
    }
  }, [canvasRef, planningFrame])

  useEffect(() => {
    planningFrame.syncVisibleItems(bars.map((bar) => ({ id: bar.canonicalName })))
  }, [bars, hoveredCanonical.value, planningFrame])

  const invalidateLayout = useCallback(() => {
    cachedRectRef.current = null
  }, [])

  return {
    cachedRectRef,
    effectiveHoveredCanonical,
    invalidateLayout,
    handleMouseDown,
    handleCanvasMouseMove,
    handleMouseLeave,
  }
}
