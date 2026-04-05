import { useCallback, useEffect, useRef } from 'preact/hooks'
import { useSignal, useSignalEffect } from '@preact/signals'
import { t } from '../../i18n'
import { locale } from '../../state/app'
import { plantSpeciesColors } from '../../state/canvas'
import { currentDesign } from '../../state/document'
import { upsertConsortiumEntry, deleteConsortiumEntry, moveConsortiumEntry } from '../../state/consortium-actions'
import { markDocumentDirty } from '../../state/document-mutations'
import {
  buildConsortiumBars,
  renderConsortium,
  hitTestBar,
  xToPhase,
  STRATA_ROWS,
  HEADER_HEIGHT,
  LABEL_WIDTH,
  ROW_HEIGHT,
  CONSORTIUM_PHASES,
  type ConsortiumRenderState,
} from '../../canvas/consortium-renderer'
import styles from './ConsortiumChart.module.css'

type DragState =
  | {
      type: 'move'
      canonicalName: string
      startMouseX: number
      startMouseY: number
      originalStratum: string
      originalStartPhase: number
      originalEndPhase: number
    }
  | {
      type: 'resize'
      canonicalName: string
      edge: 'left' | 'right'
      startMouseX: number
      originalStartPhase: number
      originalEndPhase: number
    }
  | null

export function ConsortiumChart() {
  void locale.value

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hoveredCanonical = useSignal<string | null>(null)
  const dragState = useRef<DragState>(null)
  const lastCanonicalNamesRef = useRef<Set<string>>(new Set())

  const design = currentDesign.value
  const plants = design?.plants ?? []
  const consortiums = design?.consortiums ?? []
  const colors = plantSpeciesColors.value
  const bars = buildConsortiumBars(consortiums, plants, colors)

  // Auto-sync: add/remove consortium entries when species are added/removed from canvas
  useSignalEffect(() => {
    const d = currentDesign.value
    if (!d) return

    const currentPlants = d.plants ?? []
    const currentConsortiums = d.consortiums ?? []
    const currentNames = new Set(currentPlants.map((p) => p.canonical_name))
    const lastNames = lastCanonicalNamesRef.current

    // Check if the set actually changed
    if (currentNames.size === lastNames.size) {
      let same = true
      for (const name of currentNames) {
        if (!lastNames.has(name)) { same = false; break }
      }
      if (same) return
    }

    // Find new species
    for (const name of currentNames) {
      if (!lastNames.has(name) && !currentConsortiums.some((c) => c.canonical_name === name)) {
        upsertConsortiumEntry({
          canonical_name: name,
          stratum: 'unassigned',
          start_phase: 0,
          end_phase: 0,
        })
      }
    }

    // Find removed species
    const consortiumNames = new Set(currentConsortiums.map((c) => c.canonical_name))
    for (const name of consortiumNames) {
      if (!currentNames.has(name)) {
        deleteConsortiumEntry(name)
      }
    }

    lastCanonicalNamesRef.current = currentNames
  })

  const renderState: ConsortiumRenderState = {
    hoveredCanonical: hoveredCanonical.value,
    selectedCanonical: null,
  }

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.scale(dpr, dpr)
    renderConsortium(ctx, rect.width, rect.height, bars, renderState, t)
  }, [bars, renderState])

  useEffect(() => {
    redraw()
  }, [redraw])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const observer = new ResizeObserver(() => redraw())
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [redraw])

  const handleMouseDown = useCallback((event: MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas || event.button !== 0) return

    const rect = canvas.getBoundingClientRect()
    const mouseX = event.clientX - rect.left
    const mouseY = event.clientY - rect.top

    const hit = hitTestBar(mouseX, mouseY, bars, rect.width, rect.height)
    if (!hit) return

    const bar = bars.find((b) => b.canonicalName === hit.canonicalName)
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
      }
    } else {
      dragState.current = {
        type: 'resize',
        canonicalName: hit.canonicalName,
        edge: hit.edge,
        startMouseX: event.clientX,
        originalStartPhase: bar.startPhase,
        originalEndPhase: bar.endPhase,
      }
    }
  }, [bars])

  const handleMouseMove = useCallback((event: MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const mouseX = event.clientX - rect.left
    const mouseY = event.clientY - rect.top
    const contentWidth = rect.width - LABEL_WIDTH
    const drag = dragState.current

    if (drag?.type === 'move') {
      const phaseDelta = xToPhase(mouseX, contentWidth) - xToPhase(drag.startMouseX - rect.left, contentWidth)
      const newStart = Math.round(Math.max(0, Math.min(CONSORTIUM_PHASES.length - 1, drag.originalStartPhase + phaseDelta)))
      const duration = drag.originalEndPhase - drag.originalStartPhase
      const newEnd = Math.min(CONSORTIUM_PHASES.length - 1, newStart + duration)
      const adjustedStart = newEnd - duration

      // Compute stratum from mouse Y
      const rowIndex = Math.max(0, Math.min(STRATA_ROWS.length - 1, Math.floor((mouseY - HEADER_HEIGHT) / ROW_HEIGHT)))
      const newStratum = STRATA_ROWS[rowIndex] ?? 'unassigned'

      moveConsortiumEntry(drag.canonicalName, newStratum, adjustedStart, newEnd, { markDirty: false })
      return
    }

    if (drag?.type === 'resize') {
      const phase = Math.round(xToPhase(mouseX, contentWidth))
      const clampedPhase = Math.max(0, Math.min(CONSORTIUM_PHASES.length - 1, phase))

      if (drag.edge === 'left') {
        const newStart = Math.min(clampedPhase, drag.originalEndPhase)
        moveConsortiumEntry(drag.canonicalName, '', newStart, drag.originalEndPhase, { markDirty: false })
      } else {
        const newEnd = Math.max(clampedPhase, drag.originalStartPhase)
        moveConsortiumEntry(drag.canonicalName, '', drag.originalStartPhase, newEnd, { markDirty: false })
      }
      return
    }

    // Not dragging — update hover and cursor
    const hit = hitTestBar(mouseX, mouseY, bars, rect.width, rect.height)
    if (hit) {
      hoveredCanonical.value = hit.canonicalName
      canvas.style.cursor = hit.edge === 'body' ? 'grab' : 'ew-resize'
    } else {
      hoveredCanonical.value = null
      canvas.style.cursor = 'default'
    }
  }, [bars])

  const handleMouseUp = useCallback(() => {
    if (dragState.current) {
      markDocumentDirty()
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
    }
  }, [handleMouseMove, handleMouseUp])

  if (bars.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>
          {t('canvas.consortium.empty')}
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        aria-label={t('canvas.consortium.title')}
      />
    </div>
  )
}
