import type { PrintBounds, PrintPlant, PrintPoint } from '../../canvas/print'
import { PdfTextError, type PdfTextEngine, type TextLine } from './text'
import type { PdfInput, PdfLegendEntry, PdfOperation } from './types'

export const MM = 72 / 25.4
// Provisional physical dimensions; the print-review bead owns final calibration.
export const PRINT = { margin: 10 * MM, legend: 42 * MM, gutter: 5 * MM, text: 10, line: 13,
  marker: 1.5 * MM, stroke: .25 * MM, header: 22 * MM, footer: 17 * MM, context: 3 * MM, ink: '#24211c' } as const
const IDENTITY = [1, 0, 0, 1, 0, 0] as const
export function identifyPlants(plants: readonly PrintPlant[], names: Readonly<Record<string, string>>, locale: string): PdfLegendEntry[] {
  const bySpecies = new Map<string, { canonicalName: string; name: string; appearances: PrintPlant[] }>()
  for (const plant of plants) {
    let entry = bySpecies.get(plant.canonicalName)
    if (!entry) {
      entry = { canonicalName: plant.canonicalName, name: names[plant.canonicalName]?.trim() || plant.canonicalName, appearances: [] }
      bySpecies.set(plant.canonicalName, entry)
    }
    if (!entry.appearances.some((a) => a.symbol === plant.symbol && a.color === plant.color)) entry.appearances.push(plant)
  }
  const collator = new Intl.Collator(locale)
  return Array.from(bySpecies.values()).sort((a, b) => collator.compare(a.name, b.name) || collator.compare(a.canonicalName, b.canonicalName))
}
export function ambiguousSpecies(legend: readonly PdfLegendEntry[]): string[] {
  const keys = new Map<string, Set<string>>()
  for (const entry of legend) for (const appearance of entry.appearances) {
    const key = `${appearance.symbol}:${appearance.color.toLowerCase()}`
    const species = keys.get(key) ?? new Set<string>(); species.add(entry.canonicalName); keys.set(key, species)
  }
  const ambiguous = new Set(Array.from(keys.values()).filter((s) => s.size > 1).flatMap((s) => Array.from(s)))
  return legend.filter((entry) => ambiguous.has(entry.canonicalName)).map((entry) => entry.canonicalName)
}

interface ExtentAnchor { point: PrintPoint; left: number; top: number; right: number; bottom: number }
export function fitOverview(input: PdfInput, frame: PrintBounds, text: PdfTextEngine, coverage: readonly PrintBounds[] = []): { ground: PrintBounds; pointsPerMeter: number } {
  const anchors: ExtentAnchor[] = []
  const at = (point: PrintPoint, left = 0, top = 0, right = 0, bottom = 0) => anchors.push({ point, left, top, right, bottom })
  for (const bounds of coverage) { at(bounds); at({ x: bounds.x + bounds.width, y: bounds.y + bounds.height }) }
  for (const zone of input.canvas.zones) { at(zone.bounds); at({ x: zone.bounds.x + zone.bounds.width, y: zone.bounds.y + zone.bounds.height }) }
  for (const guide of input.canvas.measurements) { at(guide.start); at(guide.end); at({ x: (guide.start.x + guide.end.x) / 2, y: (guide.start.y + guide.end.y) / 2 }, 0, -PRINT.line, 70, 0) }
  for (const plant of input.canvas.plants) {
    at(plant.position, -PRINT.marker, -PRINT.marker, PRINT.marker, PRINT.marker)
    if (plant.pinnedName) {
      const lines = text.wrap(input.commonNames[plant.canonicalName]?.trim() || plant.canonicalName, PRINT.text, frame.width * .8)
      const width = Math.max(...lines.map((l) => l.width))
      at(plant.position, 0, 0, width, PRINT.marker + lines.length * PRINT.line)
    }
  }
  for (const annotation of input.canvas.annotations) {
    const size = Math.max(PRINT.text, annotation.fontSize * .75)
    const lines = text.wrap(annotation.text, size, frame.width * .8)
    const width = Math.max(0, ...lines.map((l) => l.width)), height = lines.length * size * 1.3
    const a = annotation.rotation * Math.PI / 180
    const corners = [[0, -size], [width, -size], [width, height - size], [0, height - size]].map(([x, y]) => [x! * Math.cos(a) - y! * Math.sin(a), x! * Math.sin(a) + y! * Math.cos(a)])
    at(annotation.position, Math.min(...corners.map((p) => p[0]!)), Math.min(...corners.map((p) => p[1]!)), Math.max(...corners.map((p) => p[0]!)), Math.max(...corners.map((p) => p[1]!)))
  }
  const projected = (scale: number): PrintBounds => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const item of anchors) {
      minX = Math.min(minX, item.point.x * scale + item.left); maxX = Math.max(maxX, item.point.x * scale + item.right)
      minY = Math.min(minY, item.point.y * scale + item.top); maxY = Math.max(maxY, item.point.y * scale + item.bottom)
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
  }
  const padding = 3 * MM
  let low = 0, high = Math.min(frame.width, frame.height)
  for (let i = 0; i < 55; i++) {
    const middle = (low + high) / 2, bounds = projected(middle)
    if (bounds.width <= frame.width - 2 * padding && bounds.height <= frame.height - 2 * padding) low = middle
    else high = middle
  }
  if (low < 1e-9) throw new PdfTextError('text-too-wide')
  const bounds = projected(low)
  return { pointsPerMeter: low, ground: { x: (bounds.x - (frame.width - bounds.width) / 2) / low,
    y: (bounds.y - (frame.height - bounds.height) / 2) / low, width: frame.width / low, height: frame.height / low } }
}

export function drawCanvas(input: PdfInput, frame: PrintBounds, ground: PrintBounds, scale: number, text: PdfTextEngine, operations: PdfOperation[]): void {
  const point = (p: PrintPoint) => ({ x: frame.x + (p.x - ground.x) * scale, y: frame.y + (p.y - ground.y) * scale })
  const opacity = (name: string) => input.canvas.layers.find((l) => l.name === name)?.opacity ?? 1
  operations.push({ kind: 'clip', bounds: frame })
  for (const zone of input.canvas.zones) {
    operations.push({ kind: 'path', d: zone.path, matrix: [scale, 0, 0, scale, frame.x - ground.x * scale, frame.y - ground.y * scale],
      fill: zone.fill, stroke: PRINT.ink, width: PRINT.stroke / scale, opacity: opacity('zones') })
  }
  for (const plant of input.canvas.plants) {
    const p = point(plant.position)
    drawMark(plant, p.x, p.y, PRINT.marker, opacity('plants'), operations)
    if (plant.pinnedName) text.wrap(input.commonNames[plant.canonicalName]?.trim() || plant.canonicalName, PRINT.text, frame.width * .8)
      .forEach((line, i) => operations.push(textOp(line, p.x, p.y + PRINT.marker + PRINT.line * (i + 1), PRINT.text, 0, opacity('plants'))))
  }
  for (const annotation of input.canvas.annotations) {
    const p = point(annotation.position), size = Math.max(PRINT.text, annotation.fontSize * .75), a = annotation.rotation * Math.PI / 180
    text.wrap(annotation.text, size, frame.width * .8).forEach((line, i) => {
      const offset = i * size * 1.3
      operations.push(textOp(line, p.x - offset * Math.sin(a), p.y + offset * Math.cos(a), size, annotation.rotation, opacity('annotations')))
    })
  }
  for (const guide of input.canvas.measurements) {
    const a = point(guide.start), b = point(guide.end)
    operations.push({ ...pathOp(`M${a.x} ${a.y} L${b.x} ${b.y}`, PRINT.ink, null, PRINT.stroke), opacity: opacity('measurement-guides') })
    const value = new Intl.NumberFormat(input.locale, { maximumFractionDigits: 2 }).format(Math.hypot(guide.end.x - guide.start.x, guide.end.y - guide.start.y))
    operations.push(textOp(text.line(`${value} m`, PRINT.text), (a.x + b.x) / 2, (a.y + b.y) / 2 - 3, PRINT.text, 0, opacity('measurement-guides')))
  }
  operations.push({ kind: 'unclip' })
}

export function drawMark(plant: PrintPlant, x: number, y: number, radius: number, opacity: number, operations: PdfOperation[]): void {
  for (const mark of plant.mark) operations.push({ kind: 'path', d: mark.d, matrix: [radius, 0, 0, radius, x, y],
    fill: mark.fill ? plant.color : null, stroke: mark.stroke ? plant.color : null, width: mark.strokeWidth, opacity })
}
export function textOp(line: TextLine, x: number, y: number, size: number, rotation = 0, opacity = 1): PdfOperation {
  return { kind: 'text', line, x, y, size, rotation, opacity }
}
export function pathOp(d: string, stroke: string | null, fill: string | null, width = PRINT.stroke): Extract<PdfOperation, { kind: 'path' }> {
  return { kind: 'path', d, matrix: IDENTITY, fill, stroke, width, opacity: 1 }
}
export function rectPath(b: PrintBounds): string { return `M${b.x} ${b.y} h${b.width} v${b.height} h${-b.width} Z` }
