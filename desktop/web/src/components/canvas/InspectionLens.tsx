import { createPortal } from 'preact/compat'
import { SurfaceHeader } from '../shared/SurfaceHeader'
import type { ReadonlySignal } from '@preact/signals'
import type { RefObject } from 'preact'
import { useId, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import type { CanvasInspectionHandle, InspectionSourceQuad } from '../../canvas/inspection'
import { detectPlatform, modKeyIsCmd } from '../../canvas/runtime/input/platform'
import type { CanvasDocumentSurface, CanvasQuerySurface } from '../../canvas/runtime/runtime'
import { currentCanvasDocumentSurface, currentCanvasQuerySurface } from '../../canvas/session'
import { modKeyName } from '../../app/shell-commands/shortcut-text'
import { phoneLayout } from '../../app/shell/phone-layout'
import { t } from '../../i18n'
import { ControlIcon } from '../shared/ControlIcon'
import { ButtonTooltip } from '../shared/ButtonTooltip'
import { useMapOccluder, useUnderRail } from '../shared/useMapChrome'
import styles from './InspectionLens.module.css'

/** The lens's arrow steps in preview pixels: plain, and with mod (Cmd on macOS, else Ctrl; spec §4.13). */
const ARROW_STEP_PX = 20
const LARGE_ARROW_STEP_PX = 60
const MOD_IS_CMD = typeof navigator !== 'undefined'
  && modKeyIsCmd(detectPlatform(navigator, window as unknown as { readonly GestureEvent?: unknown }))

export function InspectionLens({ canvasRef }: { canvasRef: RefObject<HTMLDivElement> }) {
  const documents = currentCanvasDocumentSurface.value
  const queries = currentCanvasQuerySurface.value
  const [open, setOpen] = useState(false)
  const launcher = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)
  const id = useId()
  // Opening hands focus to the map host, not the lens (U34, canopi-f47t.24): the launcher hides as the lens opens, and the
  // map keeps its arrows and Esc until a click or Tab moves focus into the lens. Closing returns focus to the launcher.
  useLayoutEffect(() => {
    if (open && !wasOpen.current) canvasRef.current?.focus({ preventScroll: true })
    if (wasOpen.current && !open) launcher.current?.focus()
    wasOpen.current = open
  }, [open])
  // The launcher sits in the panel rail's column; the rail ends above it.
  useUnderRail(launcher, 'panel', !!documents && !!queries)
  if (!documents || !queries) return null
  return <>
    <button ref={launcher} type="button" className={styles.launcher} hidden={open} aria-expanded={open} aria-controls={id} data-inspection-launcher
      aria-label={t('canvas.inspection.title')} onClick={() => setOpen(!open)}>
      <ControlIcon name="search" size={20} />
      <ButtonTooltip label={t('canvas.inspection.title')} side="left" />
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
  // The open panel covers the map's left edge: Home, Fit and framing land right of it (canopi-f47t.28). Not on a phone,
  // where it spans nearly the whole width and would push the chips and credits off screen.
  useMapOccluder(panel, 'left', phoneLayout.value === null)
  useLayoutEffect(() => {
    if (!preview.current) return
    let view: CanvasInspectionHandle
    try { view = documents.attachInspectionTo(preview.current) }
    catch (error) { console.error('Unable to open the inspection lens:', error); failed.value = true; return }
    handle.value = view
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
      if (!drag || event.pointerId !== drag.id) return
      event.preventDefault()
      view.panByScreen({ x: drag.x - event.clientX, y: drag.y - event.clientY })
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
    // The pointer's world point over the map (the interaction session's hovers, not over the canvas's own buttons and
    // fields); the lens keeps its point when the pointer leaves or presses.
    const stopInspecting = queries.subscribePointerWorld((point) => {
      if (drag || !point) return
      view.inspectAtWorldPoint(point.world)
    })
    frame?.addEventListener('pointerdown', start)
    frame?.addEventListener('lostpointercapture', end)
    return () => {
      stop()
      stopInspecting()
      frame?.removeEventListener('pointerdown', start)
      frame?.removeEventListener('lostpointercapture', end)
      handle.value = null; view.dispose()
    }
  }, [documents, queries])
  const state = handle.value?.state.value
  const expandLabel = t(expanded ? 'canvas.inspection.compact' : 'canvas.inspection.expand')
  return <>
    {handle.value && canvasRef.current && <SourceOutline quad={handle.value.sourceQuad} host={canvasRef.current} />}
    <section ref={panel} id={id} className={styles.panel} data-expanded={expanded} aria-label={t('canvas.inspection.title')}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() } }}>
    <SurfaceHeader title={t('canvas.inspection.title')} closeLabel={t('canvas.inspection.close')} onClose={onClose}
      actions={<button type="button" className={styles.expandButton} aria-label={expandLabel}
        aria-pressed={expanded} onClick={() => setExpanded(!expanded)}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
          <path d={expanded ? 'M14 2 9 7m0-4v4h4M2 14l5-5m0 4V9H3' : 'M9 7l5-5m-4 0h4v4M7 9l-5 5m0-4v4h4'} />
        </svg>
        <ButtonTooltip label={expandLabel} side="left" />
      </button>} />
    {/* The preview owns its arrows, Shift+arrows included, so they never turn the map (spec §1.6). Its arrows and drags
        move the lens along its own screen, which turns with the map; mod is the large step, Shift adds nothing. */}
    <div className={styles.preview} data-inspection-frame data-owns-keys="arrows" role="group" tabIndex={0}
      aria-label={t('canvas.inspection.panHint', { mod: modKeyName(t) })}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return
        const step = (MOD_IS_CMD ? event.metaKey : event.ctrlKey) ? LARGE_ARROW_STEP_PX : ARROW_STEP_PX
        const delta = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 },
          ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } }[event.key]
        if (!delta) return
        event.preventDefault(); event.stopPropagation(); handle.value?.panByScreen(delta)
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
      <button type="button" disabled={!handle.value} aria-label={t('canvas.inspection.recenter')} onClick={() => handle.value?.centerOnCanvas()}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="4" stroke="currentColor" /><path d="M8 1v4m0 6v4M1 8h4m6 0h4" stroke="currentColor" /></svg>
        <ButtonTooltip label={t('canvas.inspection.recenter')} side="top" />
      </button>
      <button type="button" disabled={!handle.value} aria-label={t('canvas.inspection.widen')} onClick={() => handle.value?.zoomBy(1 / 1.25)}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M3 7h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
        <ButtonTooltip label={t('canvas.inspection.widen')} side="top" />
      </button>
      {state && <span>{state.zoomPercent}%</span>}
      <button type="button" disabled={!handle.value} aria-label={t('canvas.inspection.magnify')} onClick={() => handle.value?.zoomBy(1.25)}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M7 3v8M3 7h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
        <ButtonTooltip label={t('canvas.inspection.magnify')} side="top" />
      </button>
    </div>
    {state?.plants.length === 0 && <p>{t('canvas.inspection.empty')}</p>}
    <p>{t('canvas.inspection.hint')}</p>
  </section></>
}

/**
 * Where the lens samples, outlined on the main map. Its own component: the quad follows every main-map frame, and only this
 * outline re-renders for it. The four corners are drawn as published, so a turned view needs no change here.
 */
function SourceOutline({ quad, host }: { quad: ReadonlySignal<InspectionSourceQuad | null>; host: HTMLElement }) {
  const corners = quad.value
  if (!corners) return null
  return createPortal(<svg className={styles.source} aria-hidden="true" data-inspection-source>
    <polygon points={corners.map((corner) => `${corner.x},${corner.y}`).join(' ')} />
  </svg>, host)
}
