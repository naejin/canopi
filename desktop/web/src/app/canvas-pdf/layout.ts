import type { CanvasPrintSnapshot, PrintBounds, PrintPlant, PrintPoint } from '../../canvas/print'
import { PdfTextError, type PdfTextEngine, type TextLine } from './text'
import type { PdfInput, PdfLabels, PdfLegendEntry, PdfOperation, PdfPage, PdfPlan, PdfSetup } from './types'

export const MM = 72 / 25.4
// Provisional physical dimensions; the print-review bead owns final calibration.
export const PRINT = { margin: 10 * MM, legend: 42 * MM, gutter: 5 * MM, text: 10, line: 13,
  marker: 1.5 * MM, stroke: .25 * MM, header: 22 * MM, footer: 17 * MM, ink: '#24211c' } as const
const IDENTITY = [1, 0, 0, 1, 0, 0] as const

export function printableCanvas(canvas: CanvasPrintSnapshot, layers: readonly string[]): CanvasPrintSnapshot {
  const selected = (name: string) => layers.includes(name) && (canvas.layers.find((l) => l.name === name)?.opacity ?? 1) > 0
  return { layers: canvas.layers, plants: selected('plants') ? canvas.plants : [], zones: selected('zones') ? canvas.zones : [],
    annotations: selected('annotations') ? canvas.annotations : [], measurements: selected('measurement-guides') ? canvas.measurements : [] }
}
export function buildPdfPlan(input: PdfInput, setup: PdfSetup, text: PdfTextEngine, labels: PdfLabels): PdfPlan {
  const canvas = printableCanvas(input.canvas, setup.layers)
  if (!canvas.plants.length && !canvas.zones.length && !canvas.annotations.length && !canvas.measurements.length) {
    return { pages: [], outlines: text.outlines, blocked: 'empty' }
  }
  const candidates = setup.orientation === 'auto' ? ['portrait', 'landscape'] as const : [setup.orientation]
  const pages = candidates.map((orientation) => overviewPage({ ...input, canvas }, setup.paper, orientation, text, labels))
  pages.sort((a, b) => Number(a.overflow) - Number(b.overflow) || b.pointsPerMeter - a.pointsPerMeter)
  const page = pages[0]!
  return { pages: [page], outlines: text.outlines, blocked: page.overflow ? 'legend-overflow' : null }
}

function overviewPage(input: PdfInput, paper: 'A4' | 'Letter', orientation: 'portrait' | 'landscape', text: PdfTextEngine, labels: PdfLabels): PdfPage {
  const sides = paper === 'A4' ? [210 * MM, 297 * MM] : [612, 792]
  const width = sides[orientation === 'portrait' ? 0 : 1]!
  const height = sides[orientation === 'portrait' ? 1 : 0]!
  const frame = { x: PRINT.margin, y: PRINT.header, width: width - 2 * PRINT.margin - PRINT.gutter - PRINT.legend,
    height: height - PRINT.header - PRINT.footer }
  const legend = identifyPlants(input.canvas.plants, input.commonNames, input.locale)
  const operations: PdfOperation[] = []
  const addText = (value: string, x: number, y: number, size: number = PRINT.text) => operations.push(textOp(text.line(value, size), x, y, size))
  const titleLines = text.wrap(`${input.name} · ${labels.overview}`, 12, width - 2 * PRINT.margin)
  if (titleLines.length > 2) throw new PdfTextError('text-too-wide')
  titleLines.forEach((line, i) => operations.push(textOp(line, PRINT.margin, 12 * MM + i * 15, 12)))
  const { ground, pointsPerMeter } = fitOverview(input, frame, text)
  drawCanvas(input, frame, ground, pointsPerMeter, text, operations)
  operations.push(pathOp(rectPath(frame), PRINT.ink, null, PRINT.stroke))
  const legendX = frame.x + frame.width + PRINT.gutter
  const heading = text.wrap(labels.plants, PRINT.text, PRINT.legend)
  heading.forEach((line, i) => operations.push(textOp(line, legendX, frame.y + PRINT.text + i * PRINT.line, PRINT.text)))
  const overflow = drawLegend(legend, legendX, frame.y + (heading.length + 1) * PRINT.line, PRINT.legend, frame.y + frame.height, text, operations)
  const scaleY = height - 11 * MM
  operations.push(pathOp(`M${PRINT.margin} ${scaleY} h${50 * MM} M${PRINT.margin} ${scaleY - 2} v4 M${PRINT.margin + 50 * MM} ${scaleY - 2} v4`, PRINT.ink, null, PRINT.stroke))
  const distance = new Intl.NumberFormat(input.locale, { maximumSignificantDigits: 5 }).format(50 * MM / pointsPerMeter)
  addText(`50 mm · ${distance} m`, PRINT.margin, height - 5 * MM, 9)
  const footer = `${labels.actualSize} · ~1:${Math.round(1000 * MM / pointsPerMeter)}`
  const footerLines = text.wrap(footer, 9, width - 2 * PRINT.margin - 55 * MM)
  if (footerLines.length > 2) throw new PdfTextError('text-too-wide')
  footerLines.forEach((line, i) => operations.push(textOp(line, PRINT.margin + 55 * MM, height - (9 - i * 4) * MM, 9)))
  return { kind: 'overview', number: 1, width, height, frame, ground, pointsPerMeter, operations, legend, overflow,
    ambiguousSpecies: ambiguousSpecies(legend) }
}

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
function fitOverview(input: PdfInput, frame: PrintBounds, text: PdfTextEngine): { ground: PrintBounds; pointsPerMeter: number } {
  const anchors: ExtentAnchor[] = []
  const at = (point: PrintPoint, left = 0, top = 0, right = 0, bottom = 0) => anchors.push({ point, left, top, right, bottom })
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

export function drawLegend(entries: readonly PdfLegendEntry[], x: number, startY: number, width: number, bottom: number, text: PdfTextEngine, operations: PdfOperation[]): boolean {
  let y = startY
  let overflow = false
  for (const entry of entries) {
    const rows = Math.ceil(entry.appearances.length / 5)
    const lines = text.wrap(entry.name, PRINT.text, width - 2 * PRINT.marker - 5)
    const height = (entry.appearances.length === 1 ? Math.max(lines.length * PRINT.line, 2 * PRINT.marker) : lines.length * PRINT.line + rows * 2.5 * PRINT.marker) + 6
    if (y + height > bottom) { overflow = true; continue }
    if (entry.appearances.length === 1) {
      drawMark(entry.appearances[0]!, x + PRINT.marker, y - 3, PRINT.marker, 1, operations)
      lines.forEach((line, i) => operations.push(textOp(line, x + 2 * PRINT.marker + 5, y + i * PRINT.line, PRINT.text)))
    } else {
      entry.appearances.forEach((plant, i) => drawMark(plant, x + PRINT.marker + i % 5 * 3 * PRINT.marker, y + Math.floor(i / 5) * 2.5 * PRINT.marker - 3, PRINT.marker, 1, operations))
      lines.forEach((line, i) => operations.push(textOp(line, x, y + rows * 2.5 * PRINT.marker + i * PRINT.line, PRINT.text)))
    }
    y += height
  }
  return overflow
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
