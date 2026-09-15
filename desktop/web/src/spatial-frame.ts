import { NEW_DESIGN_SPATIAL_FRAME } from './generated/new-design-defaults'
import type { Location, SpatialFrame } from './types/design'

export function cloneSpatialFrame(frame: SpatialFrame): SpatialFrame {
  return {
    ...frame,
    location_metadata: { ...frame.location_metadata },
  }
}

export function newDesignSpatialFrame(): SpatialFrame {
  return cloneSpatialFrame(NEW_DESIGN_SPATIAL_FRAME)
}

export function locationFromSpatialFrame(frame: SpatialFrame): Location {
  return {
    lat: frame.anchor_latitude_deg,
    lon: frame.anchor_longitude_deg,
    altitude_m: frame.location_metadata.altitude_m,
  }
}

export function confirmedSpatialFrame(
  current: SpatialFrame,
  location: Location,
): SpatialFrame {
  return {
    ...current,
    anchor_longitude_deg: location.lon,
    anchor_latitude_deg: location.lat,
    placement_status: 'confirmed',
    location_metadata: {
      altitude_m: location.altitude_m,
    },
  }
}
