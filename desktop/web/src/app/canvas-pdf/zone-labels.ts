import type { PrintBounds, PrintPoint } from '../../canvas/print'
import type { PdfOperation } from './types'
import type { FieldSpace } from './field-placement'
import { hits, outlineSegments } from './field-geometry'
import { insideZone, type ZoneMeasurements } from './zone-measurements'
import { MM, pathOp, rectPath, textOp } from './page-drawing'

export function zoneLabels(zones: readonly ZoneMeasurements[], ground: PrintBounds, point: (p: PrintPoint) => PrintPoint, space: FieldSpace, boxed = true): PdfOperation[] {
  const operations: PdfOperation[] = []
  for (const item of zones) {
    if (!outlineSegments(item.zone.path, p => p).some(s => hits(s, ground))
      && !insideZone(item.zone, { x: ground.x + ground.width / 2, y: ground.y + ground.height / 2 })) continue
    const b = item.zone.bounds
    const anchor = point({ x: Math.max(ground.x, Math.min(ground.x + ground.width, b.x + b.width / 2)), y: Math.max(ground.y, b.y) })
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
