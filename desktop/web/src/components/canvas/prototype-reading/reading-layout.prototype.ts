// Throwaway comparison only. Rebuild accepted behavior through production seams.
import type { CanvasPrintSnapshot, PrintPlant, PrintPoint } from '../../../canvas/print'
import type { PdfPage, PdfPlan, PdfOperation } from '../../../app/canvas-pdf/types'
import { MM, PRINT } from '../../../app/canvas-pdf/page-drawing'

export type LensVariant = 'inline' | 'connected' | 'expanded'
export interface LensLabel { plant: PrintPlant; text: string; x: number; y: number; width: number; px: number; py: number }

export function spacingFor(plants: readonly PrintPlant[]): Map<string, number> {
  return new Map(plants.map(plant => [plant.id, Math.sqrt(plants.reduce((best, other) => {
    const distance = (plant.position.x - other.position.x) ** 2 + (plant.position.y - other.position.y) ** 2
    return distance > 0 ? Math.min(best, distance) : best
  }, Infinity))]))
}

export function initialPoint(plants: readonly PrintPlant[]): PrintPoint {
  if (!plants.length) return { x: 0, y: 0 }
  const mean = { x: plants.reduce((sum, plant) => sum + plant.position.x, 0) / plants.length,
    y: plants.reduce((sum, plant) => sum + plant.position.y, 0) / plants.length }
  return [...plants].sort((a, b) => Math.hypot(a.position.x - mean.x, a.position.y - mean.y)
    - Math.hypot(b.position.x - mean.x, b.position.y - mean.y))[0]!.position
}

export function labelLens(plants: readonly PrintPlant[], names: Readonly<Record<string, string>>, centre: PrintPoint,
  scale: number, width: number, height: number, variant: LensVariant): LensLabel[] {
  const near = plants.map(plant => ({ plant, px: width / 2 + (plant.position.x - centre.x) * scale,
    py: height / 2 + (plant.position.y - centre.y) * scale }))
    .filter(p => p.px > 12 && p.px < width - 12 && p.py > 16 && p.py < height - 16)
    .sort((a, b) => Math.hypot(a.px - width / 2, a.py - height / 2) - Math.hypot(b.px - width / 2, b.py - height / 2))
  const occupied = near.map(p => ({ x: p.px - 10, y: p.py - 10, width: 20, height: 20 }))
  const overlaps = (r: { x: number; y: number; width: number; height: number }) => occupied.some(o =>
    r.x < o.x + o.width && r.x + r.width > o.x && r.y < o.y + o.height && r.y + r.height > o.y)
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d')!
  ctx.font = '600 12px Inter, sans-serif'
  const result: LensLabel[] = []
  for (const { plant, px, py } of near) {
    const text = names[plant.canonicalName] || plant.canonicalName
    const w = Math.min(width - 24, ctx.measureText(text).width + 12)
    const candidates = variant === 'connected'
      ? [0, 24, -24, 48, -48, 72, -72, 96, -96].flatMap(dy => [
        { x: 12, y: py - 10 + dy }, { x: width - w - 12, y: py - 10 + dy },
      ])
      : [{ x: px - w / 2, y: py + 13 }, { x: px - w / 2, y: py - 33 },
        { x: px + 15, y: py - 10 }, { x: px - w - 15, y: py - 10 }]
    const box = candidates.map(p => ({ ...p, width: w, height: 21 }))
      .find(r => r.x >= 6 && r.x + r.width <= width - 6 && r.y >= 6 && r.y + r.height <= height - 6 && !overlaps(r))
    if (!box) continue
    occupied.push(box)
    result.push({ plant, text, x: box.x, y: box.y, width: w, px, py })
  }
  return result
}

/** Changes only canvas mark operations; authored text, legends and coverage stay intact. */
export function adaptPaper(plan: PdfPlan, canvas: CanvasPrintSnapshot, spacing: ReadonlyMap<string, number>): PdfPlan {
  return { ...plan, pages: plan.pages.map(page => ({ ...page, operations: adaptPage(page, canvas, spacing) })) }
}

function adaptPage(page: PdfPage, canvas: CanvasPrintSnapshot, spacing: ReadonlyMap<string, number>): readonly PdfOperation[] {
  const centres = new Map(canvas.plants.map(plant => [
    `${page.frame.x + (plant.position.x - page.ground.x) * page.pointsPerMeter}:${page.frame.y + (plant.position.y - page.ground.y) * page.pointsPerMeter}`, plant,
  ]))
  let inCanvas = false
  return page.operations.map(op => {
    if (op.kind === 'clip') inCanvas = true
    if (op.kind === 'unclip') inCanvas = false
    if (!inCanvas || op.kind !== 'path') return op
    if (op.matrix[0] !== PRINT.marker || op.matrix[3] !== PRINT.marker) return op
    const plant = centres.get(`${op.matrix[4]}:${op.matrix[5]}`)
    if (!plant) return op
    const radius = Math.max(.35 * MM, Math.min(PRINT.marker, (spacing.get(plant.id) ?? Infinity) * page.pointsPerMeter * .42))
    const dot = plant.symbol === 'round' && radius < .8 * MM
    return { ...op, matrix: [radius, 0, 0, radius, op.matrix[4], op.matrix[5]],
      fill: dot ? plant.color : op.fill, stroke: dot ? null : op.stroke,
      width: Math.max(op.width, .12 * MM / radius) }
  })
}
