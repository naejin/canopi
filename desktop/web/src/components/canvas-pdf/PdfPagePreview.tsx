import { useEffect, useId, useMemo, useRef, useState } from 'preact/hooks'
import type { PrintBounds, PrintPoint } from '../../canvas/print'
import type { ComponentChildren } from 'preact'
import type { PdfPage, PdfPlan } from '../../app/canvas-pdf/types'
import { t } from '../../i18n'

export function PdfPagePreview({ page, plan, zoom = 0, drawing = false, onPrintArea }: {
  readonly page: PdfPage
  readonly plan: PdfPlan
  readonly zoom?: number
  readonly drawing?: boolean
  readonly onPrintArea?: (bounds: PrintBounds) => void
}) {
  const root = useRef<SVGSVGElement>(null)
  const drag = useRef<{ start: PrintPoint; pointerId: number } | null>(null)
  const [selection, setSelection] = useState<PrintBounds | null>(null)
  const cancel = () => {
    const previous = drag.current; drag.current = null; setSelection(null)
    if (previous && root.current?.hasPointerCapture(previous.pointerId)) root.current.releasePointerCapture(previous.pointerId)
  }
  useEffect(() => { cancel(); return cancel }, [drawing, page.id])
  const point = (event: PointerEvent): PrintPoint => {
    const bounds = root.current!.getBoundingClientRect()
    const scale = Math.min(bounds.width / page.width, bounds.height / page.height)
    // SVG uses xMidYMid meet: account for empty space around a fitted page.
    return { x: (event.clientX - bounds.left - (bounds.width - page.width * scale) / 2) / scale,
      y: (event.clientY - bounds.top - (bounds.height - page.height * scale) / 2) / scale }
  }
  const rectangle = (end: PrintPoint): PrintBounds => {
    const start = drag.current!.start
    const x = Math.max(page.frame.x, Math.min(page.frame.x + page.frame.width, end.x))
    const y = Math.max(page.frame.y, Math.min(page.frame.y + page.frame.height, end.y))
    return { x: Math.min(start.x, x), y: Math.min(start.y, y), width: Math.abs(x - start.x), height: Math.abs(y - start.y) }
  }
  function pointerDown(event: PointerEvent): void {
    if (!drawing || page.kind !== 'overview' || event.button !== 0 || drag.current) return
    const start = point(event)
    if (!Number.isFinite(start.x) || !Number.isFinite(start.y)) return
    if (start.x < page.frame.x || start.x > page.frame.x + page.frame.width || start.y < page.frame.y || start.y > page.frame.y + page.frame.height) return
    event.preventDefault(); event.stopPropagation()
    root.current!.setPointerCapture(event.pointerId)
    drag.current = { start, pointerId: event.pointerId }; setSelection(null)
  }
  function pointerMove(event: PointerEvent): void {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return
    event.preventDefault(); setSelection(rectangle(point(event)))
  }
  function pointerUp(event: PointerEvent): void {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return
    const bounds = rectangle(point(event)); cancel()
    if (bounds.width < 2 || bounds.height < 2) return
    onPrintArea?.({ x: page.ground.x + (bounds.x - page.frame.x) / page.pointsPerMeter,
      y: page.ground.y + (bounds.y - page.frame.y) / page.pointsPerMeter,
      width: bounds.width / page.pointsPerMeter, height: bounds.height / page.pointsPerMeter })
  }
  const id = useId()
  const artwork = useMemo(() => {
    const clips: ComponentChildren[] = []
    const content: ComponentChildren[] = []
    let clip: string | undefined
    for (const [index, op] of page.operations.entries()) {
      if (op.kind === 'clip') {
        const key = `${id}-clip-${index}`
        clips.push(<clipPath id={key} key={key}><rect x={op.bounds.x} y={op.bounds.y} width={op.bounds.width} height={op.bounds.height} /></clipPath>)
        clip = `url(#${key})`; continue
      }
      if (op.kind === 'unclip') { clip = undefined; continue }
      if (op.kind === 'path') {
        content.push(<g key={index} clip-path={clip}><path d={op.d} transform={`matrix(${op.matrix.join(' ')})`}
          fill={op.fill ?? 'none'} stroke={op.stroke ?? 'none'} stroke-width={op.width} opacity={op.opacity} stroke-linecap="round" stroke-linejoin="round" /></g>)
      } else {
        let x = 0
        const runs = op.line.runs.map((run, runIndex) => {
          const start = x; x += run.width
          return <g key={runIndex} transform={`translate(${start} 0)`}>{run.glyphs.map((glyph, glyphIndex) => {
            const outline = plan.outlines[glyph.key]!
            const scale = op.size / outline.unitsPerEm
            return <path key={glyphIndex} d={outline.path} transform={`translate(${glyph.x} ${glyph.y}) scale(${scale} ${-scale})`} />
          })}</g>
        })
        content.push(<g key={index} clip-path={clip}><g transform={`translate(${op.x} ${op.y}) rotate(${op.rotation})`} opacity={op.opacity} fill="#24211c">{runs}</g></g>)
      }
    }
    return <><defs>{clips}</defs><rect width={page.width} height={page.height} fill="#ffffff" />{content}</>
  }, [page, plan, id])
  return <svg ref={root} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${page.width} ${page.height}`} role="img"
    aria-label={t('pdf.pageCount', { page: page.number, count: plan.pages.length })}
    width={zoom ? page.width * 4 / 3 * zoom / 100 : '100%'} height={zoom ? page.height * 4 / 3 * zoom / 100 : '100%'}
    style={{ touchAction: drawing ? 'none' : undefined, cursor: drawing ? 'crosshair' : undefined }}
    onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={cancel} onLostPointerCapture={cancel}
    data-pdf-page={page.number}>
    <desc>{page.legend.map((entry) => entry.name).join('; ')}</desc>
    {artwork}
    {selection && <rect data-print-area-draft x={selection.x} y={selection.y} width={selection.width} height={selection.height}
      fill="var(--color-primary-bg)" stroke="var(--color-primary)" stroke-width="1" stroke-dasharray="4 2" />}
  </svg>
}
