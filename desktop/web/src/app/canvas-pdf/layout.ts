import { drawSpeciesCodes } from './species-codes'
import type { CanvasPrintSnapshot, PrintBounds } from '../../canvas/print'
import { PdfTextError, type PdfTextEngine } from './text'
import { MM, PRINT, fitOverview, drawCanvas, identifyPlants, ambiguousSpecies, textOp, pathOp, rectPath } from './page-drawing'
import { canvasText, readableCanvasText } from './canvas-text'
import { planLegend } from './legend'
import { fitArea, zoomCoverage, moveCoverage } from './coverage'
import { pdfAreaKey } from './types'
import type { PdfInput, PdfLabels, PdfOperation, PdfPage, PdfPlan, PdfSetup, PdfPageView } from './types'

type Geometry = Pick<PdfPage, 'width' | 'height' | 'frame'>
const orientations = (view: PdfPageView = {}) => !view.orientation || view.orientation === 'auto' ? ['portrait', 'landscape'] as const : [view.orientation]

export function printableCanvas(canvas: CanvasPrintSnapshot, layers: readonly string[]): CanvasPrintSnapshot {
  const selected = (name: string) => layers.includes(name) && (canvas.layers.find((l) => l.name === name)?.opacity ?? 1) > 0
  return { layers: canvas.layers, plants: selected('plants') ? canvas.plants : [], zones: selected('zones') ? canvas.zones : [],
    annotations: selected('annotations') ? canvas.annotations : [], measurements: selected('measurement-guides') ? canvas.measurements : [] }
}
export function buildPdfPlan(input: PdfInput, setup: PdfSetup, text: PdfTextEngine, labels: PdfLabels): PdfPlan {
  const selected = { ...input, canvas: printableCanvas(input.canvas, setup.layers) }
  const details = detailPages(selected, setup, text, labels)
  const canvas = selected.canvas
  const empty = !details.length && !canvas.plants.length && !canvas.zones.length && !canvas.annotations.length && !canvas.measurements.length
  const overviews: PdfPage[][] = []
  let error: unknown
  for (const orientation of orientations(setup.views?.overview)) {
    try {
      const geometry = pageGeometry(setup.paper, orientation, details.length === 0)
      const fitted = fitOverview(selected, geometry.frame, text, empty ? [{ x: -5, y: -5, width: 10, height: 10 }] : details.filter((page) => page.kind === 'detail').map((page) => page.ground))
      const coverage = moveCoverage(zoomCoverage(fitted, setup.views?.overview?.zoom), setup.views?.overview?.offset)
      const visible = canvasInFrame(selected, coverage.ground, coverage.pointsPerMeter, geometry.frame, text)
      overviews.push(canvasPage({ ...selected, canvas: visible }, geometry, text, labels, { id: 'overview', kind: 'overview', title: labels.overview,
        ...coverage, navigation: details.length > 0 }, setup, new Set(details.flatMap(page => page.readableTextKeys ?? []))))
    } catch (failure) { error = failure }
  }
  if (!overviews.length) throw error
  overviews.sort((a, b) => Number(a.some((p) => p.overflow)) - Number(b.some((p) => p.overflow)) || a.length - b.length || b[0]!.pointsPerMeter - a[0]!.pointsPerMeter)
  if (overviews[0]!.length + details.length > 200) throw new Error('coverage-too-large')
  const pages = [...overviews[0]!, ...details].map((page, i) => ({ ...page, number: i + 1 }))
  const byId = new Map(pages.map((page) => [page.id, page]))
  const finalized = pages.map((page): PdfPage => {
    const operations = [...page.operations]
    if (page.kind === 'overview' && details.length) drawNavigation(page, pages.filter((p) => p.kind === 'detail'), text, operations)
    if (page.sourceId) {
      const source = byId.get(page.sourceId)!
      operations.push(textOp(text.line(`${labels.legendFor} ${source.number}`, PRINT.text), PRINT.margin, page.height - 8 * MM, PRINT.text))
    }
    if (page.legendLink && page.continuationIds?.length) {
      const first = byId.get(page.continuationIds[0]!)!.number
      const last = byId.get(page.continuationIds[page.continuationIds.length - 1]!)!.number
      const caption = `${labels.continued} · ${labels.page} ${first}${last === first ? '' : `-${last}`}`
      text.wrap(caption, PRINT.text, page.legendLink.width).forEach((line, i) => operations.push(textOp(line, page.legendLink!.x, page.legendLink!.y + i * PRINT.line, PRINT.text)))
    }
    const number = text.line(`${labels.page} ${page.number} / ${pages.length}`, 9)
    operations.push(textOp(number, page.width - PRINT.margin - number.width, 12 * MM, 9))
    return { ...page, operations }
  })
  // Drawing coverage is fitted independently of manual overview framing.
  const pickerExtents = details.filter((page) => page.kind === 'detail').map((page) => page.ground)
  const pickerFits = orientations().map((orientation) => {
    const geometry = pageGeometry(setup.paper, orientation, false)
    return { geometry, ...fitOverview(selected, geometry.frame, text, pickerExtents.length ? pickerExtents : empty ? [{ x: -5, y: -5, width: 10, height: 10 }] : []) }
  }).sort((a, b) => b.pointsPerMeter - a.pointsPerMeter)
  const picker = pickerFits[0]!
  const pickerPage = canvasPage(selected, picker.geometry, text, labels, { id: 'overview', kind: 'overview', title: labels.overview,
    ground: picker.ground, pointsPerMeter: picker.pointsPerMeter, navigation: true }, setup)[0]!
  const textIssues = finalized[0]?.textIssues ?? []
  return { pages: finalized, pickerPage: { ...pickerPage, number: 1 }, hasLegendOverflow: finalized.some((page) => page.overflow || page.kind === 'legend'),
    textIssues, outlines: text.outlines, blocked: empty ? 'empty' : finalized.some((page) => page.overflow) ? 'legend-overflow' : textIssues.length ? 'text-needs-detail' : null }
}

function pageGeometry(paper: 'A4' | 'Letter', orientation: 'portrait' | 'landscape', legend = true): Geometry {
  const sides = paper === 'A4' ? [210 * MM, 297 * MM] : [612, 792]
  const width = sides[orientation === 'portrait' ? 0 : 1]!, height = sides[orientation === 'portrait' ? 1 : 0]!
  return { width, height, frame: { x: PRINT.margin, y: PRINT.header,
    width: width - 2 * PRINT.margin - (legend ? PRINT.gutter + PRINT.legend : 0), height: height - PRINT.header - PRINT.footer } }
}
function detailPages(selected: PdfInput, setup: PdfSetup, text: PdfTextEngine, labels: PdfLabels): PdfPage[] {
  const result: PdfPage[] = []
  for (const area of setup.areas ?? []) {
    const requested = area.bounds
    const areaKey = pdfAreaKey(area), view = setup.views?.[areaKey]
    const choices = requested.width === requested.height && (!view?.orientation || view.orientation === 'auto')
      ? ['portrait'] as const : orientations(view)
    const candidates = choices.map((orientation) => {
      const geometry = pageGeometry(setup.paper, orientation)
      return { geometry, ...fitArea(requested, geometry.frame, view?.zoom) }
    }).sort((a, b) => b.pointsPerMeter - a.pointsPerMeter)
    const { geometry, ground, pointsPerMeter } = moveCoverage(candidates[0]!, view?.offset)
    const visible = canvasInFrame(selected, ground, pointsPerMeter, geometry.frame, text)
    const [canvas, ...continuations] = canvasPage({ ...selected, canvas: visible }, geometry, text, labels,
      { id: areaKey, kind: 'detail', title: area.name, ground, pointsPerMeter }, setup)
    result.push({ ...canvas!, areaKey, areaName: area.name }, ...continuations)
    if (result.length > 199) throw new Error('coverage-too-large')
  }
  return result
}
function canvasPage(input: PdfInput, geometry: Geometry, text: PdfTextEngine, labels: PdfLabels,
  options: { id: string; kind: 'overview' | 'detail'; title: string; ground: PrintBounds; pointsPerMeter: number; navigation?: boolean }, setup: PdfSetup, deferred: ReadonlySet<string> = new Set()): PdfPage[] {
  const { width, height, frame } = geometry, { ground, pointsPerMeter } = options
  const legend = options.navigation ? [] : identifyPlants(input.canvas.plants, input.commonNames, input.locale)
  const operations: PdfOperation[] = []
  const addText = (value: string, x: number, y: number, size: number = PRINT.text) => operations.push(textOp(text.line(value, size), x, y, size))
  const titleLines = text.wrap(`${input.name} · ${options.title}`, 12, width - 2 * PRINT.margin - 35 * MM)
  if (titleLines.length > 2) throw new PdfTextError('text-too-wide')
  titleLines.forEach((line, i) => operations.push(textOp(line, PRINT.margin, 12 * MM + i * 15, 12)))
  const items = canvasText(input, frame, ground, pointsPerMeter, text)
  const readableTextKeys = [...readableCanvasText(items.filter(item => !deferred.has(item.key)), input, frame, ground, pointsPerMeter)]
  const retained = new Set(setup.retainedTextKeys)
  const textIssues = options.kind === 'overview' ? items.filter(item => !deferred.has(item.key) && !readableTextKeys.includes(item.key)
    && !retained.has(item.key)).map(({ key, kind }) => ({ key, kind })) : []
  drawCanvas(input, frame, ground, pointsPerMeter, text, operations, items, deferred)
  if (options.kind === 'detail') drawSpeciesCodes(input, frame, ground, pointsPerMeter, text, operations, items)
  operations.push(pathOp(rectPath(frame), PRINT.ink, null, PRINT.stroke))
  let overflow = false
  let legendLink: PrintBounds | undefined
  const continuations: PdfPage[] = []
  if (!options.navigation && legend.length) {
    const legendX = frame.x + frame.width + PRINT.gutter
    const heading = text.wrap(labels.plants, PRINT.text, PRINT.legend)
    heading.forEach((line, i) => operations.push(textOp(line, legendX, frame.y + PRINT.text + i * PRINT.line, PRINT.text)))
    const top = frame.y + (heading.length + 1) * PRINT.line
    const continuationGeometry = (index: number) => {
      const orientation = setup.views?.[`${options.id}:legend:${index}`]?.orientation
      return pageGeometry(setup.paper, !orientation || orientation === 'auto' ? (width > height ? 'landscape' : 'portrait') : orientation, false)
    }
    const planned = planLegend(legend, { x: legendX, y: top, width: PRINT.legend, height: frame.y + frame.height - top },
      (index) => continuationGeometry(index).frame, text, labels, setup.continuations ?? false, input.canvas.layers.find((layer) => layer.name === 'plants')?.opacity ?? 1)
    operations.push(...planned.operations)
    overflow = planned.overflow; legendLink = planned.link
    for (const [index, body] of planned.continuations.entries()) {
      const sheet = continuationGeometry(index)
      const heading = text.wrap(`${input.name} · ${options.title}`, 12, sheet.width - 2 * PRINT.margin - 35 * MM)
      if (heading.length > 2) throw new PdfTextError('text-too-wide')
      continuations.push({ id: `${options.id}:legend:${index}`, sourceId: options.id, kind: 'legend', number: 0,
        ...sheet, ground: { x: 0, y: 0, width: 0, height: 0 }, pointsPerMeter: 0,
        operations: [...heading.map((line, i) => textOp(line, PRINT.margin, 12 * MM + i * 15, 12)), ...body.operations],
        legend: body.entries, overflow: false, ambiguousSpecies: ambiguousSpecies(legend) })
    }
  }
  const scaleY = height - 11 * MM
  operations.push(pathOp(`M${PRINT.margin} ${scaleY} h${50 * MM} M${PRINT.margin} ${scaleY - 2} v4 M${PRINT.margin + 50 * MM} ${scaleY - 2} v4`, PRINT.ink, null, PRINT.stroke))
  const distance = new Intl.NumberFormat(input.locale, { maximumSignificantDigits: 5 }).format(50 * MM / pointsPerMeter)
  addText(`50 mm · ${distance} m`, PRINT.margin, height - 5 * MM, 9)
  const footer = `${labels.actualSize} · ~1:${new Intl.NumberFormat(input.locale, { maximumSignificantDigits: 4 }).format(1000 * MM / pointsPerMeter)}`
  const footerLines = text.wrap(footer, 9, width - 2 * PRINT.margin - 55 * MM)
  if (footerLines.length > 2) throw new PdfTextError('text-too-wide')
  footerLines.forEach((line, i) => operations.push(textOp(line, PRINT.margin + 55 * MM, height - (9 - i * 4) * MM, 9)))
  return [{ id: options.id, kind: options.kind, number: 0, width, height, frame, ground, pointsPerMeter, operations, legend, overflow,
    ambiguousSpecies: ambiguousSpecies(legend), readableTextKeys, textIssues, legendLink, continuationIds: continuations.map((page) => page.id) }, ...continuations]
}

function canvasInFrame(input: PdfInput, ground: PrintBounds, scale: number, frame: PrintBounds, text: PdfTextEngine): CanvasPrintSnapshot {
  const intersects = (bounds: PrintBounds) => bounds.x <= ground.x + ground.width && bounds.x + bounds.width >= ground.x
    && bounds.y <= ground.y + ground.height && bounds.y + bounds.height >= ground.y
  const plants = input.canvas.plants.filter((plant) => {
    const radius = PRINT.marker * 1.2 / scale
    let right = radius, bottom = radius
    if (plant.pinnedName) {
      const lines = text.wrap(input.commonNames[plant.canonicalName]?.trim() || plant.canonicalName, PRINT.text, frame.width * .8)
      right = Math.max(right, ...lines.map((line) => line.width / scale))
      bottom = Math.max(bottom, (PRINT.marker + lines.length * PRINT.line + 3) / scale)
    }
    return intersects({ x: plant.position.x - radius, y: plant.position.y - radius, width: right + radius, height: bottom + radius })
  })
  return { ...input.canvas, plants, zones: input.canvas.zones.filter((zone) => intersects(zone.bounds)) }
}
function drawNavigation(overview: PdfPage, details: readonly PdfPage[], text: PdfTextEngine, operations: PdfOperation[]): void {
  const { frame, ground, pointsPerMeter: scale } = overview
  operations.push({ kind: 'clip', bounds: frame })
  for (const page of details) {
    const bounds = { x: frame.x + (page.ground.x - ground.x) * scale, y: frame.y + (page.ground.y - ground.y) * scale,
      width: page.ground.width * scale, height: page.ground.height * scale }
    operations.push(pathOp(rectPath(bounds), PRINT.ink, null, PRINT.stroke))
    const line = text.line(String(page.number), PRINT.text)
    operations.push(pathOp(rectPath({ x: bounds.x + 2, y: bounds.y + 2, width: line.width + 6, height: PRINT.line + 2 }), PRINT.ink, '#ffffff', PRINT.stroke))
    operations.push(textOp(line, bounds.x + 5, bounds.y + PRINT.text + 3, PRINT.text))
  }
  operations.push({ kind: 'unclip' })
}
