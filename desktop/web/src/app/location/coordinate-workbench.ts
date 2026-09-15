import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import {
  confirmedSpatialFrame,
  locationFromSpatialFrame,
  newDesignSpatialFrame,
} from '../../spatial-frame'
import type { SpatialFrame } from '../../types/design'
import { designSessionStore } from '../document-session/store'
import {
  beginDesignPlacementEdit,
  type DesignPlacementEditTransaction,
} from './controller'
import {
  buildLocationCommit,
  useSavedLocationPresentation,
  type SavedLocationPresentation,
} from './model'

export interface LocationCoordinateWorkbench {
  readonly saved: SavedLocationPresentation
  readonly pendingPlacement: SpatialFrame | null
  readonly previewMapLocation: (coords: { lat: number; lon: number }) => { lat: number; lon: number }
  readonly previewMapCenter: (center: { lat: number; lon: number } | null) => boolean
  readonly previewProvisionalPlacement: () => boolean
  readonly confirmPlacement: () => boolean
  readonly cancelPlacement: () => boolean
}

export function useLocationCoordinateWorkbench(): LocationCoordinateWorkbench {
  const saved = useSavedLocationPresentation()
  const sessionIdentity = designSessionStore.sessionIdentity.value
  const placementEditRef = useRef<DesignPlacementEditTransaction | null>(null)
  const pendingPlacement = useSignal<SpatialFrame | null>(null)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape' || !placementEditRef.current) return
      event.preventDefault()
      cancelPlacement()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      cancelPlacement()
    }
  }, [sessionIdentity])

  function ensurePlacementEdit(): DesignPlacementEditTransaction {
    placementEditRef.current ??= beginDesignPlacementEdit()
    return placementEditRef.current
  }

  function previewFrame(frame: SpatialFrame): void {
    const edit = ensurePlacementEdit()
    edit.preview(frame)
    pendingPlacement.value = frame
  }

  function previewMapLocation(coords: { lat: number; lon: number }): { lat: number; lon: number } {
    const next = { lat: coords.lat, lon: coords.lon }
    const edit = ensurePlacementEdit()
    const location = buildLocationCommit(next, locationFromSpatialFrame(edit.original))
    previewFrame(confirmedSpatialFrame(edit.original, location))
    return next
  }

  function previewMapCenter(center: { lat: number; lon: number } | null): boolean {
    if (!center) return false
    previewMapLocation(center)
    return true
  }

  function previewProvisionalPlacement(): boolean {
    previewFrame(newDesignSpatialFrame())
    return true
  }

  function confirmPlacement(): boolean {
    const edit = placementEditRef.current
    if (!edit) return false
    placementEditRef.current = null
    pendingPlacement.value = null
    const outcome = edit.commit()
    return outcome.status === 'committed' && outcome.changed
  }

  function cancelPlacement(): boolean {
    const edit = placementEditRef.current
    if (!edit) return false
    placementEditRef.current = null
    pendingPlacement.value = null
    return edit.abort().status === 'aborted'
  }

  return {
    saved,
    pendingPlacement: pendingPlacement.value,
    previewMapLocation,
    previewMapCenter,
    previewProvisionalPlacement,
    confirmPlacement,
    cancelPlacement,
  }
}
