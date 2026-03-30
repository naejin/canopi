import type { Location } from '../../types/design'

const PIN_EDGE_MARGIN = 24

export interface PinOverlayState {
  visible: boolean
  x: number
  y: number
  clamped: boolean
  angle: number
}

export function buildLocationCommit(
  coords: { lat: number; lon: number },
  current: Location | null,
): Location {
  return {
    lat: coords.lat,
    lon: coords.lon,
    altitude_m: current?.altitude_m ?? null,
  }
}

export function computeSavedPinState(
  location: { lat: number; lon: number } | null,
  viewport: { width: number; height: number },
  projected: { x: number; y: number },
): PinOverlayState {
  if (!location) {
    return { visible: false, x: 0, y: 0, clamped: false, angle: 0 }
  }

  const { width, height } = viewport
  const inBounds =
    projected.x >= PIN_EDGE_MARGIN &&
    projected.x <= width - PIN_EDGE_MARGIN &&
    projected.y >= PIN_EDGE_MARGIN &&
    projected.y <= height - PIN_EDGE_MARGIN

  if (inBounds) {
    return {
      visible: true,
      x: projected.x,
      y: projected.y,
      clamped: false,
      angle: 0,
    }
  }

  const cx = width / 2
  const cy = height / 2
  return {
    visible: true,
    x: Math.max(PIN_EDGE_MARGIN, Math.min(width - PIN_EDGE_MARGIN, projected.x)),
    y: Math.max(PIN_EDGE_MARGIN, Math.min(height - PIN_EDGE_MARGIN, projected.y)),
    clamped: true,
    angle: Math.atan2(projected.y - cy, projected.x - cx),
  }
}
