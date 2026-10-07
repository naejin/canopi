import type { PrintBounds, PrintPoint, PrintZone } from '../../canvas/print'
import type { PdfOperation } from './types'
import type { FieldSpace } from './field-placement'
import { clipSegment, outlineSegments } from './field-geometry'
import { insideZone, type ZoneMeasurements } from './zone-measurements'
import { MM, pathOp, rectPath, textOp } from './page-drawing'

/**
 * A zone's own top on the page frame, in ground metres: its highest outline point inside the ground, or the middle of a
 * level top edge; a zone that holds the whole ground tops it at the ground's top middle; null when it misses the ground.
 * Never the upright bounds, which at a turned angle sit over the neighbouring rows.
 */
export function zoneTop(zone: PrintZone, ground: PrintBounds): PrintPoint | null {
  const ends = outlineSegments(zone.path, p => p).flatMap(s => { const clipped = clipSegment(s, ground); return clipped ? [clipped.a, clipped.b] : [] })
  if (!ends.length) return insideZone(zone, { x: ground.x + ground.width / 2, y: ground.y + ground.height / 2 }) ? { x: ground.x + ground.width / 2, y: ground.y } : null
  const y = Math.min(...ends.map(p => p.y)), level = ends.filter(p => p.y - y < 1e-6).map(p => p.x)
  return { x: (Math.min(...level) + Math.max(...level)) / 2, y }
}

export function zoneLabels(zones: readonly ZoneMeasurements[], ground: PrintBounds, point: (p: PrintPoint) => PrintPoint, space: FieldSpace, boxed = true): PdfOperation[] {
  const operations: PdfOperation[] = []
  for (const item of zones) {
    const top = zoneTop(item.zone, ground)
    if (!top) continue
    const anchor = point(top)
    const measured = space.measure(item.reference, 7.5, Infinity, !boxed)
    for (const [dx, dy] of [[-measured.width / 2, -measured.height - 1], [-measured.width / 2, 1],
      [-measured.width - 2, 1], [2, 1], [-measured.width / 2, 4], [-measured.width / 2, -measured.height - 4]]) {
      const bounds = { x: anchor.x + dx!, y: anchor.y + dy!, width: measured.width, height: measured.height }
      if (!space.clear(bounds)) continue
      space.reserve(bounds)
      if (boxed) operations.push(pathOp(rectPath({ x: bounds.x * MM, y: bounds.y * MM, width: bounds.width * MM, height: bounds.height * MM }), '#a29c91', null, .12 * MM))
      operations.push({ ...textOp(measured.lines[0]!, (bounds.x + measured.inset) * MM, (bounds.y + measured.baseline) * MM, 7.5), color: '#655f55' })
      break
    }
  }
  return operations
}
