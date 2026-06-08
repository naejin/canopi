import { useEffect, useMemo, useRef } from 'preact/hooks'
import { useSignal, useSignalEffect } from '@preact/signals'
import type { Location } from '../../types/design'
import { formatLocationSummary } from '../../utils/location'
import {
  clearDesignLocation,
  saveLocationDraft,
  setDesignLocation,
  type LocationDraft,
} from './controller'
import {
  createLocationSearchController,
  type LocationSearchController,
  type LocationSearchResult,
} from './search-controller'
import { currentDesign } from '../document-session/store'

const PIN_EDGE_MARGIN = 24

export interface SavedLocationPresentation {
  readonly hasDesign: boolean
  readonly location: Location | null
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

export interface LocationWorkbench {
  readonly saved: SavedLocationPresentation
  readonly search: LocationWorkbenchSearch
  readonly latDraft: string
  readonly lonDraft: string
  readonly altitudeDraft: string
  readonly pendingMapResult: { lat: number; lon: number } | null
  readonly setLatDraft: (value: string) => void
  readonly setLonDraft: (value: string) => void
  readonly setAltitudeDraft: (value: string) => void
  readonly saveDraft: () => boolean
  readonly clearLocation: () => boolean
  readonly commitSearchResult: (result: LocationSearchResult) => boolean
  readonly previewSearchResultOnMap: (result: LocationSearchResult) => { lat: number; lon: number }
  readonly clearPendingMapResult: () => void
  readonly commitMapLocation: (center: { lat: number; lon: number } | null) => boolean
}

export interface LocationWorkbenchSearch extends LocationSearchController {
  readonly setDropdownElement: (element: HTMLElement | null) => void
}

export function getSavedLocationPresentation(
  hasDesign: boolean,
  location: Location | null,
): SavedLocationPresentation {
  return {
    hasDesign,
    location,
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
  return getSavedLocationPresentation(design !== null, design?.location ?? null)
}

export function useLocationWorkbench(): LocationWorkbench {
  const saved = useSavedLocationPresentation()
  const savedLocationRef = useRef(saved.location)
  savedLocationRef.current = saved.location

  const search = useMemo(() => createLocationSearchController(), [])
  const searchDropdownRef = useRef<HTMLElement | null>(null)
  const workbenchSearch = useMemo<LocationWorkbenchSearch>(() => ({
    ...search,
    setDropdownElement: (element) => {
      searchDropdownRef.current = element
    },
  }), [search])
  const initialDraft = locationDraftFromSaved(saved.location)
  const latDraft = useSignal(initialDraft.lat)
  const lonDraft = useSignal(initialDraft.lon)
  const altitudeDraft = useSignal(initialDraft.altitude)
  const pendingMapResult = useSignal<{ lat: number; lon: number } | null>(null)

  useSignalEffect(() => {
    const next = locationDraftFromSaved(currentDesign.value?.location ?? null)
    latDraft.value = next.lat
    lonDraft.value = next.lon
    altitudeDraft.value = next.altitude
  })

  useEffect(() => {
    function handlePointerUp(event: PointerEvent) {
      const dropdown = searchDropdownRef.current
      if (dropdown && !dropdown.contains(event.target as Node)) {
        search.closeDropdown()
      }
    }

    document.addEventListener('pointerup', handlePointerUp)
    return () => {
      document.removeEventListener('pointerup', handlePointerUp)
      search.dispose()
      searchDropdownRef.current = null
    }
  }, [search])

  function saveDraftFromSignals(): boolean {
    return saveLocationDraft({
      lat: latDraft.value,
      lon: lonDraft.value,
      altitude: altitudeDraft.value,
    })
  }

  function clearLocationFromWorkbench(): boolean {
    pendingMapResult.value = null
    const cleared = clearDesignLocation()
    latDraft.value = ''
    lonDraft.value = ''
    altitudeDraft.value = ''
    return cleared
  }

  function commitSearchResult(result: LocationSearchResult): boolean {
    latDraft.value = result.lat.toString()
    lonDraft.value = result.lon.toString()
    search.consumeResult()
    return saveLocationDraft({
      lat: latDraft.value,
      lon: lonDraft.value,
      altitude: altitudeDraft.value,
    })
  }

  function previewSearchResultOnMap(result: LocationSearchResult): { lat: number; lon: number } {
    const next = { lat: result.lat, lon: result.lon }
    search.consumeResult()
    pendingMapResult.value = next
    return next
  }

  function clearPendingMapResult(): void {
    pendingMapResult.value = null
  }

  function commitMapLocation(center: { lat: number; lon: number } | null): boolean {
    const coords = pendingMapResult.value ?? center
    if (!coords) return false
    pendingMapResult.value = null
    return setDesignLocation(buildLocationCommit(coords, savedLocationRef.current))
  }

  return {
    saved,
    search: workbenchSearch,
    latDraft: latDraft.value,
    lonDraft: lonDraft.value,
    altitudeDraft: altitudeDraft.value,
    pendingMapResult: pendingMapResult.value,
    setLatDraft: (value) => { latDraft.value = value },
    setLonDraft: (value) => { lonDraft.value = value },
    setAltitudeDraft: (value) => { altitudeDraft.value = value },
    saveDraft: saveDraftFromSignals,
    clearLocation: clearLocationFromWorkbench,
    commitSearchResult,
    previewSearchResultOnMap,
    clearPendingMapResult,
    commitMapLocation,
  }
}
