import { useCallback, useEffect, useMemo, useRef } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { t } from '../../i18n'
import { locale } from '../../state/app'
import { plantSpeciesColors, hoveredConsortiumSpecies, sceneEntityRevision, plantNamesRevision } from '../../state/canvas'
import { currentDesign } from '../../state/document'
import { currentCanvasSession } from '../../canvas/session'
import { moveConsortiumEntry, reorderConsortiumEntry } from '../../state/consortium-actions'
import { markDocumentDirty } from '../../state/document-mutations'
import {
  buildConsortiumBars,
  filterActiveConsortiumEntries,
  renderConsortium,
  hitTestBar,
  computeRowHeights,
  computeRowYOffsets,
  xToPhase,
  STRATA_ROWS,
  HEADER_HEIGHT,
  LABEL_WIDTH,
  CONSORTIUM_PHASES,
  type ConsortiumRenderState,
} from '../../canvas/consortium-renderer'
import { useCanvasRenderer } from './useCanvasRenderer'
import styles from './ConsortiumChart.module.css'
import type { Consortium, PlacedPlant } from '../../types/design'

const EMPTY_PLANTS: PlacedPlant[] = []
const EMPTY_CONSORTIUMS: Consortium[] = []
const EMPTY_NAMES: ReadonlyMap<string, string | null> = new Map()

type DragState =
  | {
      type: 'move'
      canonicalName: string
      startMouseX: number
      startMouseY: number
      originalStratum: string
      originalStartPhase: number
      originalEndPhase: number
      cachedRect: DOMRect
      hasMutated: boolean
    }
  | {
      type: 'resize'
      canonicalName: string
      edge: 'left' | 'right'
      startMouseX: number
      originalStartPhase: number
      originalEndPhase: number
      cachedRect: DOMRect
      hasMutated: boolean
    }
  | null

export function ConsortiumChart() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cachedRectRef = useRef<DOMRect | null>(null)
  const hoveredCanonical = useSignal<string | null>(null)
  const dragState = useRef<DragState>(null)

  const session = currentCanvasSession.value
  const design = currentDesign.value
  const plants = session?.getPlacedPlants() ?? EMPTY_PLANTS
  const consortiums = design?.consortiums ?? EMPTY_CONSORTIUMS
  const colors = plantSpeciesColors.value
  const localizedNames = session?.getLocalizedCommonNames() ?? EMPTY_NAMES

  const plantsRef = useRef(plants)
  plantsRef.current = plants
  const consortiumsRef = useRef(consortiums)
  consortiumsRef.current = consortiums
  const localizedNamesRef = useRef(localizedNames)
  localizedNamesRef.current = localizedNames

  const bars = useMemo(
    () => {
      const activeEntries = filterActiveConsortiumEntries(consortiumsRef.current, plantsRef.current)
      return buildConsortiumBars(activeEntries, plantsRef.current, colors, localizedNamesRef.current)
    },
    // sceneEntityRevision + plantNamesRevision are the real change triggers;
    // plants/localizedNames are read from refs to avoid unstable array deps.
    // consortiums is a stable ref (only changes on mutateCurrentDesign), so
    // it's safe as a dep — needed to recompute bars after in-drag reorders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [colors, sceneEntityRevision.value, plantNamesRevision.value, consortiums, locale.value],
  )
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
      hoveredCanonical: hoveredCanonical.value,
    }
    renderConsortium(ctx, width, height, barsRef.current, state, t, rowHeightsRef.current, rowOffsetsRef.current)
  }, [bars, hoveredCanonical.value, locale.value], cachedRectRef)

  // Clean up drag state and consortium hover bridge on unmount
  useEffect(() => {
    return () => {
      if (dragState.current?.hasMutated) markDocumentDirty()
      hoveredConsortiumSpecies.value = null
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

    if (hit.edge === 'body') {
      dragState.current = {
        type: 'move',
        canonicalName: hit.canonicalName,
        startMouseX: event.clientX,
        startMouseY: event.clientY,
        originalStratum: bar.stratum,
        originalStartPhase: bar.startPhase,
        originalEndPhase: bar.endPhase,
        cachedRect: rect,
        hasMutated: false,
      }
    } else {
      dragState.current = {
        type: 'resize',
        canonicalName: hit.canonicalName,
        edge: hit.edge,
        startMouseX: event.clientX,
        originalStartPhase: bar.startPhase,
        originalEndPhase: bar.endPhase,
        cachedRect: rect,
        hasMutated: false,
      }
    }
  }, [])

  const handleMouseMove = useCallback((event: MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const drag = dragState.current
    const rect = drag?.cachedRect ?? (cachedRectRef.current ??= canvas.getBoundingClientRect())
    const mouseX = event.clientX - rect.left
    const mouseY = event.clientY - rect.top
    const contentWidth = rect.width - LABEL_WIDTH

    if (drag?.type === 'move') {
      const phaseDelta = xToPhase(mouseX, contentWidth) - xToPhase(drag.startMouseX - rect.left, contentWidth)
      const newStart = Math.round(Math.max(0, Math.min(CONSORTIUM_PHASES.length - 1, drag.originalStartPhase + phaseDelta)))
      const duration = drag.originalEndPhase - drag.originalStartPhase
      const newEnd = Math.min(CONSORTIUM_PHASES.length - 1, newStart + duration)
      const adjustedStart = newEnd - duration

      // Find which stratum row the mouse Y falls into using dynamic row heights
      let rowIndex = STRATA_ROWS.length - 1
      const rh = rowHeightsRef.current
      const offsets = rowOffsetsRef.current
      for (let i = 0; i < STRATA_ROWS.length; i++) {
        if (mouseY < offsets[i + 1]!) { rowIndex = i; break }
      }
      rowIndex = Math.max(0, Math.min(STRATA_ROWS.length - 1, rowIndex))
      const newStratum = STRATA_ROWS[rowIndex] ?? 'unassigned'

      const bar = barsRef.current.find((b) => b.canonicalName === drag.canonicalName)
      if (!bar) return

      // Vertical reorder within the same stratum — guard ensures same row,
      // so bar.totalSubLanes matches the target row's sub-lane count
      if (newStratum === bar.stratum && adjustedStart === bar.startPhase && newEnd === bar.endPhase) {
        const ry = offsets[rowIndex]!
        const rowH = rh[rowIndex] ?? 36
        const targetSubLane = Math.max(0, Math.min(bar.totalSubLanes - 1, Math.floor((mouseY - ry) / (rowH / bar.totalSubLanes))))
        if (targetSubLane !== bar.subLane) {
          // Find the bar currently in the target sub-lane and compute array indices.
          // Use consortiumsRef (render-time snapshot) — not currentDesign.peek() — so
          // the index lookup matches the same snapshot as the bar layout in barsRef.
          const sameStratum = barsRef.current.filter((b) => b.stratum === bar.stratum)
          const targetBar = sameStratum[targetSubLane]
          if (targetBar) {
            const targetArrayIdx = consortiumsRef.current.findIndex((c) => c.canonical_name === targetBar.canonicalName)
            if (targetArrayIdx !== -1) {
              reorderConsortiumEntry(drag.canonicalName, targetArrayIdx, { markDirty: false })
              drag.hasMutated = true
            }
          }
        }
        return
      }

      // Cross-stratum or phase move
      if (bar.startPhase === adjustedStart && bar.endPhase === newEnd && bar.stratum === newStratum) return
      moveConsortiumEntry(drag.canonicalName, { stratum: newStratum, startPhase: adjustedStart, endPhase: newEnd }, { markDirty: false })
      drag.hasMutated = true
      return
    }

    if (drag?.type === 'resize') {
      const phase = Math.round(xToPhase(mouseX, contentWidth))
      const clampedPhase = Math.max(0, Math.min(CONSORTIUM_PHASES.length - 1, phase))
      const bar = barsRef.current.find((b) => b.canonicalName === drag.canonicalName)

      if (drag.edge === 'left') {
        const newStart = Math.min(clampedPhase, drag.originalEndPhase)
        if (bar && bar.startPhase === newStart) return
        moveConsortiumEntry(drag.canonicalName, { startPhase: newStart, endPhase: drag.originalEndPhase }, { markDirty: false })
        drag.hasMutated = true
      } else {
        const newEnd = Math.max(clampedPhase, drag.originalStartPhase)
        if (bar && bar.endPhase === newEnd) return
        moveConsortiumEntry(drag.canonicalName, { startPhase: drag.originalStartPhase, endPhase: newEnd }, { markDirty: false })
        drag.hasMutated = true
      }
      return
    }

    // Not dragging — update hover and cursor
    const hit = hitTestBar(mouseX, mouseY, barsRef.current, rect.width, rowHeightsRef.current, rowOffsetsRef.current)
    if (hit) {
      if (hoveredCanonical.value !== hit.canonicalName) {
        hoveredCanonical.value = hit.canonicalName
        hoveredConsortiumSpecies.value = hit.canonicalName
      }
      canvas.style.cursor = hit.edge === 'body' ? 'grab' : 'ew-resize'
    } else {
      if (hoveredCanonical.value !== null) {
        hoveredCanonical.value = null
        hoveredConsortiumSpecies.value = null
      }
      canvas.style.cursor = 'default'
    }
  }, [])

  const handleMouseLeave = useCallback(() => {
    if (hoveredCanonical.value !== null) {
      hoveredCanonical.value = null
      hoveredConsortiumSpecies.value = null
    }
    if (canvasRef.current) canvasRef.current.style.cursor = 'default'
  }, [])

  const handleCanvasMouseMove = useCallback((e: MouseEvent) => {
    if (!dragState.current) handleMouseMove(e)
  }, [handleMouseMove])

  const handleMouseUp = useCallback(() => {
    if (dragState.current) {
      if (dragState.current.hasMutated) markDocumentDirty()
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
      if (dragState.current?.hasMutated) markDocumentDirty()
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
