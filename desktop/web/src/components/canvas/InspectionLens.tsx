import { createPortal } from 'preact/compat'
import { SurfaceHeader } from '../shared/SurfaceHeader'
import type { RefObject } from 'preact'
import { useId, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { useSignal, useSignalEffect } from '@preact/signals'
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
    <button ref={launcher} type="button" className={styles.launcher} aria-expanded={open} aria-controls={id}
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
    return () => { handle.value = null; view.dispose() }
  }, [documents])
  useSignalEffect(() => {
    const view = handle.value, host = canvasRef.current
    if (!view || !host) return
    let rect = host.getBoundingClientRect()
    const refreshRect = () => { rect = host.getBoundingClientRect() }
    const inspect = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('button, input, [role="dialog"]')) return
      if (event.type === 'pointermove' && event.buttons !== 0) return
      const viewport = queries.viewport.peek().viewport
      view.inspect({ x: (event.clientX - rect.left - viewport.x) / viewport.scale,
        y: (event.clientY - rect.top - viewport.y) / viewport.scale })
    }
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(refreshRect)
    resize?.observe(host)
    host.addEventListener('pointerenter', refreshRect)
    host.addEventListener('pointermove', inspect)
    host.addEventListener('pointerup', inspect)
    window.addEventListener('resize', refreshRect)
    return () => {
      resize?.disconnect()
      host.removeEventListener('pointerenter', refreshRect)
      host.removeEventListener('pointermove', inspect)
      host.removeEventListener('pointerup', inspect)
      window.removeEventListener('resize', refreshRect)
    }
  })
  const state = handle.value?.state.value
  const viewport = queries.viewport.value.viewport
  return <>
    {state && canvasRef.current && createPortal(<svg className={styles.source} aria-hidden="true" data-inspection-source>
      <rect x={viewport.x + (state.point.x - state.frame.width / state.scale / 2) * viewport.scale}
        y={viewport.y + (state.point.y - state.frame.height / state.scale / 2) * viewport.scale}
        width={state.frame.width / state.scale * viewport.scale}
        height={state.frame.height / state.scale * viewport.scale}
        data-held={state.held} />
    </svg>, canvasRef.current)}
    <section ref={panel} id={id} className={styles.panel} data-expanded={expanded} aria-label={t('canvas.inspection.title')}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() } }}>
    <SurfaceHeader title={t('canvas.inspection.title')} closeLabel={t('canvas.inspection.close')} onClose={onClose}
      actions={<button type="button" className={styles.expandButton} aria-label={t(expanded ? 'canvas.inspection.compact' : 'canvas.inspection.expand')}
        aria-pressed={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '↙' : '↗'}</button>} />
    <div className={styles.controls}>
      <div className={styles.modes}>
        <button type="button" disabled={!handle.value} aria-pressed={!state?.held}
          onClick={() => handle.value?.setHeld(false)}>{t('canvas.inspection.follow')}</button>
        <button type="button" disabled={!handle.value} aria-pressed={state?.held ?? false}
          onClick={() => handle.value?.setHeld(true)}>{t('canvas.inspection.hold')}</button>
      </div>
      <span role="status">{t(state?.held ? 'canvas.inspection.held' : 'canvas.inspection.following')}</span>
    </div>
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
      <button type="button" disabled={!handle.value} aria-label={t('canvas.inspection.widen')} onClick={() => handle.value?.zoomBy(1 / 1.25)}>−</button>
      {state && <span>{state.zoomPercent}%</span>}
      <button type="button" disabled={!handle.value} aria-label={t('canvas.inspection.magnify')} onClick={() => handle.value?.zoomBy(1.25)}>+</button>
    </div>
    {state?.plants.length === 0 && <p>{t('canvas.inspection.empty')}</p>}
    <p>{t('canvas.inspection.hint')}</p>
  </section></>
}
