import { useEffect, useRef, useState } from 'preact/hooks'
import { pdfAreaKey, type PdfPage, type PdfPlan, type PdfSetup } from '../../app/canvas-pdf/types'
import { t } from '../../i18n'
import { PdfPagePreview } from './PdfPagePreview'
import styles from './canvas-pdf.module.css'

export function PdfPageRail({ plan, setup, selected, disabled, onSelect, onRemove, onHover }: {
  readonly plan?: PdfPlan; readonly setup: PdfSetup; readonly selected: string; readonly disabled: boolean
  readonly onSelect: (id: string) => void; readonly onRemove: (id: string) => void; readonly onHover: (id: string | null) => void
}) {
  const root = useRef<HTMLElement>(null)
  const groups = [{ id: 'overview', name: t('pdf.overview') }, ...(setup.areas ?? []).map((area) => ({ id: pdfAreaKey(area), name: area.name }))]
  useEffect(() => { root.current?.querySelector('[aria-current="page"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }) }, [selected])
  function pageButton(id: string, name: string) {
    const page = plan?.pages.find((page) => page.id === id)
    return <button type="button" className={styles.pageCard} aria-label={`${t('pdf.viewPage')}: ${name}`}
      aria-current={selected === id ? 'page' : undefined} onClick={() => onSelect(id)}>
      {page && plan ? <Thumbnail page={page} plan={plan} /> : <span className={styles.thumbnail} />}
      <span className={styles.pageCaption}><span>{page?.number ?? '·'}</span><span>{name}</span></span>
    </button>
  }
  function keyPages(sourceId: string) {
    const pages = plan?.pages.filter(page => page.sourceId === sourceId) ?? []
    if (!pages.length) return null
    const source = plan!.pages.find(page => page.id === sourceId)!
    return <ol className={styles.legendPages}>{pages.map(page => <li key={page.id}>
      {pageButton(page.id, `${source.number} · ${t('pdf.keyAndNotes')} · ${t('pdf.pageLabel')} ${page.number}`)}
    </li>)}</ol>
  }
  return <nav ref={root} className={styles.pageRail} aria-label={t('pdf.pages')}>
    <ol>{groups.map((group) => <li key={group.id} onPointerEnter={() => onHover(group.id)} onPointerLeave={() => onHover(null)}
      onFocusIn={() => onHover(group.id)} onFocusOut={() => onHover(null)}>
      <div className={styles.pageRow}>
        {pageButton(group.id, group.name)}
        {group.id !== 'overview' && <button type="button" disabled={disabled} className={styles.removePage}
          aria-label={`${t('pdf.removePage')}: ${group.name}`} onClick={() => onRemove(group.id)}>×</button>}
      </div>
      {group.id !== 'overview' && keyPages(group.id)}
    </li>)}</ol>
  </nav>
}
function Thumbnail({ page, plan }: { readonly page: PdfPage; readonly plan: PdfPlan }) {
  const root = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || !root.current) return
    const observer = new IntersectionObserver(([entry]) => setVisible(!!entry?.isIntersecting))
    observer.observe(root.current)
    return () => observer.disconnect()
  }, [])
  return <span ref={root} className={styles.thumbnail} aria-hidden="true" style={{ aspectRatio: `${page.width} / ${page.height}` }}>
    {visible && <PdfPagePreview page={page} plan={plan} />}
  </span>
}
