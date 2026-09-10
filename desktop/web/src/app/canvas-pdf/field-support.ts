import type { PrintBounds } from '../../canvas/print'
import type { PdfInput, PdfLegendEntry, PdfOperation, PdfLink } from './types'
import type { FieldNote } from './field-layout'
import type { FieldBracket } from './field-brackets'
import { FieldSpace } from './field-placement'
import { MM } from './print-style'
import { drawMark, pathOp, textOp } from './page-drawing'

/** Use genuinely spare paper for a complete quick key and a ground-distance ruler. */
export function fieldSupport(input: PdfInput, legend: readonly PdfLegendEntry[], notes: readonly FieldNote[], brackets: readonly FieldBracket[],
  frame: PrintBounds, ground: PrintBounds, scale: number, space: FieldSpace, pageId: string): { operations: PdfOperation[]; links: PdfLink[] } {
  const operations: PdfOperation[] = [], links: PdfLink[] = []
  if (!brackets.length || frame.width < frame.height * 4) return { operations, links }
  const line = (x: number, y: number, x2: number, y2: number) => operations.push(pathOp(`M${x * MM} ${y * MM} L${x2 * MM} ${y2 * MM}`, '#969084', null, .15 * MM))
  const label = (value: string, x: number, y: number, size: number, color = '#24211c') => operations.push({ ...textOp(space.text.line(value, size), x * MM, y * MM, size), color })
  const page = space.frame, columns = 3, gap = 4, columnWidth = (page.width - 1 - gap * (columns - 1)) / columns
  const entries = [
    ...legend.map(entry => ({ reference: entry.reference!, value: `${entry.name} · ${entry.count}`, appearances: entry.appearances, target: `${pageId}:key:${entry.reference}` })),
    ...notes.map(note => ({ reference: note.reference, value: note.text, appearances: [], target: `${pageId}:note:${note.reference}` })),
  ]
  const referenceWidth = Math.max(9, ...entries.map(e => space.measure(e.reference, 9.5).width + 1.5))
  const rows = Math.ceil(entries.length / columns), height = rows * 6 + 4
  const footer = { x: page.x + .5, y: page.y + page.height - height - .5, width: page.width - 1, height }
  if (entries.length && rows <= 7 && space.clear(footer) && entries.every(e => space.measure(e.value, 9.5).width + referenceWidth + e.appearances.length * 4 < columnWidth)) {
    space.reserve(footer)
    line(footer.x, footer.y, footer.x + footer.width, footer.y)
    entries.forEach((entry, i) => {
      const x = footer.x + Math.floor(i / rows) * (columnWidth + gap), y = footer.y + 5 + i % rows * 6
      label(entry.reference, x, y, 9.5, entry.appearances.length ? '#24211c' : '#A06B1F')
      entry.appearances.forEach((plant, j) => drawMark(plant, (x + referenceWidth + j * 4) * MM, (y - 1) * MM, 1.5 * MM,
        input.canvas.layers.find(l => l.name === 'plants')?.opacity ?? 1, operations))
      label(entry.value, x + referenceWidth + entry.appearances.length * 4, y, 9.5)
      links.push({ bounds: { x: x * MM, y: (y - 4) * MM, width: columnWidth * MM, height: 6 * MM }, target: entry.target })
    })
  }
  const upper = brackets.flatMap(b => b.connectors.filter(c => c.rail).flatMap(c => c.route.map(s => s.a.y))).filter(y => y < frame.y)
  if (!upper.length) return { operations, links }
  const y = Math.min(...upper) - 9, ruler = { x: frame.x - 2, y: y - 6, width: frame.width + 6, height: 7 }
  if (!space.clear(ruler)) return { operations, links }
  space.reserve(ruler)
  line(frame.x, y, frame.x + frame.width, y)
  // 1/2/5 metre steps keep numbers apart at every export scale.
  const required = 10 * MM / scale, magnitude = 10 ** Math.floor(Math.log10(required))
  const step = [1, 2, 5, 10].map(n => n * magnitude).find(n => n >= required)!
  const number = new Intl.NumberFormat(input.locale, { maximumFractionDigits: 6 })
  for (let i = 0; i * step <= ground.width + 1e-8; i++) {
    const x = frame.x + i * step * scale / MM
    line(x, y, x, y - 1.5)
    const value = number.format(i * step), width = space.text.line(value, 8).width / MM
    label(value, x - width / 2, y - 2.5, 8)
    if ((i + .5) * step < ground.width) line(x + step * scale / MM / 2, y, x + step * scale / MM / 2, y - .8)
  }
  label('m', frame.x + frame.width + 2, y - 2.5, 8)
  return { operations, links }
}
