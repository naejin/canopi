import { useCallback, useEffect, useRef } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import {
  clearPlanningHoveredTargets,
  getPlanningCanvasHoveredSpeciesCanonical,
  setPlanningHoveredSpecies,
} from '../planning-projection'
import {
  hitTestBar,
  type ConsortiumBarLayout,
} from '../../canvas/consortium-renderer'
import type { Consortium } from '../../types/design'
import {
  beginConsortiumDrag,
  commitConsortiumDrag,
  previewConsortiumDrag,
  type ConsortiumDragState,
} from './interaction'

interface MutableDomRef<T> {
  current: T | null
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
  const dragState = useRef<ConsortiumDragState | null>(null)
  const barsRef = useRef(bars)
  const consortiumsRef = useRef(consortiums)
  const rowHeightsRef = useRef<number[]>(rowHeights)
  const rowOffsetsRef = useRef<number[]>(rowOffsets)

  barsRef.current = bars
  consortiumsRef.current = consortiums
  rowHeightsRef.current = rowHeights
  rowOffsetsRef.current = rowOffsets

  const canvasHoveredCanonical = getPlanningCanvasHoveredSpeciesCanonical()
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

    dragState.current = beginConsortiumDrag({
      hit,
      bar,
      startMouseX: event.clientX,
      cachedRect: rect,
    })
  }, [canvasRef])

  const handleMouseMove = useCallback((event: MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const drag = dragState.current
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
        hoveredCanonical.value = hit.canonicalName
        setPlanningHoveredSpecies(hit.canonicalName)
      }
      canvas.style.cursor = hit.edge === 'body' ? 'grab' : 'ew-resize'
    } else {
      if (hoveredCanonical.value !== null) {
        hoveredCanonical.value = null
        clearPlanningHoveredTargets()
      }
      canvas.style.cursor = 'default'
    }
  }, [canvasRef, hoveredCanonical])

  const handleMouseLeave = useCallback(() => {
    if (hoveredCanonical.value !== null) {
      hoveredCanonical.value = null
      clearPlanningHoveredTargets()
    }
    if (canvasRef.current) canvasRef.current.style.cursor = 'default'
  }, [canvasRef, hoveredCanonical])

  const handleCanvasMouseMove = useCallback((event: MouseEvent) => {
    if (!dragState.current) handleMouseMove(event)
  }, [handleMouseMove])

  const handleMouseUp = useCallback(() => {
    if (dragState.current) {
      commitConsortiumDrag(dragState.current)
      dragState.current = null
    }
  }, [])

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (dragState.current) handleMouseMove(event)
    }
    const onUp = () => {
      handleMouseUp()
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      commitConsortiumDrag(dragState.current)
      dragState.current = null
      clearPlanningHoveredTargets()
    }
  }, [handleMouseMove, handleMouseUp])

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
