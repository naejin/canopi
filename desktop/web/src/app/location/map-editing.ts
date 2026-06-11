import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { basemapStyle } from '../settings/state'
import {
  createMapLibreSurfaceAdapter,
  type MapLibreSurfaceAdapter,
} from '../../maplibre/surface-adapter'
import {
  createLocationMapLibreMap,
  readLocationMapViewState,
  type LocationMapLibreMap,
} from '../../maplibre/location-map'
import {
  computeSavedPinState,
  type LocationWorkbench,
  type PinOverlayState,
} from './workbench'
import type { LocationSearchResult } from './search-controller'

const DEFAULT_CENTER: [number, number] = [0, 20]

export interface LocationMapEditingHost {
  readonly mapContainerRef: { current: HTMLDivElement | null }
  readonly mapUnavailable: boolean
  readonly pin: PinOverlayState
  readonly committedLocation: LocationWorkbench['saved']['location']
  readonly previewSearchResult: (result: LocationSearchResult) => void
  readonly commitMapLocation: () => boolean
  readonly clearLocation: () => boolean
}

export function useLocationMapEditingHost(workbench: LocationWorkbench): LocationMapEditingHost {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<MapLibreSurfaceAdapter<LocationMapLibreMap> | null>(null)
  const savedLocationRef = useRef(workbench.saved.location)
  const workbenchRef = useRef(workbench)
  savedLocationRef.current = workbench.saved.location
  workbenchRef.current = workbench
  if (!surfaceRef.current) surfaceRef.current = createMapLibreSurfaceAdapter()

  const mapInitFailed = useSignal(false)
  const pinState = useSignal<PinOverlayState>({ visible: false, x: 0, y: 0, clamped: false, angle: 0 })
  const preferredBasemapStyle = basemapStyle.value

  useEffect(() => {
    const container = mapContainerRef.current
    if (!container) return
    const surface = surfaceRef.current
    if (!surface) return

    mapInitFailed.value = false
    surface.attach(container)

    const onMove = () => updateCurrentPinPosition()
    const onDragStart = () => workbenchRef.current.clearPendingMapResult()

    surface.requestMap({
      key: preferredBasemapStyle,
      createMap: (maplibre, target, preservedView) => {
        const savedLoc = savedLocationRef.current
        return createLocationMapLibreMap(
          maplibre,
          target,
          {
            basemapStyle: preferredBasemapStyle,
            center: preservedView?.center ?? (savedLoc ? [savedLoc.lon, savedLoc.lat] : DEFAULT_CENTER),
            zoom: preservedView?.zoom ?? (savedLoc ? 10 : 3.2),
          },
        )
      },
      captureViewState: (context) => readLocationMapViewState(context.map),
      onCreate: (context) => {
        context.lifetime.on('move', onMove)
        context.lifetime.on('moveend', onMove)
        context.lifetime.on('dragstart', onDragStart)
        updatePinPosition(context.map)
      },
      onResize: (context) => {
        updatePinPosition(context.map)
      },
      onCreateError: (error) => {
        container.replaceChildren()
        mapInitFailed.value = true
        console.error('[LocationTab] Failed to initialize MapLibre map', error)
      },
    })
    return () => {
      surface.destroy()
    }
  }, [preferredBasemapStyle])

  useEffect(() => {
    updateCurrentPinPosition()
  }, [workbench.saved.key])

  function previewSearchResult(result: LocationSearchResult): void {
    const next = workbench.previewSearchResultOnMap(result)
    const map = surfaceRef.current?.map
    if (!map) return
    map.easeTo({
      center: [next.lon, next.lat],
      zoom: 14,
      duration: 600,
      essential: true,
    })
  }

  function commitMapLocation(): boolean {
    const center = surfaceRef.current?.map?.getCenter()
    return workbench.commitMapLocation(center ? { lat: center.lat, lon: center.lng } : null)
  }

  function updatePinPosition(map: LocationMapLibreMap) {
    const loc = savedLocationRef.current
    const container = map.getContainer()
    const next = computeSavedPinState(
      loc,
      { width: container.clientWidth, height: container.clientHeight },
      loc ? map.project([loc.lon, loc.lat]) : { x: 0, y: 0 },
    )

    const prev = pinState.peek()
    if (
      prev.visible !== next.visible ||
      prev.clamped !== next.clamped ||
      Math.abs(prev.x - next.x) > 0.5 ||
      Math.abs(prev.y - next.y) > 0.5 ||
      Math.abs(prev.angle - next.angle) > 0.001
    ) {
      pinState.value = next
    }
  }

  function updateCurrentPinPosition(): void {
    const map = surfaceRef.current?.map
    if (map) updatePinPosition(map)
  }

  return {
    mapContainerRef,
    mapUnavailable: mapInitFailed.value,
    pin: pinState.value,
    committedLocation: workbench.saved.location,
    previewSearchResult,
    commitMapLocation,
    clearLocation: workbench.clearLocation,
  }
}
