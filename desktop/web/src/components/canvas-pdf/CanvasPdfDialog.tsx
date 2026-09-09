import { useEffect, useRef, useState } from 'preact/hooks'
import { canvasPdf } from '../../app/canvas-pdf/live'
import type { PdfWorkflow } from '../../app/canvas-pdf/workflow'
import type { PdfOrientation, PdfPaper } from '../../app/canvas-pdf/types'
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
  const [index, setIndex] = useState(0)
  const [zoom, setZoom] = useState(0)
  const state = workflow.state.value
  const setup = workflow.setup.value
  const plan = state.result?.plan
  const page = plan?.pages[Math.min(index, plan.pages.length - 1)]
  const delivering = state.status === 'delivering'
  const layers = Array.from(new Set([...workflow.availableLayers.value, ...setup.layers]))
  useEffect(() => {
    const previous = document.activeElement
    root.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  function keyDown(event: KeyboardEvent) {
    // Keyboard actions belong to this dialog while it owns focus.
    event.stopPropagation()
    if (event.key === 'Escape') {
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
          <fieldset disabled={delivering}>
            <legend>{t('pdf.orientation')}</legend>
            <Dropdown<PdfOrientation> ariaLabel={t('pdf.orientation')} trigger={t(`pdf.${setup.orientation}`)} value={setup.orientation}
              items={(['auto', 'portrait', 'landscape'] as const).map((value) => ({ value, label: t(`pdf.${value}`) }))}
              onChange={(orientation) => workflow.configure({ orientation })} preserveOverlays />
          </fieldset>
          <fieldset disabled={delivering}>
            <legend>{t('pdf.layers')}</legend>
            {layers.map((name) => <label key={name} className={styles.check}>
              <input type="checkbox" checked={setup.layers.includes(name)} onChange={(event) => workflow.selectLayer(name, event.currentTarget.checked)} />
              <span>{t(`canvas.layers.${name}`, { defaultValue: name })}</span>
            </label>)}
          </fieldset>
          <button type="button" disabled={delivering} onClick={() => void workflow.rebuild()}>{t('pdf.refresh')}</button>
          {state.error && <p role="alert" className={styles.notice}>{t(`pdf.errors.${state.error}`)}</p>}
          {plan?.blocked === 'empty' && <p role="status">{t('pdf.empty')}</p>}
          {plan?.blocked === 'legend-overflow' && <p role="alert" className={styles.notice}>{t('pdf.overflow')}</p>}
          {page && page.ambiguousSpecies.length > 0 && <p className={styles.notice}>{t('pdf.ambiguous')}</p>}
        </aside>
        <div className={styles.preview}>
          <div className={styles.previewTools}>
            <button type="button" aria-label={t('pdf.previous')} disabled={!page || index === 0} onClick={() => setIndex(Math.max(0, index - 1))}>‹</button>
            <span>{page ? t('pdf.pageCount', { page: page.number, count: plan!.pages.length }) : t('pdf.overview')}</span>
            <button type="button" aria-label={t('pdf.next')} disabled={!page || index >= plan!.pages.length - 1} onClick={() => setIndex(index + 1)}>›</button>
            <Dropdown<number> ariaLabel={t('pdf.zoom')} trigger={zoom ? `${zoom}%` : t('pdf.fit')} value={zoom}
              items={[{ value: 0, label: t('pdf.fit') }, ...[75, 100, 150, 200].map((value) => ({ value, label: `${value}%` }))]}
              onChange={setZoom} preserveOverlays />
          </div>
          <div className={styles.paper} aria-busy={state.status === 'preparing'}>
            {page && plan ? <PdfPagePreview page={page} plan={plan} zoom={zoom} /> : state.status === 'preparing' ? <p role="status">{t('pdf.preparing')}</p> : null}
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
