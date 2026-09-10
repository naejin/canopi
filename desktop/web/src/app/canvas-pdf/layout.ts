import type { CanvasPrintSnapshot, PrintBounds } from '../../canvas/print'
import type { PdfTextEngine } from './text'
import { MM, PRINT, fitOverview, textOp, pathOp, rectPath } from './page-drawing'
import { moveCoverage, zoomCoverage, fitArea } from './coverage'
import { drawField, fieldReferences, visibleFieldCanvas, type FieldDrawing } from './field-layout'
import { fieldKey } from './field-key'
import { contains } from './field-geometry'
import { pdfAreaKey } from './types'
import type { PdfInput, PdfLabels, PdfOperation, PdfPage, PdfPlan, PdfSetup, PdfPageView } from './types'

type Geometry = Pick<PdfPage, 'width' | 'height' | 'frame'>
const orientations = (view: PdfPageView = {}) => !view.orientation || view.orientation === 'auto' ? ['portrait', 'landscape'] as const : [view.orientation]
export function printableCanvas(canvas: CanvasPrintSnapshot, layers: readonly string[]): CanvasPrintSnapshot {
  const selected = (name: string) => layers.includes(name) && (canvas.layers.find(l => l.name === name)?.opacity ?? 1) > 0
  return { layers: canvas.layers, plants: selected('plants') ? canvas.plants : [], zones: selected('zones') ? canvas.zones : [],
    annotations: selected('annotations') ? canvas.annotations : [], measurements: selected('measurement-guides') ? canvas.measurements : [] }
}

export function buildPdfPlan(input: PdfInput, setup: PdfSetup, text: PdfTextEngine, labels: PdfLabels): PdfPlan {
  const selected = { ...input, canvas: printableCanvas(input.canvas, setup.layers) }, references = fieldReferences(input)
  const details: PdfPage[] = []
  const empty = !(setup.areas?.length || selected.canvas.plants.length || selected.canvas.zones.length || selected.canvas.annotations.length || selected.canvas.measurements.length)
  const asPages = (id: string, kind: 'overview' | 'detail', geometry: Geometry, ground: PrintBounds, scale: number, drawing: FieldDrawing, areaName?: string): PdfPage[] => {
    const keyGeometry = (index: number) => {
      const view = setup.views?.[`${id}:legend:${index}`]
      const orientation = !view?.orientation || view.orientation === 'auto' ? geometry.width > geometry.height ? 'landscape' : 'portrait' : view.orientation
      return pageGeometry(setup.paper, orientation, 'legend')
    }
    const bodies = fieldKey(drawing, id, keyGeometry, text, labels, selected.canvas.layers.find(l => l.name === 'plants')?.opacity ?? 1)
    const continuations: PdfPage[] = bodies.map((body, index) => ({ ...body, id: `${id}:legend:${index}`, sourceId: id, kind: 'legend', number: 0,
      ground: { x: 0, y: 0, width: 0, height: 0 }, pointsPerMeter: 0, legend: body.entries }))
    const page: PdfPage = { ...geometry, ...drawing, id, kind, number: 0, ground, pointsPerMeter: scale,
      ...(areaName === undefined ? {} : { areaName, areaKey: id }), continuationIds: continuations.map(p => p.id) }
    return [page, ...continuations]
  }
  const fittedDetails = (setup.areas ?? []).map(area => {
    const id = pdfAreaKey(area), view = setup.views?.[id], requested = area.bounds
    if (![requested.x, requested.y, requested.width, requested.height].every(Number.isFinite) || requested.width <= 0 || requested.height <= 0) throw new Error('invalid-page-view')
    const choices = requested.width === requested.height && (!view?.orientation || view.orientation === 'auto') ? ['portrait'] as const : orientations(view)
    const candidates = choices.map(orientation => {
      const geometry = pageGeometry(setup.paper, orientation, 'detail')
      const fit = fitArea(requested, geometry.frame, view?.zoom)
      return { geometry: { ...geometry, frame: fit.frame }, ...moveCoverage(fit, view?.offset) }
    }).sort((a, b) => b.pointsPerMeter - a.pointsPerMeter)
    const { geometry, ground, pointsPerMeter } = candidates[0]!
    return { id, area, geometry, ground, pointsPerMeter }
  })
  references.measurementHomes = new Map(selected.canvas.measurements.flatMap(guide => {
    const home = fittedDetails.filter(p => contains(p.ground, guide.start) && contains(p.ground, guide.end))
      .sort((a, b) => b.pointsPerMeter - a.pointsPerMeter)[0]
    return home ? [[guide.id, home.id]] : []
  }))
  for (const { id, area, geometry, ground, pointsPerMeter } of fittedDetails) {
    const visible = { ...selected, canvas: visibleFieldCanvas(selected.canvas, ground) }
    const drawing = drawField(visible, geometry.frame, ground, pointsPerMeter, { id, ...geometry }, text, references)
    details.push(...asPages(id, 'detail', geometry, ground, pointsPerMeter, drawing, area.name))
    if (details.length > 199) throw new Error('coverage-too-large')
  }
  const detailMaps = details.filter(p => p.kind === 'detail')
  const extents = detailMaps.map(p => p.ground)
  const fits = orientations(setup.views?.overview).map(orientation => {
    const geometry = pageGeometry(setup.paper, orientation, 'overview')
    return { geometry, ...fitOverview(selected, geometry.frame, empty ? [{ x: -5, y: -5, width: 10, height: 10 }] : extents) }
  }).sort((a, b) => b.pointsPerMeter - a.pointsPerMeter)
  const fitted = fits[0]!, overviewFit = moveCoverage(zoomCoverage(fitted, setup.views?.overview?.zoom), setup.views?.overview?.offset)
  const visible = visibleFieldCanvas(selected.canvas, overviewFit.ground)
  // Complete annotations already have a readable home in their detail's key.
  const annotations = detailMaps.length ? visible.annotations.filter(n => !detailMaps.some(p => p.annotationIds?.includes(n.id))) : visible.annotations
  const measurements = detailMaps.length ? visible.measurements.filter(g => !detailMaps.some(p => contains(p.ground, g.start) && contains(p.ground, g.end))) : visible.measurements
  const drawing = drawField({ ...selected, canvas: { ...visible, annotations, measurements } }, fitted.geometry.frame, overviewFit.ground, overviewFit.pointsPerMeter,
    { id: 'overview', ...fitted.geometry }, text, references, detailMaps.length > 0)
  if (detailMaps.length) drawing.legend = []
  const overviewPages = asPages('overview', 'overview', fitted.geometry, overviewFit.ground, overviewFit.pointsPerMeter, drawing)
  // Keep detailed map/key pairs adjacent. Uncovered overview notes follow them.
  const pages = [overviewPages[0]!, ...details, ...overviewPages.slice(1)].map((page, i) => ({ ...page, number: i + 1 }))
  if (pages.length > 200) throw new Error('coverage-too-large')
  const byId = new Map(pages.map(page => [page.id, page]))
  const finalized = pages.map((page): PdfPage => {
    const operations = [...page.operations], links = [...page.links ?? []]
    for (const reference of page.pageReferences ?? []) {
      const target = byId.get(reference.target)!
      const { x, y, size } = reference, mid = y - size * .35
      operations.push(pathOp(`M${x} ${mid} h${3 * MM} m${-MM} ${-MM} l${MM} ${MM} l${-MM} ${MM}`, '#A06B1F', null, .2 * MM))
      operations.push({ ...textOp(text.line(String(target.number), size), x + 4 * MM, y, size), color: '#A06B1F' })
    }
    if (page.kind === 'overview') {
      const heading = text.wrap(input.name, 14, page.width - 40 * MM)
      if (heading.length > 2) {
        const second = heading[1]!.runs.map(run => run.text).join('')
        heading[1] = text.line(`${second}…`, 14)
      }
      heading.slice(0, 2).forEach((line, i) => operations.push(textOp(line, 10 * MM, (12 + i * 5) * MM, 14)))
      operations.push(textOp(text.line(labels.overview, 9), 10 * MM, 22 * MM, 9))
      if (detailMaps.length) drawNavigation(page, pages.filter(p => p.kind === 'detail'), text, operations, links)
      const y = page.height - 12 * MM
      operations.push(pathOp(`M${10 * MM} ${y} h${50 * MM} M${10 * MM} ${y - 2} v4 M${60 * MM} ${y - 2} v4`, PRINT.ink, null, .25 * MM))
      const distance = new Intl.NumberFormat(input.locale, { maximumSignificantDigits: 5 }).format(50 * MM / page.pointsPerMeter)
      operations.push(textOp(text.line(`${distance} m · ${labels.actualSize}`, 8), 10 * MM, page.height - 6 * MM, 8))
      operations.push(textOp(text.line(String(page.number), 22), page.width - 16 * MM, 14 * MM, 22))
    } else if (page.kind === 'detail') {
      operations.push(textOp(text.line(String(page.number), 22), 9 * MM, 16 * MM, 22))
      if (page.continuationIds?.[0]) links.push({ bounds: { x: 8 * MM, y: 8 * MM, width: 13 * MM, height: 11 * MM }, target: `page:${page.continuationIds[0]}` })
    } else {
      const source = byId.get(page.sourceId!)!
      operations.push(textOp(text.line(`${source.number} · ${labels.keyAndNotes}`, 16), 10 * MM, 13 * MM, 16))
      if (source.legend.length) operations.push(textOp(text.line(`${source.legend.reduce((sum, entry) => sum + (entry.count ?? 0), 0)} ${labels.plants}`, 8.5), 10 * MM, 18 * MM, 8.5))
      links.push({ bounds: { x: 10 * MM, y: 7 * MM, width: 100 * MM, height: 10 * MM }, target: `page:${source.id}` })
    }
    return { ...page, operations, links }
  })
  const pickerFits = orientations().map(orientation => {
    const geometry = pageGeometry(setup.paper, orientation, 'detail')
    return { geometry, ...fitOverview(selected, geometry.frame, extents.length ? extents : empty ? [{ x: -5, y: -5, width: 10, height: 10 }] : []) }
  }).sort((a, b) => b.pointsPerMeter - a.pointsPerMeter)
  const picker = pickerFits[0]!
  const pickerDrawing = drawField({ ...selected, canvas: { ...selected.canvas, annotations: [], measurements: [] } }, picker.geometry.frame, picker.ground, picker.pointsPerMeter,
    { id: 'picker', ...picker.geometry }, text, references, true)
  const pickerPage: PdfPage = { id: 'overview', kind: 'overview', number: 1, ...picker.geometry, ...pickerDrawing, ground: picker.ground, pointsPerMeter: picker.pointsPerMeter }
  return { pages: finalized, pickerPage, outlines: text.outlines, blocked: empty ? 'empty' : null }
}

function pageGeometry(paper: 'A4' | 'Letter', orientation: 'portrait' | 'landscape', kind: PdfPage['kind']): Geometry {
  const sides = paper === 'A4' ? [210 * MM, 297 * MM] : [612, 792]
  const width = sides[orientation === 'portrait' ? 0 : 1]!, height = sides[orientation === 'portrait' ? 1 : 0]!
  const margin = (kind === 'detail' ? 8 : 10) * MM, top = (kind === 'detail' ? 8 : kind === 'legend' ? 20 : 28) * MM
  const bottom = (kind === 'overview' ? 20 : 10) * MM
  return { width, height, frame: { x: margin, y: top, width: width - 2 * margin, height: height - top - bottom } }
}
function drawNavigation(overview: PdfPage, details: readonly PdfPage[], text: PdfTextEngine, operations: PdfOperation[], links: import('./types').PdfLink[]): void {
  const { frame, ground, pointsPerMeter: scale } = overview
  operations.push({ kind: 'clip', bounds: frame })
  for (const page of details) {
    const bounds = { x: frame.x + (page.ground.x - ground.x) * scale, y: frame.y + (page.ground.y - ground.y) * scale,
      width: page.ground.width * scale, height: page.ground.height * scale }
    operations.push(pathOp(rectPath(bounds), '#A06B1F', null, .3 * MM))
    const value = text.line(String(page.number), 12)
    operations.push({ ...textOp(value, bounds.x + MM, Math.max(frame.y + 12, bounds.y - MM), 12), color: '#A06B1F' })
    links.push({ bounds, target: `page:${page.id}` })
  }
  operations.push({ kind: 'unclip' })
}
