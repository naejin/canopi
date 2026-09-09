// THROWAWAY: three structures on the existing PDF route, behind ?legendPrototype=1.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { loadPdfFonts, createPdfTextEngine, type PdfFontId } from '../../../app/canvas-pdf/text'
import { encodePdf } from '../../../app/canvas-pdf/encode'
import { MM, textOp } from '../../../app/canvas-pdf/page-drawing'
import type { PdfPage, PdfPlan } from '../../../app/canvas-pdf/types'
import { locale } from '../../../app/settings/state'
import { PdfPagePreview } from '../PdfPagePreview'
import { layoutPrototype, variants, type Variant } from './layout.prototype'
import styles from './legend-prototype.module.css'

export default function LegendPrototype({ page, plan, onClose }: { page: PdfPage; plan: PdfPlan; onClose(): void }) {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => { root.current?.querySelector('button')?.focus() }, [])
  const language = locale.value
  const [variant, setVariant] = useState<Variant>(() => {
    const value = new URLSearchParams(location.search).get('variant')
    return value === 'B' || value === 'C' ? value : 'A'
  })
  const [limit, setLimit] = useState(24)
  const [fonts, setFonts] = useState<ReadonlyMap<PdfFontId, Uint8Array> | null>(null)
  const [error, setError] = useState('')
  const entries = useMemo(() => page.legend.slice(0, limit), [page.legend, limit])
  useEffect(() => {
    let active = true
    void loadPdfFonts([...page.legend.map(entry => entry.name), 'Plants on this page Prototype Current Compact column Two-column sidebar Footer key Print at actual size'], language,
      new URL(`${import.meta.env.BASE_URL}pdf-fonts/`, document.baseURI).href)
      .then(value => { if (active) setFonts(value) }).catch(error => { if (active) setError(String(error)) })
    return () => { active = false }
  }, [page.legend, language])
  const prepared = useMemo(() => {
    if (!fonts) return null
    const text = createPdfTextEngine(fonts, language)
    const current = layoutPrototype(entries, text, 'current')
    const proposed = layoutPrototype(entries, text, variant)
    return { text, current, proposed }
  }, [fonts, language, entries, variant])
  function choose(next: Variant) {
    setVariant(next)
    const url = new URL(location.href); url.searchParams.set('variant', next); history.replaceState(null, '', url)
  }
  function cycle(direction: number) { const keys: Variant[] = ['A', 'B', 'C']; choose(keys[(keys.indexOf(variant) + direction + 3) % 3]!) }
  function legendPage(body: NonNullable<typeof prepared>['current']): PdfPage {
    return { ...page, legend: entries, width: body.width, height: body.height, operations: body.operations }
  }
  async function download() {
    if (!prepared || !fonts) return
    const pages = [prepared.current, prepared.proposed].map((body, index): PdfPage => {
      const title = index ? variants[variant].name : 'Current'
      return { ...page, id: String(index), number: index + 1, width: 210 * MM, height: 297 * MM,
        operations: [textOp(prepared.text.line(`Prototype / ${title}`, 12), 10 * MM, 15 * MM, 12),
          ...body.operations.map(op => op.kind === 'text' ? { ...op, x: op.x + 10 * MM, y: op.y + 25 * MM }
            : op.kind === 'path' ? { ...op, matrix: [op.matrix[0], op.matrix[1], op.matrix[2], op.matrix[3], op.matrix[4] + 10 * MM, op.matrix[5] + 25 * MM] as const } : op),
          textOp(prepared.text.line('Print at actual size / 10 pt / 3 mm symbols', 10), 10 * MM, 285 * MM, 10)] }
    })
    const bytes = await encodePdf({ pages, outlines: prepared.text.outlines, blocked: null }, fonts, 'Prototype - compact plant legend')
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }))
    const link = document.createElement('a'); link.href = url; link.download = 'Canopi-legend-proposal.pdf'; link.click(); URL.revokeObjectURL(url)
  }
  const fitsSample = prepared && Math.max(prepared.current.height, prepared.proposed.height) < 250 * MM
  return <div ref={root} className={styles.prototype} role="dialog" aria-label="Plant legend proposal" onKeyDown={event => {
    event.stopPropagation()
    if (event.key === 'Escape') onClose()
    if (event.target instanceof HTMLElement && event.target.closest('input,textarea,[contenteditable]')) return
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); cycle(event.key === 'ArrowLeft' ? -1 : 1) }
  }}>
    <header><div><span className={styles.eyebrow}>CANOPI / DESIGN PROPOSAL</span><h1>A smaller legend. The same readable names.</h1></div>
      <button onClick={onClose}>Back to PDF workspace</button></header>
    <p className={styles.intro}>Read-only comparison from this page’s actual species and authored symbols. All options keep 10 pt names and 3 mm symbols. Enlarged on screen; use the PDF for actual-size review.</p>
    <div className={styles.tools}><span>{entries.length} of {page.legend.length} species · {entries.length === page.legend.length ? 'complete legend' : 'alphabetical excerpt'}</span>
      {[12, 24, Infinity].map(value => <button aria-pressed={limit === value} onClick={() => setLimit(value)}>{value === Infinity ? 'All species' : `${value} species`}</button>)}
      <button disabled={!fitsSample} onClick={() => void download()}>Download comparison PDF</button></div>
    {prepared && !fitsSample && <p>This list exceeds one A4 comparison sheet. Choose a smaller excerpt for the PDF; the complete legend still needs continuation pages.</p>}
    {error && <p>{error}</p>}
    {!prepared ? <p>Preparing shared font metrics…</p> : <>
      <section className={styles.summary}><div><span className={styles.eyebrow}>{variant === 'A' ? 'RECOMMENDED / ' : 'ALTERNATIVE / '}{variant}</span>
        <h2>{variants[variant].name}</h2><p>{variants[variant].note}</p></div>
        <div className={styles.metric}><strong>{Math.round((1 - prepared.proposed.height / prepared.current.height) * 100)}%</strong><span>less legend height in this excerpt</span></div>
      </section>
      <div className={styles.comparison}>
        <section><h3>Current</h3><p>42 mm wide · {Math.round(prepared.current.height / MM)} mm tall</p>
          <div className={styles.sheet} style={{ width: prepared.current.width * 1.6 }}><PdfPagePreview page={legendPage(prepared.current)} plan={{ ...plan, outlines: prepared.text.outlines }} /></div>
        </section>
        <section><h3>{variants[variant].name}</h3><p>{Math.round(prepared.proposed.width / MM)} mm wide · {Math.round(prepared.proposed.height / MM)} mm tall · full names</p>
          <div className={styles.sheet} style={{ width: prepared.proposed.width * 1.6 }}><PdfPagePreview page={legendPage(prepared.proposed)} plan={{ ...plan, outlines: prepared.text.outlines }} /></div>
        </section>
        {variant !== 'C' && <aside><h3>Canvas space</h3><svg viewBox="0 0 210 297" width="160" aria-label="Schematic page layout">
          <rect x="1" y="1" width="208" height="295" fill="white" stroke="#b8b0a4" />
          <rect x="10" y="22" width={185 - variants[variant].width / MM} height="258" fill="#eee9df" />
          <rect x={200 - variants[variant].width / MM} y="22" width={variants[variant].width / MM} height="258" fill="#e5d5b8" />
        </svg><p>{variant === 'A' ? 'Keeps the current canvas width.' : 'Widens the legend by 34 mm.'}</p>
          <p>Paper readability still needs a real print check. Long names wrap; overflow keeps explicit continuation pages.</p></aside>}
      </div>
    </>}
    <nav className={styles.switcher} aria-label="Prototype variants"><button onClick={() => cycle(-1)}>←</button>
      {(['A', 'B', 'C'] as const).map(key => <button aria-pressed={variant === key} onClick={() => choose(key)}>{key} · {variants[key].name}</button>)}
      <button onClick={() => cycle(1)}>→</button></nav>
  </div>
}
