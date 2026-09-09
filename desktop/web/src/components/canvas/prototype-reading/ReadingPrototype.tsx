// Three throwaway lens layouts on the existing Web Canvas; ?prototype=readability&variant=inline.
import { useEffect, useId, useMemo, useState } from 'preact/hooks'
import { memo } from 'preact/compat'
import { currentCanvasQuerySurface } from '../../../canvas/session'
import type { CanvasPrintSnapshot, PrintBounds, PrintPlant, PrintPoint } from '../../../canvas/print'
import { PdfPagePreview } from '../../canvas-pdf/PdfPagePreview'
import { buildPdfPlan } from '../../../app/canvas-pdf/layout'
import { createPdfTextEngine, loadPdfFonts, type PdfFontId } from '../../../app/canvas-pdf/text'
import { encodePdf } from '../../../app/canvas-pdf/encode'
import type { PdfInput, PdfPlan } from '../../../app/canvas-pdf/types'
import { adaptPaper, initialPoint, labelLens, spacingFor, type LensVariant } from './reading-layout.prototype'
import styles from './reading-prototype.module.css'

const variants: LensVariant[] = ['inline', 'connected', 'expanded']
const titles = { inline: 'Names beside plants', connected: 'Connected names', expanded: 'Larger inspection frame' }

export function ReadingPrototype() {
  const queries = currentCanvasQuerySurface.value
  const revision = queries?.revision.scene.value
  const data = useMemo(() => {
    const canvas = queries?.capturePrintSnapshot()
    if (!canvas) return null
    const names = Object.fromEntries(queries!.getPlacedPlants().map(p => [p.canonical_name, p.common_name || p.canonical_name]))
    for (const [canonical, common] of queries!.getLocalizedCommonNames()) if (common) names[canonical] = common
    return { canvas, names, spacing: spacingFor(canvas.plants), point: initialPoint(canvas.plants) }
  }, [queries, revision])
  return data ? <ReadingStudy {...data} /> : <div className={styles.study}>Open a Design to compare reading layouts.</div>
}

function ReadingStudy({ canvas, names, spacing, point: initial }: {
  canvas: CanvasPrintSnapshot; names: Record<string, string>; spacing: Map<string, number>; point: PrintPoint
}) {
  const requested = new URLSearchParams(window.location.search).get('variant')
  const [variant, setVariant] = useState<LensVariant>(variants.includes(requested as LensVariant) ? requested as LensVariant : 'inline')
  const [surface, setSurface] = useState<'lens' | 'pdf'>('lens')
  const [point, setPoint] = useState(initial)
  const [held, setHeld] = useState(true)
  const [hovered, setHovered] = useState<string | null>(null)
  const [magnification, setMagnification] = useState(1)
  const overview = useMemo(() => {
    const xs = canvas.plants.map(p => p.position.x), ys = canvas.plants.map(p => p.position.y)
    return { x: Math.min(...xs) - 2, y: Math.min(...ys) - 2,
      width: Math.max(...xs) - Math.min(...xs) + 4, height: Math.max(...ys) - Math.min(...ys) + 4 }
  }, [canvas])
  const scale = Math.min(1000 / overview.width, 650 / overview.height)
  const lensWidth = variant === 'expanded' ? 700 : 430
  const lensHeight = variant === 'expanded' ? 480 : 390
  const near = [...canvas.plants].sort((a, b) => Math.hypot(a.position.x - point.x, a.position.y - point.y)
    - Math.hypot(b.position.x - point.x, b.position.y - point.y)).slice(0, 7)
  const localSpacing = [...near.map(p => spacing.get(p.id) ?? 1)].sort((a, b) => a - b)[Math.floor(near.length / 2)] ?? 1
  const lensScale = Math.max(180, Math.min(600, 100 / localSpacing)) * magnification
  const lensGround = { x: point.x - lensWidth / lensScale / 2, y: point.y - lensHeight / lensScale / 2,
    width: lensWidth / lensScale, height: lensHeight / lensScale }
  const labels = useMemo(() => labelLens(canvas.plants, names, point, lensScale, lensWidth, lensHeight, variant),
    [canvas, names, point, lensScale, lensWidth, lensHeight, variant])
  const visibleCount = canvas.plants.filter(p => p.position.x >= lensGround.x && p.position.x <= lensGround.x + lensGround.width
    && p.position.y >= lensGround.y && p.position.y <= lensGround.y + lensGround.height).length
  function cycle(direction: number) {
    setVariant(current => {
      const next = variants[(variants.indexOf(current) + direction + variants.length) % variants.length]!
      const url = new URL(window.location.href); url.searchParams.set('variant', next)
      window.history.replaceState(null, '', url)
      return next
    })
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.target as Element)?.closest('input, textarea, select, [contenteditable]')) return
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault(); cycle(event.key === 'ArrowLeft' ? -1 : 1)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  const inspect = (event: PointerEvent & { currentTarget: SVGSVGElement }) => {
    const matrix = event.currentTarget.getScreenCTM()
    if (!matrix) return
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    setPoint({ x: overview.x + p.x / scale, y: overview.y + p.y / scale })
  }
  return <div className={styles.study} data-reading-prototype="true">
    <header className={styles.header}>
      <div><strong>Reading study</strong><span>PROTOTYPE · {canvas.plants.length.toLocaleString()} plants · Design unchanged</span></div>
      <nav aria-label="Reading surface">
        <button aria-pressed={surface === 'lens'} onClick={() => setSurface('lens')}>Inspection lens</button>
        <button aria-pressed={surface === 'pdf'} onClick={() => { setHeld(true); setSurface('pdf') }}>PDF comparison</button>
        <a href={window.location.pathname}>Exit prototype</a>
      </nav>
    </header>
    {surface === 'lens' ? <div className={styles.workspace}>
      <div className={styles.overview}>
        <div className={styles.overviewHint}>Click anywhere to inspect. <button onClick={() => setHeld(!held)}>{held ? 'Follow pointer' : 'Hold this area'}</button></div>
        <svg viewBox="0 0 1000 650" role="img" aria-label="Design overview; click a planting to inspect"
          onPointerMove={event => { if (!held) inspect(event) }} onPointerDown={event => { inspect(event); setHeld(true) }}>
          <SceneArtwork canvas={canvas} ground={overview} scale={scale} spacing={spacing} />
          <rect x={(lensGround.x - overview.x) * scale} y={(lensGround.y - overview.y) * scale}
            width={lensGround.width * scale} height={lensGround.height * scale} fill="none" stroke="var(--color-primary)" stroke-width="2" />
        </svg>
      </div>
      <section className={`${styles.lens} ${variant === 'expanded' ? styles.expanded : ''}`} aria-label="Proposed inspection lens">
        <div className={styles.lensHeader}><strong>{titles[variant]}</strong><span>{held ? 'Held' : 'Following pointer'} · {Math.round(lensScale / 20 * 100)}%</span></div>
        <svg viewBox={`0 0 ${lensWidth} ${lensHeight}`} role="group" aria-label="Plant names inside the inspection frame">
          <SceneArtwork canvas={canvas} ground={lensGround} scale={lensScale} spacing={spacing} />
          {labels.map(label => {
            const active = hovered === label.plant.id
            const tx = Math.max(label.x + 4, Math.min(label.x + label.width - 4, label.px))
            const ty = label.py < label.y ? label.y : label.py > label.y + 21 ? label.y + 21 : label.y + 10
            return <g key={label.plant.id} role="button" tabIndex={0} aria-label={`Inspect ${label.text}`}
              onPointerEnter={() => setHovered(label.plant.id)} onPointerLeave={() => setHovered(null)}
              onFocus={() => setHovered(label.plant.id)} onBlur={() => setHovered(null)}
              onClick={() => { setPoint(label.plant.position); setHeld(true) }}
              onKeyDown={event => { if (event.key === 'Enter') { setPoint(label.plant.position); setHeld(true) } }} className={styles.label}>
              <line x1={label.px} y1={label.py} x2={tx} y2={ty} stroke={active ? 'var(--color-primary)' : 'var(--color-text-muted)'} stroke-width={active ? 1.8 : .7} />
              {active && <circle cx={label.px} cy={label.py} r="11" fill="none" stroke="var(--color-primary)" stroke-width="2" />}
              <rect x={label.x} y={label.y} width={label.width} height="21" rx="3" fill="var(--canvas-bg)" stroke={active ? 'var(--color-primary)' : 'none'} />
              <text x={label.x + 6} y={label.y + 14} fill="var(--color-text)" font-family="Inter, sans-serif" font-size="12" font-weight="600">{label.text}</text>
            </g>
          })}
        </svg>
        <footer className={styles.lensFooter}>
          <span>{labels.length} names · {visibleCount} positions<br />Hover a name to see its exact plant.</span>
          <button onClick={() => setMagnification(Math.max(.5, magnification / 1.25))} aria-label="Widen lens">−</button>
          <button onClick={() => setMagnification(Math.min(3, magnification * 1.25))} aria-label="Magnify lens">+</button>
        </footer>
      </section>
      <aside className={styles.explanation}>
        <strong>{variant === 'inline' ? 'Recommended starting point' : 'Alternative to compare'}</strong>
        <p>{variant === 'connected' ? 'Names stay inside the image, at its edges. Lines give an exact association, but can cross in very dense patches.'
          : variant === 'expanded' ? 'More space shows a larger labelled neighbourhood. Easier to read, but it covers more of the main canvas.'
          : 'Names sit close to their plants. Short connectors remove ambiguity. Magnification makes room; overlapping names are never forced.'}</p>
        <p>The ochre rectangle shows exactly which area the lens covers.</p>
      </aside>
    </div> : <PdfComparison canvas={canvas} names={names} spacing={spacing} centre={point} />}
    <div className={styles.switcher} aria-label="Prototype layout switcher">
      <button onClick={() => { setSurface('lens'); cycle(-1) }} aria-label="Previous lens layout">←</button>
      <span>Lens {variants.indexOf(variant) + 1} / 3 — {titles[variant]}</span>
      <button onClick={() => { setSurface('lens'); cycle(1) }} aria-label="Next lens layout">→</button>
    </div>
  </div>
}

const SceneArtwork = memo(function SceneArtwork({ canvas, ground, scale, spacing }: {
  canvas: CanvasPrintSnapshot; ground: PrintBounds; scale: number; spacing: ReadonlyMap<string, number>
}) {
  const id = useId()
  const plants = canvas.plants.filter(p => p.position.x > ground.x - .5 && p.position.x < ground.x + ground.width + .5
    && p.position.y > ground.y - .5 && p.position.y < ground.y + ground.height + .5)
  return <>
    <defs><clipPath id={id}><rect width={ground.width * scale} height={ground.height * scale} /></clipPath></defs>
    <g clip-path={`url(#${id})`}>
      <g transform={`matrix(${scale} 0 0 ${scale} ${-ground.x * scale} ${-ground.y * scale})`}>
        {canvas.zones.map(zone => <path key={zone.name} d={zone.path} fill={zone.fill ?? 'none'} stroke="var(--color-text-muted)" stroke-width={1 / scale} />)}
      </g>
      {plants.map(plant => {
        const radius = Math.max(.65, Math.min(6, (spacing.get(plant.id) ?? Infinity) * scale * .42))
        const x = (plant.position.x - ground.x) * scale, y = (plant.position.y - ground.y) * scale
        return <g key={plant.id}>{radius < 3.6 ? <circle cx={x} cy={y} r={radius} fill={plant.color} />
          : <PlantGlyph plant={plant} x={x} y={y} radius={radius} />}</g>
      })}
    </g>
  </>
})

function PlantGlyph({ plant, x, y, radius }: { plant: PrintPlant; x: number; y: number; radius: number }) {
  return <g transform={`matrix(${radius} 0 0 ${radius} ${x} ${y})`}>
    {plant.mark.map((path, index) => <path key={index} d={path.d} fill={path.fill ? plant.color : 'none'}
      fill-opacity=".4" stroke={path.stroke ? plant.color : 'none'} stroke-width={Math.max(.2, path.strokeWidth)} />)}
  </g>
}

function PdfComparison({ canvas, names, spacing, centre }: {
  canvas: CanvasPrintSnapshot; names: Record<string, string>; spacing: ReadonlyMap<string, number>; centre: PrintPoint
}) {
  const [prepared, setPrepared] = useState<{ current: PdfPlan; proposed: PdfPlan; fonts: Map<PdfFontId, Uint8Array> } | null>(null)
  const [failure, setFailure] = useState('')
  const [pageIndex, setPageIndex] = useState(1)
  const [magnify, setMagnify] = useState(false)
  useEffect(() => {
    let cancelled = false
    const input: PdfInput = { name: 'PROTOTYPE · Dense planting readability', locale: 'fr', canvas, commonNames: names }
    const labels = { overview: 'Overview', plants: 'Plants', actualSize: 'Print at actual size', page: 'Page', continued: 'Continued', legendFor: 'Legend for' }
    void loadPdfFonts([input.name, ...Object.values(names), ...canvas.annotations.map(a => a.text), ...Object.values(labels)], 'fr', new URL(`${import.meta.env.BASE_URL}pdf-fonts/`, window.location.origin).href)
      .then(fonts => {
        if (cancelled) return
        const text = createPdfTextEngine(fonts, 'fr')
        const current = buildPdfPlan(input, { paper: 'A4', layers: canvas.layers.filter(l => l.visible).map(l => l.name),
          areas: [{ kind: 'rectangle', id: 'inspection', name: 'Inspection area', bounds: { x: centre.x - 1.4, y: centre.y - 1.7, width: 2.8, height: 3.4 } }], continuations: true }, text, labels)
        setPrepared({ current, proposed: adaptPaper(current, canvas, spacing), fonts })
      }).catch(error => { if (!cancelled) setFailure(String(error)) })
    return () => { cancelled = true }
  }, [canvas, names, spacing, centre])
  async function download(proposed: boolean) {
    if (!prepared) return
    const bytes = await encodePdf(proposed ? prepared.proposed : prepared.current, prepared.fonts, 'Reading proposal')
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }))
    const link = document.createElement('a'); link.href = url; link.download = `canopi-reading-${proposed ? 'proposed' : 'current'}.pdf`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <div className={styles.pdf}>
    <div className={styles.pdfControls}>
      <button aria-pressed={pageIndex === 0} onClick={() => setPageIndex(0)}>Overview</button>
      <button aria-pressed={pageIndex === 1} onClick={() => setPageIndex(1)}>Detail of inspected area</button>
      <button aria-pressed={magnify} onClick={() => setMagnify(!magnify)}>Inspect text</button>
      <span>Same coverage, text, distances, colours and complete legend. Physical sizes are provisional.</span>
    </div>
    {failure && <p>{failure}</p>}
    {!prepared && !failure && <p>Preparing both views with the actual PDF fonts and page layout…</p>}
    {prepared && <div className={styles.pdfPair}>
      {[false, true].map(proposed => {
        const plan = proposed ? prepared.proposed : prepared.current, page = plan.pages[pageIndex] ?? plan.pages[0]!
        return <section key={String(proposed)}>
          <div className={styles.pdfHeading}><strong>{proposed ? 'Proposed · space-aware plant marks' : 'Current · fixed 3 mm plant marks'}</strong>
            <button onClick={() => { void download(proposed) }}>Save sample PDF</button></div>
          <div className={`${styles.paper} ${magnify ? styles.magnified : ''}`}><PdfPagePreview plan={plan} page={page} /></div>
        </section>
      })}
    </div>}
    <p className={styles.pdfNote}>All selected notes and distances remain printed. When text is crowded, a focused detail page is the next step; the prototype never hides it to make the comparison look cleaner.</p>
  </div>
}
