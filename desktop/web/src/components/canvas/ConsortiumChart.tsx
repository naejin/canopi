import { useCallback, useEffect, useMemo, useRef } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { t } from '../../i18n'
import { locale, theme } from '../../app/settings/state'
import { plantSpeciesColorDefaults } from '../../canvas/plant-species-color-defaults'
import { currentDesign } from '../../state/design'
import {
  beginConsortiumDrag,
  commitConsortiumDrag,
  previewConsortiumDrag,
  type ConsortiumDragState,
} from '../../app/consortium/interaction'
import {
  clearPlanningHoveredTargets,
  getPlanningCanvasHoveredSpeciesCanonical,
  setPlanningHoveredSpecies,
  useConsortiumPlanningProjection,
} from '../../app/planning-projection'
import {
  renderConsortium,
  hitTestBar,
  computeRowHeights,
  computeRowYOffsets,
  HEADER_HEIGHT,
  type ConsortiumRenderState,
} from '../../canvas/consortium-renderer'
import { useCanvasRenderer } from './useCanvasRenderer'
import styles from './ConsortiumChart.module.css'
import type { Consortium } from '../../types/design'

const EMPTY_CONSORTIUMS: Consortium[] = []

export function ConsortiumChart() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cachedRectRef = useRef<DOMRect | null>(null)
  const hoveredCanonical = useSignal<string | null>(null)
  const dragState = useRef<ConsortiumDragState | null>(null)

  const design = currentDesign.value
  const consortiums = design?.consortiums ?? EMPTY_CONSORTIUMS
  const colors = plantSpeciesColorDefaults.value
  const canvasHoveredCanonical = getPlanningCanvasHoveredSpeciesCanonical()
  const effectiveHoveredCanonical = hoveredCanonical.value ?? canvasHoveredCanonical

  const consortiumsRef = useRef(consortiums)
  consortiumsRef.current = consortiums

  const activeLocale = locale.value
  const projection = useConsortiumPlanningProjection({
    consortiums,
    speciesColors: colors,
  })
  const bars = projection.bars
  const rowHeights = useMemo(() => computeRowHeights(bars), [bars])
  const rowOffsets = useMemo(() => computeRowYOffsets(rowHeights), [rowHeights])
  const rowHeightsRef = useRef(rowHeights)
  rowHeightsRef.current = rowHeights
  const rowOffsetsRef = useRef(rowOffsets)
  rowOffsetsRef.current = rowOffsets
  const barsRef = useRef(bars)
  barsRef.current = bars

  // Set canvas height for scrolling (outside the shared hook so
  // getBoundingClientRect picks it up before the DPR-scaled redraw)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const totalHeight = HEADER_HEIGHT + rowHeights.reduce((a, b) => a + b, 0)
    canvas.style.height = `${totalHeight}px`
    cachedRectRef.current = null // invalidate after height change
  }, [rowHeights])

  // Shared DPR/resize/redraw hook
  useCanvasRenderer(canvasRef, (ctx, width, height) => {
    const state: ConsortiumRenderState = {
      hoveredCanonical: effectiveHoveredCanonical,
    }
    renderConsortium(ctx, width, height, barsRef.current, state, t, rowHeightsRef.current, rowOffsetsRef.current)
  }, [bars, effectiveHoveredCanonical, activeLocale, theme.value], cachedRectRef)

  // Clean up drag state and consortium hover bridge on unmount
  useEffect(() => {
    return () => {
      commitConsortiumDrag(dragState.current)
      clearPlanningHoveredTargets()
    }
  }, [])

  const handleMouseDown = useCallback((event: MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas || event.button !== 0) return

    const rect = canvas.getBoundingClientRect()
    const mouseX = event.clientX - rect.left
    const mouseY = event.clientY - rect.top

    const hit = hitTestBar(mouseX, mouseY, barsRef.current, rect.width, rowHeightsRef.current, rowOffsetsRef.current)
    if (!hit) return

    const bar = barsRef.current.find((b) => b.canonicalName === hit.canonicalName)
    if (!bar) return

    dragState.current = beginConsortiumDrag({
      hit,
      bar,
      startMouseX: event.clientX,
      cachedRect: rect,
    })
  }, [])

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

    // Not dragging - update hover and cursor
    const hit = hitTestBar(mouseX, mouseY, barsRef.current, rect.width, rowHeightsRef.current, rowOffsetsRef.current)
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
  }, [])

  const handleMouseLeave = useCallback(() => {
    if (hoveredCanonical.value !== null) {
      hoveredCanonical.value = null
      clearPlanningHoveredTargets()
    }
    if (canvasRef.current) canvasRef.current.style.cursor = 'default'
  }, [])

  const handleCanvasMouseMove = useCallback((e: MouseEvent) => {
    if (!dragState.current) handleMouseMove(e)
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
      if (dragState.current) handleMouseUp()
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      commitConsortiumDrag(dragState.current)
      dragState.current = null
    }
  }, [])

  return (
    <div className={styles.container}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        onMouseDown={handleMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseLeave={handleMouseLeave}
        aria-label={t('canvas.consortium.title')}
      />
      {bars.length === 0 && (
        <div className={styles.emptyOverlay}>
          {t('canvas.consortium.empty')}
        </div>
      )}
    </div>
  )
}
