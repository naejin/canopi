import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { buildPdfPlan } from '../app/canvas-pdf/layout'
import { createPdfTextEngine, type PdfFontId } from '../app/canvas-pdf/text'
import { contains, outlineSegments, type Segment } from '../app/canvas-pdf/field-geometry'
import { pageFrame } from '../app/canvas-pdf/page-frame'
import { zoneTop } from '../app/canvas-pdf/zone-labels'
import type { PdfInput, PdfLabels, PdfPage, PdfSetup } from '../app/canvas-pdf/types'
import type { PrintPoint, PrintZone } from '../canvas/print'
import { englishPdfLabels } from '../../scripts/pdf-validation/fixtures'

const MM = 72 / 25.4
const labels: PdfLabels = { ...englishPdfLabels, notes: 'Notes', observations: 'Field observations', keyAndNotes: 'Key and notes', overview: 'Overview', plants: 'Plants', actualSize: 'Actual size' }
const text = () => createPdfTextEngine(new Map<PdfFontId, Uint8Array>([
  ['latin', readFileSync('public/pdf-fonts/NotoSans-Regular.ttf')], ['strong', readFileSync('public/pdf-fonts/NotoSans-SemiBold.ttf')],
]), 'en')
const row = (y: number): PrintZone => ({ name: null, path: `M0 ${y} L20 ${y} L20 ${y + 1} L0 ${y + 1} Z`, fill: null, bounds: { x: 0, y, width: 20, height: 1 },
  geometry: { kind: 'rect', points: [{ x: 0, y }, { x: 20, y }, { x: 20, y: y + 1 }, { x: 0, y: y + 1 }] } })
const layers = ['plants', 'zones', 'measurement-guides', 'annotations']
const design = (canvas: Partial<PdfInput['canvas']>): PdfInput => ({ name: 'Orchard', locale: 'en', viewBearingDeg: 60, commonNames: {}, canvas: {
  layers: layers.map(name => ({ name, visible: true, opacity: 1 })), plants: [], zones: [], annotations: [], measurements: [], ...canvas } })

/** Printed codes on a page: their text and the centre of their ink, in page points. */
function codes(page: PdfPage, pattern: RegExp) {
  return page.operations.flatMap(op => op.kind === 'text' && pattern.test(op.line.runs.map(r => r.text).join(''))
    ? [{ code: op.line.runs.map(r => r.text).join(''), centre: { x: op.x + op.line.width / 2, y: op.y - op.size * .35 } }] : [])
}
/** Plan metres to page points: the plan's one frame, then the page's ground. */
const onPage = (page: PdfPage, angle: number) => (p: PrintPoint) => {
  const q = pageFrame(angle).toFrame(p)
  return { x: page.frame.x + (q.x - page.ground.x) * page.pointsPerMeter, y: page.frame.y + (q.y - page.ground.y) * page.pointsPerMeter }
}
function toSegment(p: PrintPoint, s: Segment): number {
  const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y, t = Math.max(0, Math.min(1, ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(p.x - s.a.x - t * dx, p.y - s.a.y - t * dy)
}
function inside(p: PrintPoint, outline: Segment[]): boolean {
  let crossings = 0
  for (const { a, b } of outline) if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) crossings++
  return crossings % 2 === 1
}
const away = (p: PrintPoint, outline: Segment[]) => inside(p, outline) ? 0 : Math.min(...outline.map(s => toSegment(p, s)))

const plant = (id: string, position: PrintPoint) => ({ id, canonicalName: 'Malus domestica', speciesCode: 'MAD', position, color: '#335533', symbol: 'square',
  mark: [{ d: 'M-1 -1 H1 V1 H-1 Z', paint: 'symbol' as const }], pinnedName: false })
// A Print Area turns about its own centre, so this square holds the turned rows whole on one detail page.
const setup: PdfSetup = { paper: 'A4', layers, mapOrientation: 'as-on-screen', areas: [{ id: 'rows', name: 'Rows', bounds: { x: -5, y: -10, width: 30, height: 30 } }] }

it('prints each turned row\'s zone code on that row\'s own top, on the overview and on a detail page', () => {
  const rows = Array.from({ length: 6 }, (_, i) => row(i * 2))
  const plan = buildPdfPlan(design({ zones: rows }), setup, text(), labels)
  const pages = plan.pages.filter(p => p.kind !== 'legend')
  expect(pages.map(p => p.kind)).toEqual(['overview', 'detail'])
  for (const page of pages) {
    const outlines = rows.map(r => outlineSegments(r.path, onPage(page, 60)))
    const printed = codes(page, /^Z\d\d$/).filter(c => contains(page.frame, c.centre))
    expect(printed.map(c => c.code).sort()).toEqual(['Z01', 'Z02', 'Z03', 'Z04', 'Z05', 'Z06'])
    for (const { code, centre } of printed) {
      const own = Number(code.slice(1)) - 1
      outlines.forEach((outline, i) => {
        if (i === own) return
        expect(inside(centre, outline), `${page.kind} ${code} inside row ${i + 1}`).toBe(false)
        expect(away(centre, outlines[own]!), `${page.kind} ${code} nearer row ${i + 1}`).toBeLessThan(away(centre, outline))
      })
    }
  }
})

it('prints each guide\'s M code beside its own guide in a turned chain of eight rows', () => {
  const rows = Array.from({ length: 8 }, (_, i) => row(i * 1.5))
  const measurements = rows.slice(1).map((r, i) => ({ id: `g${i}`, start: { x: 10, y: r.bounds.y - .5 }, end: { x: 10, y: r.bounds.y } }))
  const plants = rows.flatMap((r, i) => Array.from({ length: 41 }, (_, j) => plant(`p${i}-${j}`, { x: j * .5, y: r.bounds.y + .5 })))
  const wide: PdfSetup = { ...setup, areas: [{ id: 'rows', name: 'Rows', bounds: { x: -10, y: -14, width: 40, height: 40 } }] }
  const plan = buildPdfPlan(design({ zones: rows, measurements, plants }), wide, text(), labels)
  const page = plan.pages.find(p => p.kind === 'detail')!
  const guides = measurements.map(g => ({ a: onPage(page, 60)(g.start), b: onPage(page, 60)(g.end) }))
  const references = new Map([...measurements].sort((a, b) => a.start.y - b.start.y).map((g, i) => [`M${i + 1}`, measurements.indexOf(g)]))
  const printed = codes(page, /^M\d+$/).filter(c => contains(page.frame, c.centre))
  expect(printed.length).toBeGreaterThan(0)
  for (const { code, centre } of printed) {
    const own = toSegment(centre, guides[references.get(code)!]!)
    expect(own / MM, `${code} from its guide`).toBeLessThanOrEqual(6)
    guides.forEach((guide, i) => { if (i !== references.get(code)) expect(own, `${code} nearer guide ${i}`).toBeLessThan(toSegment(centre, guide)) })
  }
})

it('tops a zone at its highest outline point inside the ground, or the middle of a level top edge', () => {
  const ground = { x: 0, y: 0, width: 10, height: 10 }
  const diamond: PrintZone = { name: null, path: 'M5 1 L8 4 L5 7 L2 4 Z', fill: null, bounds: { x: 2, y: 1, width: 6, height: 6 },
    geometry: { kind: 'polygon', points: [{ x: 5, y: 1 }, { x: 8, y: 4 }, { x: 5, y: 7 }, { x: 2, y: 4 }] } }
  expect(zoneTop(diamond, ground)).toEqual({ x: 5, y: 1 })
  expect(zoneTop(row(2), ground)).toEqual({ x: 5, y: 2 })
  // Cropped by the page, the top is where the zone enters the ground, never off it.
  expect(zoneTop(diamond, { x: 0, y: 3, width: 4, height: 5 })).toEqual({ x: 3, y: 3 })
  expect(zoneTop(row(20), ground)).toBeNull()
  const field: PrintZone = { ...row(-5), path: 'M-5 -5 L15 -5 L15 15 L-5 15 Z', geometry: { kind: 'rect', points: [{ x: -5, y: -5 }, { x: 15, y: -5 }, { x: 15, y: 15 }, { x: -5, y: 15 }] } }
  expect(zoneTop(field, ground)).toEqual({ x: 5, y: 0 })
})
