import type { PrintBounds, PrintPoint } from '../../canvas/print'
import { LabelCollisionIndex } from '../../canvas/label-collision'
import type { PdfInput, PdfOperation } from './types'
import type { PdfTextEngine } from './text'
import { MM, PRINT } from './print-style'
import { paperPlantRadius } from './plant-marks'

type TextOperation = Extract<PdfOperation, { kind: 'text' }>
export interface CanvasText {
  readonly key: string
  readonly kind: 'annotation' | 'pin' | 'distance'
  readonly anchor: PrintPoint
  readonly bounds: PrintBounds
  readonly operations: readonly TextOperation[]
  readonly lineFits: boolean
}
export function canvasText(input: PdfInput, frame: PrintBounds, ground: PrintBounds, scale: number, text: PdfTextEngine): CanvasText[] {
  const result: CanvasText[] = []
  const point = (p: PrintPoint) => ({ x: frame.x + (p.x - ground.x) * scale, y: frame.y + (p.y - ground.y) * scale })
  const add = (kind: CanvasText['kind'], source: unknown, anchor: PrintPoint, value: string, size: number,
    rotation: number, layer: string, lineStep: number, lineLength = Infinity) => {
    const a = rotation * Math.PI / 180
    const operations = text.wrap(value, size, frame.width * .8).map((line, i): TextOperation => ({
      kind: 'text', line, size, rotation, opacity: input.canvas.layers.find(l => l.name === layer)?.opacity ?? 1,
      x: anchor.x - i * lineStep * Math.sin(a), y: anchor.y + i * lineStep * Math.cos(a),
    }))
    const corners = operations.flatMap(op => {
      const b = op.line.ink
      return b ? [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]
        .map(([x, y]) => ({ x: op.x + x! * Math.cos(a) - y! * Math.sin(a), y: op.y + x! * Math.sin(a) + y! * Math.cos(a) })) : []
    })
    if (!corners.length) return
    const x = Math.min(...corners.map(p => p.x)) - MM / 2, y = Math.min(...corners.map(p => p.y)) - MM / 2
    const bounds = { x, y, width: Math.max(...corners.map(p => p.x)) + MM / 2 - x, height: Math.max(...corners.map(p => p.y)) + MM / 2 - y }
    if (!intersects(bounds, frame)) return
    result.push({ kind, key: JSON.stringify([kind, source, value]), anchor, bounds, operations,
      lineFits: operations.length === 1 ? operations[0]!.line.width + 2 * MM <= lineLength : lineLength === Infinity })
  }
  for (const plant of input.canvas.plants) if (plant.pinnedName) {
    const p = point(plant.position)
    add('pin', [plant.id, plant.position], { x: p.x, y: p.y + PRINT.marker + PRINT.line },
      input.commonNames[plant.canonicalName]?.trim() || plant.canonicalName, PRINT.text, 0, 'plants', PRINT.line)
  }
  for (const note of input.canvas.annotations) {
    const size = Math.max(PRINT.text, note.fontSize * .75)
    add('annotation', [note.id, note.position, note.rotation, note.fontSize], point(note.position), note.text, size, note.rotation, 'annotations', size * 1.3)
  }
  for (const guide of input.canvas.measurements) {
    const a = point(guide.start), b = point(guide.end)
    const value = new Intl.NumberFormat(input.locale, { maximumFractionDigits: 2 }).format(Math.hypot(guide.end.x - guide.start.x, guide.end.y - guide.start.y))
    add('distance', [guide.id, guide.start, guide.end], { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 3 }, `${value} m`, PRINT.text, 0,
      'measurement-guides', PRINT.line, Math.hypot(b.x - a.x, b.y - a.y))
  }
  return result
}

/** Tests all printed text, including later items: a colliding label cannot certify another. */
export function readableCanvasText(items: readonly CanvasText[], input: PdfInput, frame: PrintBounds, ground: PrintBounds, scale: number): Set<string> {
  const labels = new LabelCollisionIndex(), marks = new LabelCollisionIndex()
  for (const item of items) labels.add(item.bounds)
  for (const plant of input.canvas.plants) {
    const radius = paperPlantRadius(input.canvas.plants, plant, scale) * 1.5
    marks.add({ x: frame.x + (plant.position.x - ground.x) * scale - radius,
      y: frame.y + (plant.position.y - ground.y) * scale - radius, width: 2 * radius, height: 2 * radius })
  }
  return new Set(items.filter(item => contains(frame, item.bounds) && item.lineFits
    && !labels.overlaps(item.bounds, item.bounds) && !marks.overlaps(item.bounds)).map(item => item.key))
}
function intersects(a: PrintBounds, b: PrintBounds): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}
function contains(frame: PrintBounds, bounds: PrintBounds): boolean {
  return bounds.x >= frame.x && bounds.y >= frame.y && bounds.x + bounds.width <= frame.x + frame.width
    && bounds.y + bounds.height <= frame.y + frame.height
}
