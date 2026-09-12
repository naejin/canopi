/** Throwaway proposal: independent lens navigation; no canvas pointer tracking or mode controls. */
import { createPortal } from 'preact/compat'
import { SurfaceHeader } from '../src/components/shared/SurfaceHeader'
import type { RefObject } from 'preact'
import { useId, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import type { CanvasInspectionHandle } from '../src/canvas/inspection'
import type { CanvasDocumentSurface, CanvasQuerySurface } from '../src/canvas/runtime/runtime'
import { currentCanvasDocumentSurface, currentCanvasQuerySurface } from '../src/canvas/session'
import { t } from '../src/i18n'
import styles from './inspection-proposal.module.css'

export function InspectionLensProposal({ canvasRef, initialOpen = false }: { canvasRef: RefObject<HTMLDivElement>; initialOpen?: boolean }) {
  const documents = currentCanvasDocumentSurface.value
  const queries = currentCanvasQuerySurface.value
  const [open, setOpen] = useState(initialOpen)
  const launcher = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)
  const id = useId()
  useLayoutEffect(() => {
    if (wasOpen.current && !open) launcher.current?.focus()
    wasOpen.current = open
  }, [open])
  if (!documents || !queries) return null
  return <>
    {!open && <button ref={launcher} type="button" className={styles.launcher} aria-expanded={open} aria-controls={id}
      onClick={() => setOpen(!open)}>
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.4" /><path d="m10 10 4 4" stroke="currentColor" strokeWidth="1.4" /></svg>
      {t('canvas.inspection.title')}
    </button>}
    {open && <InspectionPanel id={id} documents={documents} queries={queries} canvasRef={canvasRef} onClose={() => setOpen(false)} />}
  </>
}

function InspectionPanel({ id, documents, queries, canvasRef, onClose }: {
  id: string
  documents: CanvasDocumentSurface
  queries: CanvasQuerySurface
  canvasRef: RefObject<HTMLDivElement>
  onClose(): void
}) {
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const preview = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLElement>(null)
  const handle = useSignal<CanvasInspectionHandle | null>(null)
  const failed = useSignal(false)
  const drag = useRef<{ id: number; x: number; y: number } | null>(null)
  useLayoutEffect(() => {
    if (!preview.current) return
    let view: CanvasInspectionHandle
    try { view = documents.attachInspectionTo(preview.current) }
    catch (error) { console.error('Unable to open the inspection lens:', error); failed.value = true; return }
    const host = canvasRef.current
    const viewport = queries.viewport.peek().viewport
    if (host) view.inspect({ x: (host.clientWidth / 2 - viewport.x) / viewport.scale, y: (host.clientHeight / 2 - viewport.y) / viewport.scale })
    handle.value = view
    panel.current?.querySelector<HTMLElement>('[data-inspection-frame]')?.focus()
    return () => { handle.value = null; view.dispose() }
  }, [documents])
  const state = handle.value?.state.value
  const viewport = queries.viewport.value.viewport
  return <>
    {state && canvasRef.current && createPortal(<svg className={styles.source} aria-hidden="true" data-inspection-source>
      <rect x={viewport.x + (state.point.x - state.frame.width / state.scale / 2) * viewport.scale}
        y={viewport.y + (state.point.y - state.frame.height / state.scale / 2) * viewport.scale}
        width={state.frame.width / state.scale * viewport.scale}
        height={state.frame.height / state.scale * viewport.scale}
        />
    </svg>, canvasRef.current)}
    <section ref={panel} id={id} className={styles.panel} data-expanded={expanded} aria-label={t('canvas.inspection.title')}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() } }}>
    <SurfaceHeader title={t('canvas.inspection.title')} closeLabel={t('canvas.inspection.close')} onClose={onClose}
      actions={<button type="button" className={styles.expandButton} aria-label={t(expanded ? 'canvas.inspection.compact' : 'canvas.inspection.expand')}
        aria-pressed={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '↙' : '↗'}</button>} />
    <div className={styles.preview} data-inspection-frame role="group" tabIndex={0} aria-label="Inspection preview. Drag or use arrow keys to explore."
      onPointerDown={event => {
        if (event.button !== 0 || !state || (event.target instanceof Element && event.target.closest('button'))) return
        event.preventDefault(); event.stopPropagation(); event.currentTarget.focus()
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={event => {
        const previous = drag.current
        if (!previous || previous.id !== event.pointerId || !state) return
        event.preventDefault(); event.stopPropagation()
        handle.value?.panBy({ x: (previous.x - event.clientX) / state.scale, y: (previous.y - event.clientY) / state.scale })
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
      }}
      onPointerUp={event => {
        if (drag.current?.id !== event.pointerId) return
        drag.current = null
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onPointerCancel={() => { drag.current = null }}
      onLostPointerCapture={() => { drag.current = null }}
      onKeyDown={event => {
        if (event.target !== event.currentTarget || !state) return
        const step = (event.shiftKey ? 60 : 20) / state.scale
        const delta = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 },
          ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } }[event.key]
        if (!delta) return
        event.preventDefault(); event.stopPropagation(); handle.value?.panBy(delta)
      }}>
      <div ref={preview} className={styles.artwork} />
      {state && <svg className={styles.connectors} viewBox={`0 0 ${state.frame.width} ${state.frame.height}`} aria-hidden="true">
        {state.plants.map(plant => <g key={plant.id} data-active={highlighted === plant.id}>
          {!state.previewAvailable && <circle cx={plant.screenPosition.x} cy={plant.screenPosition.y} r="4" fill="var(--color-text-muted)" />}
          {plant.label && <line x1={plant.screenPosition.x} y1={plant.screenPosition.y}
            x2={Math.max(plant.label.x, Math.min(plant.label.x + plant.label.width, plant.screenPosition.x))}
            y2={Math.max(plant.label.y, Math.min(plant.label.y + plant.label.height, plant.screenPosition.y))} />}
          {highlighted === plant.id && <circle cx={plant.screenPosition.x} cy={plant.screenPosition.y} r="11" fill="none" stroke="var(--color-primary)" stroke-width="2" />}
        </g>)}
      </svg>}
      {state?.plants.map(plant => plant.label && <button key={plant.id} type="button" data-plant-id={plant.id}
        className={styles.plantName} style={{ left: plant.label.x, top: plant.label.y, width: plant.label.width, height: plant.label.height }}
        aria-label={t('canvas.inspection.locate', { name: plant.name })}
        onMouseEnter={() => { setHighlighted(plant.id); handle.value?.highlightPlant(plant.id) }}
        onMouseLeave={() => { setHighlighted(null); handle.value?.highlightPlant(null) }}
        onFocus={() => { setHighlighted(plant.id); handle.value?.highlightPlant(plant.id) }}
        onBlur={() => { setHighlighted(null); handle.value?.highlightPlant(null) }}
        onClick={() => handle.value?.focusPlant(plant.id)}>{plant.label.lines.map((line, i) => <span key={i}>{line}</span>)}</button>)}

    </div>
    {(failed.value || state?.previewAvailable === false) && <p role="status">{t('canvas.inspection.unavailable')}</p>}

    <div className={styles.controls}>
      <span role="status">{state?.plants.length ?? 0} {state?.plants.length === 1 ? 'plant' : 'plants'} · {state?.plants.filter(plant => plant.label).length ?? 0} labelled</span>
      <div className={styles.zoom} aria-label="Inspection zoom">
      <button type="button" disabled={!handle.value} aria-label={t('canvas.inspection.widen')} onClick={() => handle.value?.zoomBy(1 / 1.25)}>−</button>
      {state && <output aria-label="Magnification">{state.zoomPercent}%</output>}
      <button type="button" disabled={!handle.value} aria-label={t('canvas.inspection.magnify')} onClick={() => handle.value?.zoomBy(1.25)}>+</button>
      </div>
      <button type="button" className={styles.recenter} title="Center on canvas" aria-label="Center inspection on canvas" onClick={() => {
        const host = canvasRef.current
        if (!host || !state) return
        handle.value?.panBy({ x: (host.clientWidth / 2 - viewport.x) / viewport.scale - state.point.x, y: (host.clientHeight / 2 - viewport.y) / viewport.scale - state.point.y })
      }}><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><circle cx="8" cy="8" r="4" /><path d="M8 1v4M8 11v4M1 8h4M11 8h4" /></svg></button>
    </div>
    {state?.plants.length === 0 && <p>No plants in this view. Drag to another area or zoom out.</p>}
    <p className={styles.hint}>Drag to explore · Arrow keys pan · Click a name to center</p>
  </section></>
}
