import type { PrintBounds, PrintPlant } from '../../canvas/print'
import type { PdfTextEngine, TextLine } from './text'
import type { PdfDestination, PdfLabels, PdfLegendEntry, PdfLink, PdfOperation } from './types'
import type { FieldDrawing, FieldNote } from './field-layout'
import { MM, PRINT } from './print-style'
import { drawMark, pathOp, textOp } from './page-drawing'
import { fieldLabels } from './labels'
import { drawEnclosure } from './field-identity'

export interface KeyGeometry { width: number; height: number; frame: PrintBounds; columns?: number; bodyTop?: number; compact?: boolean; keyFrame?: PrintBounds }
export interface FieldKeyBody extends KeyGeometry {
  operations: PdfOperation[]
  links: PdfLink[]
  destinations: PdfDestination[]
  entries: PdfLegendEntry[]
}
interface Row { lines: TextLine[]; size: number; color: string; indent: number; samples?: readonly PrintPlant[] }
interface Block { reference: string; target: string; destination: string; rows: Row[]; entry?: PdfLegendEntry; count?: number }
const OCHRE = '#A06B1F'

/** Complete names and annotations paginate at fixed physical type sizes. */
export function fieldKey(drawing: FieldDrawing, sourceId: string, geometry: (index: number) => KeyGeometry, text: PdfTextEngine, labels: PdfLabels, opacity: number): FieldKeyBody[] {
  if (!drawing.legend.length && !drawing.notes.length) return []
  const notes = drawing.notes.filter(n => !n.species)
  const speciesNotes = (entry: PdfLegendEntry) => drawing.notes.filter(n => n.species === entry.canonicalName)
  const pages: FieldKeyBody[] = []
  let body!: FieldKeyBody
  let y!: number[]
  let columns = 2, width = 0, column = 0
  const newPage = () => {
    if (pages.length >= 199) throw new Error('coverage-too-large')
    const g = geometry(pages.length)
    body = { ...g, operations: [], links: [], destinations: [], entries: [] }; pages.push(body)
    columns = g.columns ?? (g.width > g.height ? 3 : 2); width = (g.frame.width - (columns - 1) * PRINT.gutter) / columns
    y = Array(columns).fill(g.frame.y + (g.compact ? 6 * MM : 0)); column = 0
    if (g.compact) {
      const wording = fieldLabels(labels), quantity = text.line(wording.quantity, 7, true)
      body.operations.push({ ...textOp(text.line(wording.plantKey, 8, true), g.frame.x, g.frame.y + 8, 8), color: '#655f55' },
        { ...textOp(quantity, g.frame.x + g.frame.width - quantity.width, g.frame.y + 8, 7), color: '#655f55' })
    }
  }
  newPage()
  const rowsForSpecies = (entry: PdfLegendEntry, available: number): Row[] => {
    const indent = 16 * MM, result: Row[] = []
    const samplesPerRow = Math.max(1, Math.floor((available - 10 * MM) / (2 * PRINT.marker + MM)))
    const nameSize = body.compact ? 9.5 : 10, canonicalSize = body.compact ? 7.5 : 8
    result.push({ lines: text.wrap(entry.name, nameSize, available - indent - 8 * MM), size: nameSize, color: PRINT.ink, indent, samples: entry.appearances.slice(0, 1) })
    const secondary = entry.name !== entry.canonicalName ? entry.canonicalName : ''
    if (secondary) result.push({ lines: text.wrap(secondary, canonicalSize, available - (body.compact ? 0 : indent)), size: canonicalSize, color: '#655f55', indent: body.compact ? 0 : indent })
    for (let i = 1; i < entry.appearances.length; i += samplesPerRow)
      result.push({ lines: [], size: 9, color: PRINT.ink, indent: 10 * MM, samples: entry.appearances.slice(i, i + samplesPerRow) })
    const locations = speciesNotes(entry)
    const compactLocations = locations.filter(n => !n.location).map(n => n.reference).join(' · ')
    if (compactLocations) result.push({ lines: text.wrap(compactLocations, 8, available), size: 8, color: OCHRE, indent: 0 })
    for (const note of locations.filter(n => n.location)) result.push({ lines: text.wrap(`${note.reference} · ${note.location}`, 8, available), size: 8, color: OCHRE, indent: 0 })
    return result
  }
  const rowsForNote = (note: FieldNote, available: number): Row[] => [
    { lines: text.wrap(note.text, body.compact ? 9 : 9.5, available - 12 * MM), size: body.compact ? 9 : 9.5, color: PRINT.ink, indent: 12 * MM },
    ...note.location ? [{ lines: text.wrap(note.location, 8, available - 12 * MM), size: 8, color: '#655f55', indent: 12 * MM }] : [],
  ]
  const rowHeight = (row: Row) => Math.max(row.samples?.length ? 3 * MM : 0, row.lines.reduce((sum, line) => sum
    + (body.compact ? row.size * 1.1 : Math.max(row.size * 1.1, row.size + (line.ink ? line.ink.y + line.ink.height : 0) + .3)), 0))
  const height = (rows: Row[]) => {
    let advance = 0, inkBottom = 0
    for (const row of rows) {
      for (const [i, line] of row.lines.entries()) inkBottom = Math.max(inkBottom, advance + row.size + i * row.size * 1.1 + (line.ink ? line.ink.y + line.ink.height : 0))
      advance += rowHeight(row)
    }
    return body.compact ? Math.max(5 * MM, advance + .5 * MM, inkBottom + .8 * MM) : Math.max(7 * MM, advance + .8 * MM)
  }
  const nextColumn = () => { if (++column >= columns) newPage() }
  const emit = (block: Block) => {
    const rows = block.rows
    if (y[column]! + height(rows) > body.frame.y + body.frame.height && y[column]! > body.frame.y) nextColumn()
    let fragmentTop = y[column]!, inkBottom = fragmentTop
    const begin = () => {
      fragmentTop = y[column]!; inkBottom = fragmentTop
      const x = body.frame.x + column * (width + PRINT.gutter)
      const first = { x, y: y[column]!, width, height: Math.min(height(rows), body.frame.y + body.frame.height - y[column]!) }
      if (!pages.some(p => p.destinations.some(d => d.id === block.destination))) body.destinations.push({ id: block.destination, bounds: first })
      body.links.push({ bounds: first, target: block.target })
      body.operations.push({ ...textOp(text.line(block.entry?.code ?? block.reference, block.entry ? 8 : 9.5, true), x, y[column]! + 10, block.entry ? 8 : 9.5), color: block.entry ? PRINT.ink : OCHRE })
      if (block.entry && !body.entries.includes(block.entry)) {
        body.entries.push(block.entry)
        for (const note of speciesNotes(block.entry)) if (!pages.some(p => p.destinations.some(d => d.id === `${sourceId}:note:${note.reference}`)))
          body.destinations.push({ id: `${sourceId}:note:${note.reference}`, bounds: first })
      }
      if (block.count !== undefined) {
        const value = text.line(`×${block.count}`, 8.5)
        body.operations.push({ ...textOp(value, x + width - value.width, y[column]! + 10, 8.5), color: '#655f55' })
      }
    }
    begin()
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index]!
      const available = width - row.indent - (block.entry && index === 0 ? 8 * MM : 0)
      // Orientation overrides can change the width of an oversized continued entry.
      const wrapped = row.lines.flatMap(line => line.width > available ? text.wrap(line.runs.map(r => r.text).join(''), row.size, available) : [line])
      const fragments = wrapped.length ? wrapped.map((line, i) => ({ ...row, lines: [line], samples: i === 0 ? row.samples : undefined })) : [row]
      for (let fi = 0; fi < fragments.length; fi++) {
        let fragment = fragments[fi]!
        if (y[column]! + rowHeight(fragment) + .8 * MM > body.frame.y + body.frame.height) {
          nextColumn(); begin()
        }
        const currentWidth = width - fragment.indent - (block.entry && index === 0 ? 8 * MM : 0)
        if (fragment.lines[0] && fragment.lines[0].width > currentWidth) {
          const lines = text.wrap(fragment.lines[0].runs.map(run => run.text).join(''), fragment.size, currentWidth)
          fragments.splice(fi, 1, ...lines.map((line, i) => ({ ...fragment, lines: [line], samples: i === 0 ? fragment.samples : undefined })))
          fragment = fragments[fi]!
        }
        if (index > 0 && fragment.samples?.length) {
          const capacity = Math.max(1, Math.floor((width - fragment.indent + MM) / (2 * PRINT.marker + MM)))
          if (fragment.samples.length > capacity) {
            fragments.splice(fi + 1, 0, { ...fragment, lines: [], samples: fragment.samples.slice(capacity) })
            fragment = { ...fragment, samples: fragment.samples.slice(0, capacity) }
          }
        }
        const x = body.frame.x + column * (width + PRINT.gutter), top = y[column]!
        for (const line of fragment.lines) {
          body.operations.push({ ...textOp(line, x + fragment.indent, top + fragment.size, fragment.size), color: fragment.color })
          inkBottom = Math.max(inkBottom, top + fragment.size + (line.ink ? line.ink.y + line.ink.height : 0))
        }
        fragment.samples?.forEach((plant, i) => {
          const cx = x + (index === 0 ? 11 * MM : fragment.indent + PRINT.marker) + i * (2 * PRINT.marker + MM)
          drawMark(plant, cx, top + (body.compact ? 1.8 : 2) * MM, PRINT.marker, opacity, body.operations)
          drawEnclosure(block.entry?.enclosures?.[block.entry.appearances.indexOf(plant)] ?? 'plain', cx, top + (body.compact ? 1.8 : 2) * MM, PRINT.marker, opacity, body.operations)
        })
        y[column]! += rowHeight(fragment)
      }
    }
    const x = body.frame.x + column * (width + PRINT.gutter)
    y[column] = body.compact ? Math.max(y[column]! + .5 * MM, inkBottom + .8 * MM, fragmentTop + 5 * MM) : Math.max(y[column]! + .8 * MM, fragmentTop + 7 * MM)
    body.operations.push(pathOp(`M${x} ${y[column]! - (body.compact ? .3 : .5) * MM} h${width}`, PRINT.legendRule, null, .1 * MM))
  }
  // Balance ordinary entries vertically, retaining their complete reading order.
  const speciesHeight = drawing.legend.reduce((sum, e) => sum + height(rowsForSpecies(e, width)), 0)
  const targetHeight = Math.ceil(speciesHeight / columns)
  for (const entry of drawing.legend) {
    const rows = rowsForSpecies(entry, width)
    if (column < columns - 1 && y[column]! > body.frame.y && y[column]! - body.frame.y + height(rows) > targetHeight && targetHeight < body.frame.height) column++
    emit({ reference: entry.reference!, target: `${sourceId}:species:${entry.reference}`, destination: `${sourceId}:key:${entry.reference}`, rows, entry, count: entry.count })
  }
  if (notes.length) {
    let top = Math.max(...y!) + (body.compact ? 3 : 5) * MM
    if (top + (body.compact ? 5 * MM + height(rowsForNote(notes[0]!, width)) : 25 * MM) > body!.frame.y + body!.frame.height) { newPage(); top = body!.frame.y }
    body!.operations.push({ ...textOp(text.line(labels.notes, 9.5), body!.frame.x, top + 9.5, 9.5), color: OCHRE })
    y = Array(columns).fill(top + (body.compact ? 5 : 6) * MM); column = 0
    const noteHeight = notes.reduce((sum, n) => sum + height(rowsForNote(n, width)), 0)
    const target = Math.ceil(noteHeight / columns)
    for (const note of notes) {
      const rows = rowsForNote(note, width)
      if (column < columns - 1 && y[column]! > top + (body.compact ? 5 : 6) * MM && y[column]! - top - 6 * MM + height(rows) > target) column++
      emit({ reference: note.reference, target: `${sourceId}:anchor:${note.reference}`, destination: `${sourceId}:note:${note.reference}`, rows })
    }
  }
  const free = Math.max(...y!) + 10 * MM
  if (body!.frame.y + body!.frame.height - free >= 40 * MM) {
    body!.operations.push({ ...textOp(text.line(labels.observations, 8.5), body!.frame.x, free, 8.5), color: OCHRE })
    for (let line = free + 10 * MM; line < body!.frame.y + body!.frame.height; line += 10 * MM)
      body!.operations.push(pathOp(`M${body!.frame.x} ${line} h${body!.frame.width}`, PRINT.legendRule, null, .1 * MM))
  }
  return pages
}
