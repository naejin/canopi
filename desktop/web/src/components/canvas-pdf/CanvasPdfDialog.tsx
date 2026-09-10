import { useEffect, useRef, useState } from 'preact/hooks'
import { canvasPdf } from '../../app/canvas-pdf/live'
import type { PdfWorkflow } from '../../app/canvas-pdf/workflow'
import { type PdfPlan, type PdfPaper } from '../../app/canvas-pdf/types'
import { t } from '../../i18n'
import { Dropdown } from '../shared/Dropdown'
import { PdfPageEditor } from './PdfPageEditor'
import { PdfPageRail } from './PdfPageRail'
import { PdfPageToolbar } from './PdfPageToolbar'
import styles from './canvas-pdf.module.css'

export function CanvasPdfDialog({ workflow = canvasPdf }: { readonly workflow?: PdfWorkflow }) {
  if (!workflow.open.value) return null
  return <PrintWorkspace workflow={workflow} />
}
function PrintWorkspace({ workflow }: { readonly workflow: PdfWorkflow }) {
  const root = useRef<HTMLElement>(null)
  const [pageId, setPageId] = useState('overview')
  const lastPlan = useRef<PdfPlan>()
  const [adding, setAdding] = useState(false)
  const [inspecting, setInspecting] = useState(false)
  const [hoveredPage, setHoveredPage] = useState<string | null>(null)
  const returnPage = useRef('overview')
  const focusPage = useRef<string | null>(null)
  const splitPreview = workflow.splitPreview.value
  const state = workflow.state.value, setup = splitPreview ?? workflow.setup.value
  if (state.result) lastPlan.current = state.result.plan
  const plan = state.result?.plan ?? (state.status === 'preparing' ? lastPlan.current : undefined)
  const delivering = state.status === 'delivering', preparing = state.status === 'preparing'
  const page = adding ? plan?.pickerPage ?? plan?.pages[0] : plan?.pages.find((page) => page.id === pageId)
    ?? (!preparing ? plan?.pages.find((page) => page.id === pageId.split(':legend:')[0]) ?? plan?.pages[0] : undefined)
  const disabled = delivering || preparing
  useEffect(() => {
    const previous = document.activeElement
    root.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  useEffect(() => {
    if (page && focusPage.current === page.id && !preparing) {
      root.current?.querySelector<SVGSVGElement>('[data-pdf-editor]')?.focus(); focusPage.current = null
    }
  }, [page, preparing])
  useEffect(() => {
    if (page && !adding && !preparing && page.id !== pageId) setPageId(page.id)
  }, [page, adding, preparing, pageId])
  function selectPage(id: string) { workflow.prioritize(id); setPageId(id); setAdding(false); setInspecting(false) }
  function beginAdd() { focusPage.current = 'overview'; returnPage.current = pageId; setAdding(true); setInspecting(false); setPageId('overview') }
  function openCreatedPage(id: string) { focusPage.current = id; selectPage(id) }
  function cancelAdd() { focusPage.current = returnPage.current; setAdding(false); setPageId(returnPage.current) }
  function keyDown(event: KeyboardEvent) {
    event.stopPropagation()
    if (event.key === 'Escape') {
      if (root.current?.querySelector('[aria-expanded="true"]')) return
      event.preventDefault()
      if (splitPreview) { workflow.cancelSplit(); selectPage('overview') }
      else if (adding) cancelAdd()
      else if (inspecting) setInspecting(false)
      else workflow.close()
    }
    if (event.key === 'Tab') {
      const items = Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]') ?? [])
      const first = items[0], last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
  }
  return <div className={styles.overlay}>
    <section ref={root} role="dialog" aria-modal="true" aria-labelledby="canvas-pdf-title" className={styles.workspace}
      data-preserve-overlays="true" onKeyDown={keyDown}>
      <header className={styles.header}>
        <button type="button" disabled={delivering} onClick={() => workflow.close()}>← {t('pdf.backToDesign')}</button>
        <h2 id="canvas-pdf-title">{t('pdf.title')}</h2>
        <div className={styles.documentTools}>
          <fieldset disabled={delivering || !!splitPreview} className={styles.toolbarGroup}><Dropdown<PdfPaper> ariaLabel={t('pdf.paper')} trigger={setup.paper} value={setup.paper}
            items={[{ value: 'A4', label: 'A4' }, { value: 'Letter', label: 'US Letter' }]}
            onChange={(paper) => workflow.configure({ paper })} preserveOverlays /></fieldset>
          <LayerSettings workflow={workflow} disabled={delivering || !!splitPreview} />
        </div>
        <button type="button" aria-label={t('pdf.export')} className={styles.primary}
          disabled={preparing || delivering || !!splitPreview || !!plan?.blocked || !state.result?.bytes} onClick={() => void workflow.save()}>
          {t('pdf.export')} <span aria-hidden="true" className={styles.exportCount}>{plan?.pages.length ?? '·'}</span>
        </button>
      </header>
      <div className={styles.body}>
        <aside className={styles.sidebar}>
          {adding ? <button type="button" onClick={cancelAdd}>← {t('pdf.cancel')}</button>
            : <button type="button" className={styles.addPage} aria-label={t('pdf.addPage')} disabled={disabled || !!splitPreview || !plan?.pages.length}
              onClick={beginAdd}>+ {t('pdf.addPage')}</button>}
          {adding && <button type="button" disabled={disabled} onClick={() => { const id = workflow.addWholeDesign(); if (id) openCreatedPage(id) }}>{t('pdf.wholeDesign')}</button>}
          <PdfPageRail plan={plan} setup={setup} selected={pageId} disabled={delivering || !!splitPreview} onSelect={selectPage}
            onHover={setHoveredPage} onRemove={(id) => { workflow.removeArea(id); if (pageId === id || page?.sourceId === id) selectPage('overview') }} />
        </aside>
        <main className={styles.preview}>
          <div className={styles.previewHeading}>
            <strong>{adding ? t('pdf.addPage') : page?.areaName ?? (page?.kind === 'legend' ? plan?.pages.find((source) => source.id === page.sourceId)?.number + ' · ' + t('pdf.keyAndNotes') : t('pdf.overview'))}</strong>
            <span role="status">{preparing ? t('pdf.preparing') : page ? t('pdf.pageCount', { page: page.number, count: plan!.pages.length }) : ''}</span>
          </div>
          {splitPreview && <div className={styles.notice} role="status">
            <span>{preparing ? t('pdf.preparing') : t('pdf.splitPreview', { count: plan?.pages.length ?? 0 })}</span>
            <button type="button" className={styles.primary} disabled={disabled || !!state.error} onClick={() => workflow.applySplit()}>{t('pdf.applySheets')}</button>
            <button type="button" onClick={() => { workflow.cancelSplit(); selectPage('overview') }}>{t('pdf.cancel')}</button>
          </div>}
          {page && !adding && !splitPreview && <PdfPageToolbar key={page.id} page={page} workflow={workflow} disabled={delivering} inspecting={inspecting} onSplit={disabled ? undefined : () => { workflow.previewSplit(page.id); selectPage('overview') }} onInspect={() => setInspecting(!inspecting)} />}
          <p id="pdf-editor-hint" className={styles.editorHint}>{t(splitPreview ? 'pdf.splitHint' : adding ? 'pdf.addHint' : inspecting || page?.kind === 'legend' ? 'pdf.inspectHint' : page?.kind === 'overview' && (setup.areas?.length ?? 0) > 0 ? 'pdf.overviewHint' : 'pdf.frameHint')}</p>
          <div className={styles.paper} aria-busy={preparing}>
            {page && plan && <PdfPageEditor page={page} plan={plan} adding={adding} inspecting={inspecting} navigationOnly={!!splitPreview} disabled={disabled}
              highlightedPage={hoveredPage} onPage={selectPage}
              onPrintArea={(bounds) => { const id = workflow.addPrintArea(bounds); if (id) openCreatedPage(id) }}
              onMove={(delta) => {
                const offset = setup.views?.[page.id]?.offset ?? { x: 0, y: 0 }
                workflow.setPageView(page.id, { offset: { x: offset.x + delta.x, y: offset.y + delta.y } })
              }} />}
          </div>
          {state.error && <div role="alert" className={styles.notice}><span>{t(`pdf.errors.${state.error}`)}</span>
            {state.error !== 'selection-missing' && <button type="button" disabled={delivering} onClick={() => void (state.error === 'delivery-failed' ? workflow.save() : workflow.rebuild())}>{t('pdf.retry')}</button>}</div>}
          {plan?.blocked === 'empty' && <p role="status" className={styles.notice}>{t('pdf.empty')}</p>}
        </main>
      </div>
      <footer className={styles.footer}>
        <span>{t('pdf.actualSize')}</span>
        <span role="status">{state.status === 'saved' ? t('pdf.saved') : state.status === 'downloaded' ? t('pdf.downloaded') : ''}</span>
      </footer>
    </section>
  </div>
}
function LayerSettings({ workflow, disabled }: { readonly workflow: PdfWorkflow; readonly disabled: boolean }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const layers = Array.from(new Set([...workflow.availableLayers.value, ...workflow.setup.value.layers]))
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('pointerup', close)
    return () => document.removeEventListener('pointerup', close)
  }, [open])
  return <div ref={root} className={styles.layerControl} onFocusOut={(event) => {
    if (!(event.relatedTarget instanceof Node) || !root.current?.contains(event.relatedTarget)) setOpen(false)
  }} onKeyDown={(event) => {
    if (open && event.key === 'Escape') { event.stopPropagation(); setOpen(false); root.current?.querySelector('button')?.focus() }
  }}>
    <button type="button" aria-label={t('pdf.layers')} aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)}>
      {t('pdf.layers')} · {workflow.setup.value.layers.length}
    </button>
    {open && <fieldset className={styles.layerPopover} disabled={disabled}><legend>{t('pdf.layers')}</legend>
      {layers.map((name) => <label key={name} className={styles.check}>
        <input type="checkbox" checked={workflow.setup.value.layers.includes(name)} onChange={(event) => workflow.selectLayer(name, event.currentTarget.checked)} />
        <span>{t(`canvas.layers.${name}`, { defaultValue: name })}</span>
      </label>)}
    </fieldset>}
  </div>
}
