import { useId } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import type { PdfPage, PdfPlan } from '../../app/canvas-pdf/types'
import { t } from '../../i18n'

export function PdfPagePreview({ page, plan, zoom = 0 }: { readonly page: PdfPage; readonly plan: PdfPlan; readonly zoom?: number }) {
  const id = useId()
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
      content.push(<g key={index} clipPath={clip}><path d={op.d} transform={`matrix(${op.matrix.join(' ')})`}
        fill={op.fill ?? 'none'} stroke={op.stroke ?? 'none'} strokeWidth={op.width} opacity={op.opacity} strokeLinecap="round" strokeLinejoin="round" /></g>)
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
      content.push(<g key={index} clipPath={clip}><g transform={`translate(${op.x} ${op.y}) rotate(${op.rotation})`} opacity={op.opacity} fill="#24211c">{runs}</g></g>)
    }
  }
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${page.width} ${page.height}`} role="img"
    aria-label={t('pdf.pageCount', { page: page.number, count: plan.pages.length })}
    width={zoom ? page.width * 4 / 3 * zoom / 100 : '100%'} height={zoom ? page.height * 4 / 3 * zoom / 100 : '100%'}
    data-pdf-page={page.number}>
    <desc>{page.legend.map((entry) => entry.name).join('; ')}</desc>
    <defs>{clips}</defs><rect width={page.width} height={page.height} fill="#ffffff" />{content}
  </svg>
}
