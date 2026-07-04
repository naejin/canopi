import { useEffect, useMemo, useRef } from 'preact/hooks'
import { saveLocationDraft } from './controller'
import {
  createLocationSearchController,
  type LocationSearchController,
  type LocationSearchResult,
} from './search-controller'
import {
  useLocationCoordinateWorkbench,
  type LocationCoordinateWorkbench,
} from './coordinate-workbench'
export {
  buildLocationCommit,
  computeSavedPinState,
  getSavedLocationPresentation,
  locationDraftFromSaved,
  readSavedLocationPresentation,
  useSavedLocationPresentation,
  type PinOverlayState,
  type SavedLocationPresentation,
} from './model'

export interface LocationWorkbench extends LocationCoordinateWorkbench {
  readonly search: LocationWorkbenchSearch
  readonly commitSearchResult: (result: LocationSearchResult) => boolean
  readonly previewSearchResultOnMap: (result: LocationSearchResult) => { lat: number; lon: number }
}

export interface LocationWorkbenchSearch extends LocationSearchController {
  readonly setDropdownElement: (element: HTMLElement | null) => void
}

export function useLocationWorkbench(): LocationWorkbench {
  const coordinates = useLocationCoordinateWorkbench()
  const search = useMemo(() => createLocationSearchController(), [])
  const searchDropdownRef = useRef<HTMLElement | null>(null)
  const workbenchSearch = useMemo<LocationWorkbenchSearch>(() => ({
    ...search,
    setDropdownElement: (element) => {
      searchDropdownRef.current = element
    },
  }), [search])
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

  function commitSearchResult(result: LocationSearchResult): boolean {
    coordinates.setLatDraft(result.lat.toString())
    coordinates.setLonDraft(result.lon.toString())
    search.consumeResult()
    return saveLocationDraft({
      ...coordinates.readDraft(),
      lat: result.lat.toString(),
      lon: result.lon.toString(),
    })
  }

  function previewSearchResultOnMap(result: LocationSearchResult): { lat: number; lon: number } {
    search.consumeResult()
    return coordinates.previewMapLocation(result)
  }

  return {
    ...coordinates,
    search: workbenchSearch,
    commitSearchResult,
    previewSearchResultOnMap,
  }
}
