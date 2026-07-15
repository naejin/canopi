import { useRef } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import {
  clearDesignLocation,
  setDesignLocation,
} from './controller'
import {
  buildLocationCommit,
  useSavedLocationPresentation,
  type SavedLocationPresentation,
} from './model'

export interface LocationCoordinateWorkbench {
  readonly saved: SavedLocationPresentation
  readonly pendingMapResult: { lat: number; lon: number } | null
  readonly clearLocation: () => boolean
  readonly previewMapLocation: (coords: { lat: number; lon: number }) => { lat: number; lon: number }
  readonly clearPendingMapResult: () => void
  readonly commitMapLocation: (center: { lat: number; lon: number } | null) => boolean
}

export function useLocationCoordinateWorkbench(): LocationCoordinateWorkbench {
  const saved = useSavedLocationPresentation()
  const savedLocationRef = useRef(saved.location)
  savedLocationRef.current = saved.location

  const pendingMapResult = useSignal<{ lat: number; lon: number } | null>(null)

  function clearLocationFromWorkbench(): boolean {
    pendingMapResult.value = null
    return clearDesignLocation()
  }

  function previewMapLocation(coords: { lat: number; lon: number }): { lat: number; lon: number } {
    const next = { lat: coords.lat, lon: coords.lon }
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
    pendingMapResult: pendingMapResult.value,
    clearLocation: clearLocationFromWorkbench,
    previewMapLocation,
    clearPendingMapResult,
    commitMapLocation,
  }
}
