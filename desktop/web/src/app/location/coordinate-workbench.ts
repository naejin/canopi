import { useRef } from 'preact/hooks'
import { useSignal, useSignalEffect } from '@preact/signals'
import type { LocationDraft } from './controller'
import {
  clearDesignLocation,
  saveLocationDraft,
  setDesignLocation,
} from './controller'
import {
  buildLocationCommit,
  locationDraftFromSaved,
  useSavedLocationPresentation,
  type SavedLocationPresentation,
} from './model'
import { currentDesign } from '../document-session/store'

export interface LocationCoordinateWorkbench {
  readonly saved: SavedLocationPresentation
  readonly latDraft: string
  readonly lonDraft: string
  readonly altitudeDraft: string
  readonly pendingMapResult: { lat: number; lon: number } | null
  readonly setLatDraft: (value: string) => void
  readonly setLonDraft: (value: string) => void
  readonly setAltitudeDraft: (value: string) => void
  readonly readDraft: () => LocationDraft
  readonly saveDraft: () => boolean
  readonly clearLocation: () => boolean
  readonly previewMapLocation: (coords: { lat: number; lon: number }) => { lat: number; lon: number }
  readonly clearPendingMapResult: () => void
  readonly commitMapLocation: (center: { lat: number; lon: number } | null) => boolean
}

export interface LocationCoordinateWorkbenchOptions {
  readonly altitudeMode?: 'editable' | 'omit'
}

export function useLocationCoordinateWorkbench(
  options: LocationCoordinateWorkbenchOptions = {},
): LocationCoordinateWorkbench {
  const altitudeEditable = options.altitudeMode !== 'omit'
  const saved = useSavedLocationPresentation()
  const savedLocationRef = useRef(saved.location)
  savedLocationRef.current = saved.location

  const initialDraft = locationDraftFromSaved(saved.location)
  const latDraft = useSignal(initialDraft.lat)
  const lonDraft = useSignal(initialDraft.lon)
  const altitudeDraft = useSignal(initialDraft.altitude)
  const pendingMapResult = useSignal<{ lat: number; lon: number } | null>(null)

  useSignalEffect(() => {
    const next = locationDraftFromSaved(currentDesign.value?.location ?? null)
    latDraft.value = next.lat
    lonDraft.value = next.lon
    altitudeDraft.value = altitudeEditable ? next.altitude : ''
  })

  function readDraftFromSignals(): LocationDraft {
    return {
      lat: latDraft.value,
      lon: lonDraft.value,
      altitude: altitudeEditable ? altitudeDraft.value : '',
    }
  }

  function saveDraftFromSignals(): boolean {
    return saveLocationDraft(readDraftFromSignals())
  }

  function clearLocationFromWorkbench(): boolean {
    pendingMapResult.value = null
    const cleared = clearDesignLocation()
    latDraft.value = ''
    lonDraft.value = ''
    altitudeDraft.value = ''
    return cleared
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
    return setDesignLocation(buildLocationCommit(coords, altitudeEditable ? savedLocationRef.current : null))
  }

  return {
    saved,
    latDraft: latDraft.value,
    lonDraft: lonDraft.value,
    altitudeDraft: altitudeDraft.value,
    pendingMapResult: pendingMapResult.value,
    setLatDraft: (value) => { latDraft.value = value },
    setLonDraft: (value) => { lonDraft.value = value },
    setAltitudeDraft: (value) => {
      if (altitudeEditable) altitudeDraft.value = value
    },
    readDraft: readDraftFromSignals,
    saveDraft: saveDraftFromSignals,
    clearLocation: clearLocationFromWorkbench,
    previewMapLocation,
    clearPendingMapResult,
    commitMapLocation,
  }
}
