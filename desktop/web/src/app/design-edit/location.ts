import type { Location } from '../../types/design'
import { editCurrentDesign } from './core'

export function setDesignLocation(next: Location): boolean {
  return editCurrentDesign((design) => {
    if (
      design.location?.lat === next.lat &&
      design.location.lon === next.lon &&
      design.location.altitude_m === next.altitude_m
    ) {
      return design
    }
    return {
      ...design,
      location: next,
    }
  }) !== null
}

export function clearDesignLocation(): boolean {
  return editCurrentDesign((design) => {
    if (design.location === null) return design
    return {
      ...design,
      location: null,
    }
  }) !== null
}
