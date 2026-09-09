import type { PrintBounds, PrintPlant } from '../../canvas/print'
import type { PdfTextEngine, TextLine } from './text'
import type { PdfLabels, PdfLegendEntry, PdfOperation } from './types'
import { PRINT, drawMark, textOp } from './page-drawing'

interface Row { line?: TextLine; samples?: readonly PrintPlant[]; indent: number }
interface LegendBody { operations: PdfOperation[]; entries: PdfLegendEntry[] }
interface LegendPlan { operations: PdfOperation[]; overflow: boolean; continuations: LegendBody[]; link?: PrintBounds }

// Keep an entry together when it fits an empty column. A name or set of authored
// appearances longer than a whole column may continue, always at the same size.
export function planLegend(entries: readonly PdfLegendEntry[], column: PrintBounds, continuationFrame: (index: number) => PrintBounds,
  text: PdfTextEngine, labels: PdfLabels, allow: boolean, opacity: number): LegendPlan {
  const rows = (entry: PdfLegendEntry, width: number): Row[] => {
    const single = entry.appearances.length === 1
    const indent = single ? 2 * PRINT.marker + 5 : 0
    const result: Row[] = text.wrap(entry.name, PRINT.text, width - indent).map((line, i) => ({ line, indent,
      ...(single && i === 0 ? { samples: entry.appearances } : {}) }))
    if (!single) {
      const count = Math.max(1, Math.floor(width / (3 * PRINT.marker)))
      for (let i = 0; i < entry.appearances.length; i += count) result.push({ samples: entry.appearances.slice(i, i + count), indent: 0 })
    }
    return result
  }
  const draw = (row: Row, x: number, y: number, operations: PdfOperation[]) => {
    if (row.line) operations.push(textOp(row.line, x + row.indent, y + PRINT.text, PRINT.text))
    row.samples?.forEach((plant, i) => drawMark(plant, x + PRINT.marker + i * 3 * PRINT.marker, y + PRINT.text - 3, PRINT.marker, opacity, operations))
  }
  const measured = entries.map((entry) => rows(entry, column.width))
  const fit = (height: number) => {
    let used = 0, count = 0
    for (const entry of measured) {
      const size = entry.length * PRINT.line + 6
      if (used + size > height) break
      used += size; count++
    }
    return count
  }
  const overflow = fit(column.height) < entries.length
  const linkHeight = overflow && allow ? (text.wrap(`${labels.continued} · ${labels.page} 200-200`, PRINT.text, column.width).length + 1) * PRINT.line : 0
  const count = fit(column.height - linkHeight)
  const operations: PdfOperation[] = []
  let y = column.y
  for (const entry of measured.slice(0, count)) {
    for (const row of entry) { draw(row, column.x, y, operations); y += PRINT.line }
    y += 6
  }
  if (!overflow || !allow) return { operations, overflow, continuations: [] }

  const continuations: LegendBody[] = []
  let frame: PrintBounds, width: number, bottom: number
  let columnIndex = 0
  let body: LegendBody
  const nextPage = () => {
    if (continuations.length >= 199) throw new Error('coverage-too-large')
    frame = continuationFrame(continuations.length)
    width = (frame.width - PRINT.gutter) / 2; bottom = frame.y + frame.height
    body = { operations: [], entries: [] }; continuations.push(body)
    columnIndex = 0; y = frame.y
  }
  const nextColumn = () => {
    if (columnIndex === 0) { columnIndex = 1; y = frame.y }
    else nextPage()
  }
  nextPage()
  for (const entry of entries.slice(count)) {
    let entryRows = rows(entry, width!)
    if (y > frame!.y && y + entryRows.length * PRINT.line + 6 > bottom!) {
      nextColumn(); entryRows = rows(entry, width!)
    }
    for (let i = 0; i < entryRows.length; i++) {
      if (y + PRINT.line > bottom!) {
        nextColumn()
        for (const line of text.wrap(labels.continued, PRINT.text, width!)) {
          draw({ line, indent: 0 }, frame!.x + columnIndex * (width! + PRINT.gutter), y, body!.operations); y += PRINT.line
        }
      }
      // A single long entry may cross a page whose orientation was overridden.
      // Rewrap any remaining wide row without losing text or authored samples.
      const row = entryRows[i]!
      if (row.line && row.line.width + row.indent > width!) {
        const lines = text.wrap(row.line.runs.map((run) => run.text).join(''), PRINT.text, width! - row.indent)
        entryRows.splice(i, 1, ...lines.map((line, index) => ({ line, indent: row.indent, ...(index === 0 ? { samples: row.samples } : {}) })))
      } else if (!row.line && row.samples && row.samples.length * 3 * PRINT.marker > width!) {
        const count = Math.max(1, Math.floor(width! / (3 * PRINT.marker)))
        const split: Row[] = []
        for (let j = 0; j < row.samples.length; j += count) split.push({ samples: row.samples.slice(j, j + count), indent: 0 })
        entryRows.splice(i, 1, ...split)
      }
      if (!body!.entries.includes(entry)) body!.entries.push(entry)
      draw(entryRows[i]!, frame!.x + columnIndex * (width! + PRINT.gutter), y, body!.operations)
      y += PRINT.line
    }
    y += 6
  }
  return { operations, overflow: false, continuations,
    link: { x: column.x, y: column.y + column.height - linkHeight + PRINT.line, width: column.width, height: linkHeight } }
}
