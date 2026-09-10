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

/** Preserve the exact ground rectangle and centre its physical frame. */
export function fitArea(bounds: PrintBounds, frame: PrintBounds, zoom = 100) {
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) throw new Error('invalid-page-view')
  const fit = Math.min(frame.width / bounds.width, frame.height / bounds.height)
  const fittedFrame = { x: frame.x + (frame.width - bounds.width * fit) / 2, y: frame.y + (frame.height - bounds.height * fit) / 2,
    width: bounds.width * fit, height: bounds.height * fit }
  return { frame: fittedFrame, ...zoomCoverage({ ground: bounds, pointsPerMeter: fit }, zoom) }
}

export function zoomCoverage(fit: { ground: PrintBounds; pointsPerMeter: number }, zoom = 100) {
  const factor = pageZoom(zoom) / 100
  const width = fit.ground.width / factor, height = fit.ground.height / factor
  return { pointsPerMeter: fit.pointsPerMeter * factor,
    ground: { x: fit.ground.x + (fit.ground.width - width) / 2, y: fit.ground.y + (fit.ground.height - height) / 2, width, height } }
}
