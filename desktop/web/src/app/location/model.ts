import type { Location } from '../../types/design'
import { formatLocationSummary } from '../../utils/location'
import { currentDesign } from '../document-session/store'
import type { LocationDraft } from './controller'

const PIN_EDGE_MARGIN = 24

export interface SavedLocationPresentation {
  readonly hasDesign: boolean
  readonly location: Location | null
  readonly northBearingDeg: number | null
  readonly hasLocation: boolean
  readonly summary: string | null
  readonly key: string | null
}

export interface PinOverlayState {
  readonly visible: boolean
  readonly x: number
  readonly y: number
  readonly clamped: boolean
  readonly angle: number
}

export function getSavedLocationPresentation(
  hasDesign: boolean,
  location: Location | null,
  northBearingDeg: number | null = null,
): SavedLocationPresentation {
  return {
    hasDesign,
    location,
    northBearingDeg,
    hasLocation: location !== null,
    summary: location ? formatLocationSummary(location) : null,
    key: location ? `${location.lat}:${location.lon}:${location.altitude_m ?? ''}` : null,
  }
}

export function locationDraftFromSaved(location: Location | null): LocationDraft {
  return {
    lat: location?.lat?.toString() ?? '',
    lon: location?.lon?.toString() ?? '',
    altitude: location?.altitude_m?.toString() ?? '',
  }
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

export function useSavedLocationPresentation(): SavedLocationPresentation {
  return readSavedLocationPresentation()
}

export function readSavedLocationPresentation(): SavedLocationPresentation {
  const design = currentDesign.value
  return getSavedLocationPresentation(design !== null, design?.location ?? null, design?.north_bearing_deg ?? null)
}
