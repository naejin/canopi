import type { Location } from '../../types/design'
import { mutateCurrentDesign } from '../document/controller'

export function setDesignLocation(next: Location): boolean {
  return mutateCurrentDesign((design) => ({
    ...design,
    location: next,
  })) !== null
}

export function clearDesignLocation(): boolean {
  return mutateCurrentDesign((design) => ({
    ...design,
    location: null,
  })) !== null
}

export interface LocationDraft {
  lat: string
  lon: string
  altitude: string
}

export function selectSearchResultLocation(
  result: { lat: number; lon: number },
  altitude: string,
): boolean {
  const parsedAltitude = parseFloat(altitude)
  return setDesignLocation({
    lat: result.lat,
    lon: result.lon,
    altitude_m: Number.isNaN(parsedAltitude) ? null : parsedAltitude,
  })
}

export function saveLocationDraft(draft: LocationDraft): boolean {
  const lat = parseFloat(draft.lat)
  const lon = parseFloat(draft.lon)
  if (Number.isNaN(lat) || Number.isNaN(lon)) return false
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false

  const altitude = parseFloat(draft.altitude)
  return setDesignLocation({
    lat,
    lon,
    altitude_m: Number.isNaN(altitude) ? null : altitude,
  })
}
