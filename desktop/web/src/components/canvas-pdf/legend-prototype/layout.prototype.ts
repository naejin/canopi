// THROWAWAY: compare three legend structures with the current physical type size.
import { drawMark, textOp, pathOp, MM, PRINT } from '../../../app/canvas-pdf/page-drawing'
import type { PdfLegendEntry, PdfOperation } from '../../../app/canvas-pdf/types'
import type { PdfTextEngine } from '../../../app/canvas-pdf/text'

export type Variant = 'A' | 'B' | 'C'
export const variants = {
  A: { name: 'Compact column', width: 42 * MM, columns: 1, note: 'Keep the narrow sidebar. Tight rows, complete names, inline appearance samples.' },
  B: { name: 'Two-column sidebar', width: 76 * MM, columns: 2, note: 'A shorter legend, but 34 mm less canvas width. Narrower name columns can wrap more.' },
  C: { name: 'Footer key', width: 190 * MM, columns: 4, note: 'Four reading columns below the drawing. Full canvas width, but less canvas height.' },
} as const

export function layoutPrototype(entries: readonly PdfLegendEntry[], text: PdfTextEngine, variant: Variant | 'current') {
  const width = variant === 'current' ? 42 * MM : variants[variant].width
  const columns = variant === 'current' ? 1 : variants[variant].columns
  const columnWidth = (width - (columns - 1) * 4 * MM) / columns
  const rows = entries.map(entry => {
    const current = variant === 'current', count = entry.appearances.length
    const sampleWidth = count * 3 * MM + (count - 1) * .8 * MM
    const inline = current ? count === 1 : count > 0 && sampleWidth + MM < columnWidth * .32
    const indent = inline ? current ? 2 * PRINT.marker + 5 : sampleWidth + MM : 0
    const lines = text.wrap(entry.name, 10, columnWidth - indent)
    const perRow = Math.max(1, Math.floor(columnWidth / (3 * PRINT.marker)))
    const sampleRows = inline ? 0 : Math.ceil(count / perRow)
    return { entry, lines, inline, indent, perRow, height: (lines.length + sampleRows) * 13 + (current ? 6 : 2) }
  })
  // Contiguous alphabetical columns; balance by shaped height, never split a name.
  const groups: typeof rows[] = []
  let cursor = 0, remainingHeight = rows.reduce((sum, row) => sum + row.height, 0)
  for (let col = 0; col < columns; col++) {
    const group: typeof rows = [], target = remainingHeight / (columns - col)
    let used = 0
    while (cursor < rows.length) {
      const row = rows[cursor]!
      if (col < columns - 1 && group.length && used + row.height / 2 > target) break
      group.push(row); used += row.height; cursor++
    }
    groups.push(group); remainingHeight -= used
  }
  const operations: PdfOperation[] = []
  const heading = text.wrap('Plants on this page', 10, width)
  heading.forEach((line, index) => operations.push(textOp(line, 0, 10 + index * 13, 10)))
  const top = (heading.length + 1) * 13
  let height = top
  groups.forEach((group, column) => {
    const x = column * (columnWidth + 4 * MM)
    let y = top
    for (const row of group) {
      row.lines.forEach((line, index) => operations.push(textOp(line, x + row.indent, y + 10 + index * 13, 10)))
      row.entry.appearances.forEach((plant, index) => {
        const spacing = variant === 'current' ? 3 * PRINT.marker : 3.8 * MM
        const sx = row.inline ? x + PRINT.marker + index * spacing : x + PRINT.marker + index % row.perRow * 3 * PRINT.marker
        const sy = row.inline ? y + 7 : y + row.lines.length * 13 + Math.floor(index / row.perRow) * 13 + 7
        drawMark(plant, sx, sy, PRINT.marker, 1, operations)
      })
      y += row.height
      if (variant !== 'current') operations.push(pathOp(`M${x} ${y - 1} h${columnWidth}`, '#d8d2c8', null, .25))
    }
    height = Math.max(height, y)
  })
  return { width, height, operations, count: entries.length }
}
