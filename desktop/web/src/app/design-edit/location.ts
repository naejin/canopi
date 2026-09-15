import type { Location } from '../../types/design'
import { confirmedSpatialFrame, newDesignSpatialFrame } from '../../spatial-frame'
import { editCurrentDesign } from './core'

export function setDesignLocation(next: Location): boolean {
  return editCurrentDesign((design) => {
    if (
      design.spatial_frame.placement_status === 'confirmed' &&
      design.spatial_frame.anchor_latitude_deg === next.lat &&
      design.spatial_frame.anchor_longitude_deg === next.lon &&
      design.spatial_frame.location_metadata.altitude_m === next.altitude_m
    ) {
      return design
    }
    return {
      ...design,
      spatial_frame: confirmedSpatialFrame(design.spatial_frame, next),
    }
  }) !== null
}

export function clearDesignLocation(): boolean {
  return editCurrentDesign((design) => {
    if (design.spatial_frame.placement_status === 'provisional') return design
    return {
      ...design,
      spatial_frame: newDesignSpatialFrame(),
    }
  }) !== null
}
