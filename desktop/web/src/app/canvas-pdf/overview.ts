import type { PrintBounds, PrintPoint } from '../../canvas/print'
import type { PdfInput } from './types'
import type { PdfTextEngine } from './text'
import type { FieldDrawing } from './field-layout'
import { drawMark, MM, pathOp, textOp } from './page-drawing'
import { paperPlantRadius } from './plant-marks'

/** Authored artwork only: no field references, inference, placement or key pagination. */
export function drawOverview(input: PdfInput, frame: PrintBounds, ground: PrintBounds, scale: number, text: PdfTextEngine): FieldDrawing {
  const canvas = input.canvas
  const drawing: FieldDrawing = { operations: [], links: [], destinations: [], legend: [], notes: [], identifiedPlants: [],
    annotationIds: canvas.annotations.map(n => n.id), measurementIds: canvas.measurements.map(g => g.id), pageReferences: [] }
  const operations = drawing.operations
  const point = (p: PrintPoint) => ({ x: frame.x + (p.x - ground.x) * scale, y: frame.y + (p.y - ground.y) * scale })
  const opacity = (name: string) => canvas.layers.find(l => l.name === name)?.opacity ?? 1
  // Canvas annotation sizes are screen pixels. A fixed reference scale keeps
  // overview text proportional to artwork instead of expanding over dense beds.
  const textScale = Math.min(.75, scale / 60)
  operations.push({ kind: 'clip', bounds: frame })
  for (const zone of canvas.zones) operations.push({ kind: 'path', d: zone.path,
    matrix: [scale, 0, 0, scale, frame.x - ground.x * scale, frame.y - ground.y * scale],
    fill: zone.fill, stroke: '#8b877f', width: .18 * MM / scale, opacity: opacity('zones') })
  for (const guide of canvas.measurements) {
    const a = point(guide.start), b = point(guide.end)
    operations.push({ ...pathOp(`M${a.x} ${a.y} L${b.x} ${b.y}`, '#8b877f', null, .18 * MM), opacity: opacity('measurement-guides') })
    const value = new Intl.NumberFormat(input.locale, { maximumFractionDigits: 2 }).format(Math.hypot(guide.end.x - guide.start.x, guide.end.y - guide.start.y))
    operations.push(textOp(text.line(`${value} m`, 10 * textScale), (a.x + b.x) / 2, (a.y + b.y) / 2 - textScale, 10 * textScale, 0, opacity('measurement-guides')))
  }
  for (const plant of canvas.plants) {
    const p = point(plant.position)
    drawMark(plant, p.x, p.y, Math.min(MM, paperPlantRadius(canvas.plants, plant, scale)), opacity('plants'), operations)
    if (plant.pinnedName) operations.push(textOp(text.line(plant.canonicalName, 12 * textScale), p.x + MM, p.y - textScale, 12 * textScale, 0, opacity('plants')))
  }
  for (const note of canvas.annotations) {
    const p = point(note.position), size = note.fontSize * textScale, angle = note.rotation * Math.PI / 180
    note.text.replace(/\r\n?/g, '\n').split('\n').forEach((value, index) => {
      const offset = size * (1 + index * 1.25)
      operations.push(textOp(text.line(value, size), p.x - Math.sin(angle) * offset, p.y + Math.cos(angle) * offset, size, note.rotation, opacity('annotations')))
    })
  }
  operations.push({ kind: 'unclip' })
  return drawing
}
