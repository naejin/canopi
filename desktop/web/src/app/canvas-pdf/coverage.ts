import type { PrintBounds, PrintPoint } from '../../canvas/print'
import { PDF_ZOOM } from './types'

export function pageZoom(zoom = 100): number {
  if (!Number.isFinite(zoom) || zoom < PDF_ZOOM.min || zoom > PDF_ZOOM.max) throw new Error('invalid-page-view')
  return zoom
}

export function moveCoverage<T extends { ground: PrintBounds }>(fit: T, offset: PrintPoint = { x: 0, y: 0 }): T {
  const x = fit.ground.x + offset.x, y = fit.ground.y + offset.y
  if (![x, y, x + fit.ground.width, y + fit.ground.height].every(Number.isFinite)) throw new Error('invalid-page-view')
  return { ...fit, ground: { ...fit.ground, x, y } }
}

/** At 100%, contain the entire requested extent. Explicit zoom keeps its centre. */
export function fitArea(bounds: PrintBounds, frame: PrintBounds, zoom = 100) {
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || bounds.width < 0 || bounds.height < 0) throw new Error('invalid-page-view')
  const pointsPerMeter = Math.min(frame.width / (bounds.width || .001),
    frame.height / (bounds.height || .001)) * pageZoom(zoom) / 100 / (1 + 1e-12)
  const width = frame.width / pointsPerMeter, height = frame.height / pointsPerMeter
  return { pointsPerMeter, ground: { x: bounds.x + (bounds.width - width) / 2, y: bounds.y + (bounds.height - height) / 2, width, height } }
}

export function zoomCoverage(fit: { ground: PrintBounds; pointsPerMeter: number }, zoom = 100) {
  const factor = pageZoom(zoom) / 100
  const width = fit.ground.width / factor, height = fit.ground.height / factor
  return { pointsPerMeter: fit.pointsPerMeter * factor,
    ground: { x: fit.ground.x + (fit.ground.width - width) / 2, y: fit.ground.y + (fit.ground.height - height) / 2, width, height } }
}
