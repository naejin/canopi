import type { CanvasPrintSnapshot, PrintBounds } from '../../canvas/print'
import { PdfTextError, type PdfTextEngine } from './text'
import { MM, PRINT, fitOverview, drawCanvas, identifyPlants, ambiguousSpecies, textOp, pathOp, rectPath } from './page-drawing'
import { planLegend } from './legend'
import { tileCoverage } from './coverage'
import { pdfAreaKey } from './types'
import type { PdfInput, PdfLabels, PdfOperation, PdfPage, PdfPlan, PdfSetup } from './types'

type Geometry = Pick<PdfPage, 'width' | 'height' | 'frame'>
const orientations = (setup: PdfSetup) => setup.orientation === 'auto' ? ['portrait', 'landscape'] as const : [setup.orientation]

export function printableCanvas(canvas: CanvasPrintSnapshot, layers: readonly string[]): CanvasPrintSnapshot {
  const selected = (name: string) => layers.includes(name) && (canvas.layers.find((l) => l.name === name)?.opacity ?? 1) > 0
  return { layers: canvas.layers, plants: selected('plants') ? canvas.plants : [], zones: selected('zones') ? canvas.zones : [],
    annotations: selected('annotations') ? canvas.annotations : [], measurements: selected('measurement-guides') ? canvas.measurements : [] }
}
export function buildPdfPlan(input: PdfInput, setup: PdfSetup, text: PdfTextEngine, labels: PdfLabels): PdfPlan {
  const selected = { ...input, canvas: printableCanvas(input.canvas, setup.layers) }
  const details = detailPages(input, selected, setup, text, labels)
  const canvas = selected.canvas
  const empty = !details.length && !canvas.plants.length && !canvas.zones.length && !canvas.annotations.length && !canvas.measurements.length
  const overviews: PdfPage[][] = []
  let error: unknown
  for (const orientation of orientations(setup)) {
    try {
      const geometry = pageGeometry(setup.paper, orientation, details.length === 0)
      const fitted = fitOverview(selected, geometry.frame, text, empty ? [{ x: -5, y: -5, width: 10, height: 10 }] : details.filter((page) => page.kind === 'detail').map((page) => page.ground))
      overviews.push(canvasPage(selected, geometry, text, labels, { id: 'overview', kind: 'overview', title: labels.overview,
        ...fitted, navigation: details.length > 0 }, setup.continuations ?? false))
    } catch (failure) { error = failure }
  }
  if (!overviews.length) throw error
  overviews.sort((a, b) => Number(a.some((p) => p.overflow)) - Number(b.some((p) => p.overflow)) || a.length - b.length || b[0]!.pointsPerMeter - a[0]!.pointsPerMeter)
  if (overviews[0]!.length + details.length > 200) throw new Error('coverage-too-large')
  const pages = [...overviews[0]!, ...details].map((page, i) => ({ ...page, number: i + 1 }))
  const byId = new Map(pages.map((page) => [page.id, page]))
  const finalized = pages.map((page): PdfPage => {
    const operations = [...page.operations]
    const neighbors: Partial<Record<'left' | 'right' | 'top' | 'bottom', number>> = {}
    if (page.tile) {
      for (const [edge, row, column] of [
        ['left', page.tile.row, page.tile.column - 1], ['right', page.tile.row, page.tile.column + 1],
        ['top', page.tile.row - 1, page.tile.column], ['bottom', page.tile.row + 1, page.tile.column],
      ] as const) {
        const neighbor = byId.get(`${page.areaKey}:${row}:${column}`)
        if (neighbor) neighbors[edge] = neighbor.number
      }
      drawNeighbors(page, neighbors, text, labels, operations)
    }
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
    return { ...page, operations, ...(page.kind === 'detail' ? { neighbors } : {}) }
  })
  return { pages: finalized, hasLegendOverflow: finalized.some((page) => page.overflow || page.kind === 'legend'), outlines: text.outlines, blocked: empty ? 'empty' : finalized.some((page) => page.overflow) ? 'legend-overflow' : null }
}

function pageGeometry(paper: 'A4' | 'Letter', orientation: 'portrait' | 'landscape', legend = true): Geometry {
  const sides = paper === 'A4' ? [210 * MM, 297 * MM] : [612, 792]
  const width = sides[orientation === 'portrait' ? 0 : 1]!, height = sides[orientation === 'portrait' ? 1 : 0]!
  return { width, height, frame: { x: PRINT.margin, y: PRINT.header,
    width: width - 2 * PRINT.margin - (legend ? PRINT.gutter + PRINT.legend : 0), height: height - PRINT.header - PRINT.footer } }
}
function detailPages(source: PdfInput, selected: PdfInput, setup: PdfSetup, text: PdfTextEngine, labels: PdfLabels): PdfPage[] {
  const result: PdfPage[] = []
  for (const area of setup.areas ?? []) {
    const requested = area.kind === 'rectangle' ? area.bounds : source.canvas.zones.find((zone) => zone.name === area.name)?.bounds
    if (!requested) throw new Error('selection-missing')
    const scale = 1000 * MM / (area.scale ?? setup.detailScale ?? 100)
    const context = area.kind === 'zone' ? PRINT.context / scale : 0
    const bounds = { x: requested.x - context, y: requested.y - context, width: requested.width + 2 * context, height: requested.height + 2 * context }
    const candidates: PdfPage[][] = []
    let error: unknown
    const areaKey = pdfAreaKey(area)
    for (const orientation of orientations(setup)) {
      try {
        const geometry = pageGeometry(setup.paper, orientation)
        const sheets = tileCoverage(bounds, geometry.frame.width / scale, geometry.frame.height / scale, PRINT.overlap / scale)
        const pages: PdfPage[] = []
        for (const sheet of sheets) {
          const visible = canvasInFrame(selected, sheet.ground, scale, geometry.frame, text)
          const [canvas, ...continuations] = canvasPage({ ...selected, canvas: visible }, geometry, text, labels,
            { id: `${areaKey}:${sheet.row}:${sheet.column}`, kind: 'detail', title: area.name, ground: sheet.ground, pointsPerMeter: scale }, setup.continuations ?? false)
          pages.push({ ...canvas!, areaKey, areaName: area.name,
            tile: { row: sheet.row, column: sheet.column, rows: sheet.rows, columns: sheet.columns } }, ...continuations)
          if (result.length + pages.length > 199) throw new Error('coverage-too-large')
        }
        candidates.push(pages)
      } catch (failure) { error = failure }
    }
    candidates.sort((a, b) => Number(a.some((p) => p.overflow)) - Number(b.some((p) => p.overflow)) || a.length - b.length)
    if (!candidates.length) throw error
    result.push(...candidates[0]!)
  }
  return result
}
function canvasPage(input: PdfInput, geometry: Geometry, text: PdfTextEngine, labels: PdfLabels,
  options: { id: string; kind: 'overview' | 'detail'; title: string; ground: PrintBounds; pointsPerMeter: number; navigation?: boolean }, allowContinuations: boolean): PdfPage[] {
  const { width, height, frame } = geometry, { ground, pointsPerMeter } = options
  const legend = options.navigation ? [] : identifyPlants(input.canvas.plants, input.commonNames, input.locale)
  const operations: PdfOperation[] = []
  const addText = (value: string, x: number, y: number, size: number = PRINT.text) => operations.push(textOp(text.line(value, size), x, y, size))
  const titleLines = text.wrap(`${input.name} · ${options.title}`, 12, width - 2 * PRINT.margin - 35 * MM)
  if (titleLines.length > 2) throw new PdfTextError('text-too-wide')
  titleLines.forEach((line, i) => operations.push(textOp(line, PRINT.margin, 12 * MM + i * 15, 12)))
  drawCanvas(input, frame, ground, pointsPerMeter, text, operations)
  operations.push(pathOp(rectPath(frame), PRINT.ink, null, PRINT.stroke))
  let overflow = false
  let legendLink: PrintBounds | undefined
  const continuations: PdfPage[] = []
  if (!options.navigation && legend.length) {
    const legendX = frame.x + frame.width + PRINT.gutter
    const heading = text.wrap(labels.plants, PRINT.text, PRINT.legend)
    heading.forEach((line, i) => operations.push(textOp(line, legendX, frame.y + PRINT.text + i * PRINT.line, PRINT.text)))
    const top = frame.y + (heading.length + 1) * PRINT.line
    const continuationFrame = { x: PRINT.margin, y: PRINT.header, width: width - 2 * PRINT.margin, height: frame.height }
    const planned = planLegend(legend, { x: legendX, y: top, width: PRINT.legend, height: frame.y + frame.height - top },
      continuationFrame, text, labels, allowContinuations, input.canvas.layers.find((layer) => layer.name === 'plants')?.opacity ?? 1)
    operations.push(...planned.operations)
    overflow = planned.overflow; legendLink = planned.link
    for (const [index, body] of planned.continuations.entries()) {
      continuations.push({ id: `${options.id}:legend:${index}`, sourceId: options.id, kind: 'legend', number: 0,
        width, height, frame: continuationFrame, ground: { x: 0, y: 0, width: 0, height: 0 }, pointsPerMeter: 0,
        operations: [...titleLines.map((line, i) => textOp(line, PRINT.margin, 12 * MM + i * 15, 12)), ...body.operations],
        legend: body.entries, overflow: false, ambiguousSpecies: ambiguousSpecies(legend) })
    }
  }
  const scaleY = height - 11 * MM
  operations.push(pathOp(`M${PRINT.margin} ${scaleY} h${50 * MM} M${PRINT.margin} ${scaleY - 2} v4 M${PRINT.margin + 50 * MM} ${scaleY - 2} v4`, PRINT.ink, null, PRINT.stroke))
  const distance = new Intl.NumberFormat(input.locale, { maximumSignificantDigits: 5 }).format(50 * MM / pointsPerMeter)
  addText(`50 mm · ${distance} m`, PRINT.margin, height - 5 * MM, 9)
  const footer = `${labels.actualSize} · ${options.kind === 'overview' ? '~' : ''}1:${Math.round(1000 * MM / pointsPerMeter)}`
  const footerLines = text.wrap(footer, 9, width - 2 * PRINT.margin - 55 * MM)
  if (footerLines.length > 2) throw new PdfTextError('text-too-wide')
  footerLines.forEach((line, i) => operations.push(textOp(line, PRINT.margin + 55 * MM, height - (9 - i * 4) * MM, 9)))
  return [{ id: options.id, kind: options.kind, number: 0, width, height, frame, ground, pointsPerMeter, operations, legend, overflow,
    ambiguousSpecies: ambiguousSpecies(legend), legendLink, continuationIds: continuations.map((page) => page.id) }, ...continuations]
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
function drawNeighbors(page: PdfPage, neighbors: NonNullable<PdfPage['neighbors']>, text: PdfTextEngine, labels: PdfLabels, operations: PdfOperation[]): void {
  const { frame } = page
  for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
    const number = neighbors[edge]
    if (!number) continue
    const line = text.line(`${labels.page} ${number}`, 9)
    const vertical = edge === 'left' || edge === 'right'
    const x = edge === 'left' ? frame.x - 3 * MM : edge === 'right' ? frame.x + frame.width + 3 * MM : frame.x + (frame.width - line.width) / 2
    const y = edge === 'top' ? frame.y - 3 * MM : edge === 'bottom' ? frame.y + frame.height + 4 * MM : frame.y + (frame.height + line.width) / 2
    operations.push(textOp(line, x, y, 9, vertical ? -90 : 0))
  }
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
