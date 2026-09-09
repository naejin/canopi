import { useEffect, useRef, useState } from 'preact/hooks'
import { canvasPdf } from '../../app/canvas-pdf/live'
import type { PdfWorkflow } from '../../app/canvas-pdf/workflow'
import { PDF_ZOOM, pdfAreaKey, type PdfPage, type PdfPlan, type PdfOrientation, type PdfPaper } from '../../app/canvas-pdf/types'
import { t } from '../../i18n'
import { Dropdown } from '../shared/Dropdown'
import { PdfPagePreview } from './PdfPagePreview'
import styles from './canvas-pdf.module.css'

export function CanvasPdfDialog({ workflow = canvasPdf }: { readonly workflow?: PdfWorkflow }) {
  if (!workflow.open.value) return null
  return <DialogContent workflow={workflow} />
}
function DialogContent({ workflow }: { readonly workflow: PdfWorkflow }) {
  const root = useRef<HTMLElement>(null)
  const [pageId, setPageId] = useState('overview')
  const lastPlan = useRef<PdfPlan>()
  const [zoom, setZoom] = useState(0)
  const [drawing, setDrawing] = useState(false)
  const state = workflow.state.value
  const setup = workflow.setup.value
  if (state.result) lastPlan.current = state.result.plan
  const plan = state.result?.plan ?? (state.status === 'preparing' ? lastPlan.current : undefined)
  const currentIndex = Math.max(0, plan?.pages.findIndex((page) => page.id === pageId) ?? 0)
  const page = plan?.pages[currentIndex]
  const delivering = state.status === 'delivering'
  const layers = Array.from(new Set([...workflow.availableLayers.value, ...setup.layers]))
  const selectedZones = (setup.areas ?? []).filter((area) => area.kind === 'zone').map((area) => area.name)
  const zones = Array.from(new Set([...workflow.availableZones.value, ...selectedZones]))
  useEffect(() => {
    const previous = document.activeElement
    root.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  function keyDown(event: KeyboardEvent) {
    // Keyboard actions belong to this dialog while it owns focus.
    event.stopPropagation()
    if (event.key === 'Escape') {
      if (drawing) { event.preventDefault(); setDrawing(false); return }
      if (root.current?.querySelector('[aria-expanded="true"]')) return
      event.preventDefault(); event.stopPropagation(); workflow.close()
    }
    if (event.key === 'Tab') {
      const items = Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]') ?? [])
      const first = items[0], last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
  }
  return <div className={styles.overlay}>
    <section ref={root} role="dialog" aria-modal="true" aria-labelledby="canvas-pdf-title" className={styles.dialog}
      data-preserve-overlays="true" onKeyDown={keyDown}>
      <header className={styles.header}>
        <div><h2 id="canvas-pdf-title">{t('pdf.title')}</h2><p>{t('pdf.intro')}</p></div>
        <button type="button" disabled={delivering} onClick={() => workflow.close()}>{t('window.close')}</button>
      </header>
      <div className={styles.body}>
        <aside className={styles.controls}>
          <fieldset disabled={delivering}>
            <legend>{t('pdf.paper')}</legend>
            <Dropdown<PdfPaper> ariaLabel={t('pdf.paper')} trigger={setup.paper} value={setup.paper}
              items={[{ value: 'A4', label: 'A4' }, { value: 'Letter', label: 'US Letter' }]}
              onChange={(paper) => workflow.configure({ paper })} preserveOverlays />
          </fieldset>
          {page && <PageControls key={page.id} page={page} workflow={workflow} disabled={delivering} />}
          <fieldset disabled={delivering}>
            <legend>{t('pdf.layers')}</legend>
            {layers.map((name) => <label key={name} className={styles.check}>
              <input type="checkbox" checked={setup.layers.includes(name)} onChange={(event) => workflow.selectLayer(name, event.currentTarget.checked)} />
              <span>{t(`canvas.layers.${name}`, { defaultValue: name })}</span>
            </label>)}
          </fieldset>
          <fieldset disabled={delivering}>
            <legend>{t('pdf.zones')}</legend>
            {zones.map((name) => {
              const area = (setup.areas ?? []).find((area) => area.kind === 'zone' && area.name === name)
              return <div key={name} className={styles.areaRow}>
                <label className={styles.check}>
                  <input type="checkbox" checked={!!area} onChange={(event) => { workflow.selectZone(name, event.currentTarget.checked); if (event.currentTarget.checked) { setDrawing(false); setPageId(pdfAreaKey({ kind: 'zone', name })) } }} />
                  <span>{name}</span>
                </label>
                {area && <button type="button" aria-label={`${t('pdf.viewPage')}: ${name}`} onClick={() => { setDrawing(false); setPageId(pdfAreaKey(area)) }}>↗</button>}
              </div>
            })}
            {!zones.length && <p>{t('pdf.noZones')}</p>}
          </fieldset>
          <fieldset disabled={delivering}>
            <legend>{t('pdf.printAreas')}</legend>
            {(setup.areas ?? []).filter((area) => area.kind === 'rectangle').map((area) => <div key={pdfAreaKey(area)} className={styles.areaRow}>
              <button type="button" className={styles.areaName} aria-label={`${t('pdf.viewPage')}: ${area.name}`} onClick={() => { setDrawing(false); setPageId(pdfAreaKey(area)) }}>{area.name}</button>
              <button type="button" aria-label={`${t('pdf.removeArea')}: ${area.name}`} onClick={() => workflow.removeArea(pdfAreaKey(area))}>×</button>
            </div>)}
            <button type="button" aria-pressed={drawing} disabled={!plan?.pages.length || state.status === 'preparing'} onClick={() => { setPageId('overview'); setDrawing(!drawing) }}>{t('pdf.drawArea')}</button>
            {drawing && <p role="status">{t('pdf.drawHint')}</p>}
          </fieldset>
          {(plan?.hasLegendOverflow || setup.continuations) && <label className={styles.check}>
            <input type="checkbox" checked={setup.continuations ?? false} disabled={delivering}
              onChange={(event) => workflow.configure({ continuations: event.currentTarget.checked })} />
            <span>{t('pdf.continuations')}</span>
          </label>}
          <button type="button" disabled={delivering} onClick={() => void workflow.rebuild()}>{t('pdf.refresh')}</button>
          {state.error && <p role="alert" className={styles.notice}>{t(`pdf.errors.${state.error}`)}</p>}
          {plan?.blocked === 'empty' && <p role="status">{t('pdf.empty')}</p>}
          {plan?.blocked === 'legend-overflow' && <p role="alert" className={styles.notice}>{t('pdf.overflow')}</p>}
          {page && page.ambiguousSpecies.length > 0 && <p className={styles.notice}>{t('pdf.ambiguous')}</p>}
        </aside>
        <div className={styles.preview}>
          <div className={styles.previewTools}>
            <button type="button" aria-label={t('pdf.previous')} disabled={!page || currentIndex === 0} onClick={() => { setDrawing(false); setPageId(plan!.pages[currentIndex - 1]!.id) }}>‹</button>
            <span>{page ? t('pdf.pageCount', { page: page.number, count: plan!.pages.length }) : t('pdf.overview')}</span>
            <button type="button" aria-label={t('pdf.next')} disabled={!page || currentIndex >= plan!.pages.length - 1} onClick={() => { setDrawing(false); setPageId(plan!.pages[currentIndex + 1]!.id) }}>›</button>
            <Dropdown<number> ariaLabel={t('pdf.zoom')} trigger={zoom ? `${zoom}%` : t('pdf.fit')} value={zoom}
              items={[{ value: 0, label: t('pdf.fit') }, ...[75, 100, 150, 200].map((value) => ({ value, label: `${value}%` }))]}
              onChange={setZoom} preserveOverlays />
          </div>
          <div className={styles.paper} aria-busy={state.status === 'preparing'}>
            {page && plan ? <PdfPagePreview page={page} plan={plan} zoom={zoom} drawing={drawing && state.status !== 'preparing'} onPrintArea={(bounds) => { setDrawing(false); const id = workflow.addPrintArea(bounds); if (id) setPageId(id) }} /> : state.status === 'preparing' ? <p role="status">{t('pdf.preparing')}</p> : null}
          </div>
        </div>
      </div>
      <footer className={styles.footer}>
        <p role="status">{state.status === 'saved' ? t('pdf.saved') : state.status === 'downloaded' ? t('pdf.downloaded') : t('pdf.actualSize')}</p>
        <button type="button" className={styles.primary} disabled={delivering || !!plan?.blocked || !state.result?.bytes}
          onClick={() => void workflow.save()}>{t('pdf.export')}</button>
      </footer>
    </section>
  </div>
}

function PageControls({ page, workflow, disabled }: { readonly page: PdfPage; readonly workflow: PdfWorkflow; readonly disabled: boolean }) {
  const view = workflow.setup.value.views?.[page.id]
  const orientation = view?.orientation ?? 'auto'
  const zoom = view?.zoom ?? 100
  const [draft, setDraft] = useState(String(zoom))
  useEffect(() => { setDraft(String(zoom)) }, [zoom])
  function commit(input: HTMLInputElement) {
    if (!input.validity.valid || !Number.isFinite(input.valueAsNumber)) { setDraft(String(zoom)); return }
    workflow.setPageView(page.id, { zoom: input.valueAsNumber })
  }
  return <fieldset disabled={disabled} className={styles.pageControls}>
    <legend>{t('pdf.pageSettings')} · {page.areaName ?? (page.kind === 'overview' ? t('pdf.overview') : `${t('pdf.pageLabel')} ${page.number}`)}</legend>
    <span>{t('pdf.orientation')}</span>
    <Dropdown<PdfOrientation> ariaLabel={t('pdf.orientation')}
      trigger={orientation === 'auto' ? `${t('pdf.auto')} (${t(page.width > page.height ? 'pdf.landscape' : 'pdf.portrait')})` : t(`pdf.${orientation}`)} value={orientation}
      items={(['auto', 'portrait', 'landscape'] as const).map((value) => ({ value, label: t(`pdf.${value}`) }))}
      onChange={(orientation) => workflow.setPageView(page.id, { orientation })} preserveOverlays />
    {page.kind !== 'legend' && <>
      <label className={styles.zoomLabel}>
        <span>{t('pdf.canvasZoom')}</span>
        <input type="number" min={PDF_ZOOM.min} max={PDF_ZOOM.max} step="any" required value={draft}
          onInput={(event) => setDraft(event.currentTarget.value)} onBlur={(event) => commit(event.currentTarget)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit(event.currentTarget) } }} />
      </label>
      <button type="button" onClick={() => { setDraft('100'); workflow.setPageView(page.id, { zoom: 100 }) }}>{t('pdf.resetFit')}</button>
      <p>{t('pdf.zoomHint')}</p>
    </>}
  </fieldset>
}
