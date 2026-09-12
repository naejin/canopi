import { createPortal } from 'preact/compat'
import { SurfaceHeader } from '../shared/SurfaceHeader'
import type { RefObject } from 'preact'
import { useId, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import type { CanvasInspectionHandle } from '../../canvas/inspection'
import type { CanvasDocumentSurface, CanvasQuerySurface } from '../../canvas/runtime/runtime'
import { currentCanvasDocumentSurface, currentCanvasQuerySurface } from '../../canvas/session'
import { t } from '../../i18n'
import styles from './InspectionLens.module.css'

export function InspectionLens({ canvasRef }: { canvasRef: RefObject<HTMLDivElement> }) {
  const documents = currentCanvasDocumentSurface.value
  const queries = currentCanvasQuerySurface.value
  const [open, setOpen] = useState(false)
  const launcher = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)
  const id = useId()
  useLayoutEffect(() => {
    if (wasOpen.current && !open) launcher.current?.focus()
    wasOpen.current = open
  }, [open])
  if (!documents || !queries) return null
  return <>
    <button ref={launcher} type="button" className={styles.launcher} hidden={open} aria-expanded={open} aria-controls={id}
      onClick={() => setOpen(!open)}>
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.4" /><path d="m10 10 4 4" stroke="currentColor" strokeWidth="1.4" /></svg>
      {t('canvas.inspection.title')}
    </button>
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
  useLayoutEffect(() => {
    if (!preview.current) return
    let view: CanvasInspectionHandle
    try { view = documents.attachInspectionTo(preview.current) }
    catch (error) { console.error('Unable to open the inspection lens:', error); failed.value = true; return }
    handle.value = view
    panel.current?.querySelector<HTMLElement>('[data-inspection-frame]')?.focus()
    const frame = panel.current?.querySelector<HTMLElement>('[data-inspection-frame]')
    let drag: { id: number; x: number; y: number } | null = null
    const stop = () => {
      const previous = drag
      drag = null
      frame?.removeAttribute('data-dragging')
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', end)
      document.removeEventListener('pointercancel', end)
      window.removeEventListener('blur', stop)
      if (previous && frame?.hasPointerCapture?.(previous.id)) {
        try { frame.releasePointerCapture(previous.id) } catch { /* Capture can end during element teardown. */ }
      }
    }
    const move = (event: PointerEvent) => {
      const state = view.state.peek()
      if (!drag || event.pointerId !== drag.id || !state) return
      event.preventDefault()
      view.panBy({ x: (drag.x - event.clientX) / state.scale, y: (drag.y - event.clientY) / state.scale })
      drag.x = event.clientX; drag.y = event.clientY
    }
    const end = (event: PointerEvent) => { if (event.pointerId === drag?.id) stop() }
    const start = (event: PointerEvent) => {
      if (event.button !== 0 || drag || !view.state.peek() || (event.target instanceof Element && event.target.closest('button'))) return
      event.preventDefault(); event.stopPropagation(); frame?.focus()
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY }
      frame?.setAttribute('data-dragging', 'true')
      try { frame?.setPointerCapture(event.pointerId) } catch { /* Document listeners also support hosts without capture. */ }
      document.addEventListener('pointermove', move)
      document.addEventListener('pointerup', end)
      document.addEventListener('pointercancel', end)
      window.addEventListener('blur', stop)
    }
    const host = canvasRef.current
    const inspectPointer = (event: PointerEvent) => {
      if (drag || event.buttons !== 0 || !host) return
      if (event.target instanceof Element && event.target.closest('button, input, select, textarea, [contenteditable="true"], [data-preserve-overlays="true"]')) return
      const bounds = host.getBoundingClientRect()
      view.inspectAtScreenPoint({ x: event.clientX - bounds.left, y: event.clientY - bounds.top })
    }
    host?.addEventListener('pointermove', inspectPointer, true)
    frame?.addEventListener('pointerdown', start)
    frame?.addEventListener('lostpointercapture', end)
    return () => {
      stop()
      host?.removeEventListener('pointermove', inspectPointer, true)
      frame?.removeEventListener('pointerdown', start)
      frame?.removeEventListener('lostpointercapture', end)
      handle.value = null; view.dispose()
    }
  }, [documents, canvasRef])
  const state = handle.value?.state.value
  const viewport = queries.viewport.value.viewport
  return <>
    {state && canvasRef.current && createPortal(<svg className={styles.source} aria-hidden="true" data-inspection-source>
      <rect x={viewport.x + (state.point.x - state.frame.width / state.scale / 2) * viewport.scale}
        y={viewport.y + (state.point.y - state.frame.height / state.scale / 2) * viewport.scale}
        width={state.frame.width / state.scale * viewport.scale}
        height={state.frame.height / state.scale * viewport.scale} />
    </svg>, canvasRef.current)}
    <section ref={panel} id={id} className={styles.panel} data-expanded={expanded} aria-label={t('canvas.inspection.title')}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() } }}>
    <SurfaceHeader title={t('canvas.inspection.title')} closeLabel={t('canvas.inspection.close')} onClose={onClose}
      actions={<button type="button" className={styles.expandButton} aria-label={t(expanded ? 'canvas.inspection.compact' : 'canvas.inspection.expand')}
        aria-pressed={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '↙' : '↗'}</button>} />
    <div className={styles.preview} data-inspection-frame role="group" tabIndex={0} aria-label={t('canvas.inspection.panHint')}
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
      <span role="status">{t('canvas.inspection.namesCount', { shown: state?.plants.filter(plant => plant.label).length ?? 0, total: state?.plants.length ?? 0 })}</span>
      <button type="button" disabled={!handle.value} aria-label={t('canvas.inspection.recenter')} title={t('canvas.inspection.recenter')} onClick={() => handle.value?.centerOnCanvas()}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="4" stroke="currentColor" /><path d="M8 1v4m0 6v4M1 8h4m6 0h4" stroke="currentColor" /></svg>
      </button>
      <button type="button" disabled={!handle.value} aria-label={t('canvas.inspection.widen')} onClick={() => handle.value?.zoomBy(1 / 1.25)}>−</button>
      {state && <span>{state.zoomPercent}%</span>}
      <button type="button" disabled={!handle.value} aria-label={t('canvas.inspection.magnify')} onClick={() => handle.value?.zoomBy(1.25)}>+</button>
    </div>
    {state?.plants.length === 0 && <p>{t('canvas.inspection.empty')}</p>}
    <p>{t('canvas.inspection.hint')}</p>
  </section></>
}
