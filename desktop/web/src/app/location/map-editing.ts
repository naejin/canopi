import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { basemapStyle } from '../settings/state'
import {
  createMapLibreHost,
  type MapLibreHost,
  type MapLibreHostContext,
} from '../../maplibre/host'
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
  const hostRef = useRef<MapLibreHost | null>(null)
  const mapRef = useRef<LocationMapLibreMap | null>(null)
  const savedLocationRef = useRef(workbench.saved.location)
  const workbenchRef = useRef(workbench)
  savedLocationRef.current = workbench.saved.location
  workbenchRef.current = workbench
  if (!hostRef.current) hostRef.current = createMapLibreHost()

  const mapInitFailed = useSignal(false)
  const pinState = useSignal<PinOverlayState>({ visible: false, x: 0, y: 0, clamped: false, angle: 0 })
  const preferredBasemapStyle = basemapStyle.value

  useEffect(() => {
    const container = mapContainerRef.current
    if (!container) return
    const host = hostRef.current
    if (!host) return

    mapInitFailed.value = false
    const savedLoc = savedLocationRef.current
    host.attach(container)

    const onMove = () => updateCurrentPinPosition()
    const onDragStart = () => workbenchRef.current.clearPendingMapResult()

    host.requestMap({
      key: preferredBasemapStyle,
      createMap: (maplibre, target, preservedView) => createLocationMapLibreMap(
        maplibre,
        target,
        {
          basemapStyle: preferredBasemapStyle,
          center: preservedView?.center ?? (savedLoc ? [savedLoc.lon, savedLoc.lat] : DEFAULT_CENTER),
          zoom: preservedView?.zoom ?? (savedLoc ? 10 : 3.2),
        },
      ),
      captureViewState: (context) => readLocationMapViewState(asLocationMap(context)),
      onCreate: (context) => {
        const map = asLocationMap(context)
        map.on('move', onMove)
        map.on('moveend', onMove)
        map.on('dragstart', onDragStart)
        mapRef.current = map
        updatePinPosition(map)
      },
      onResize: (context) => {
        updatePinPosition(asLocationMap(context))
      },
      onDestroy: (context) => {
        const map = asLocationMap(context)
        map.off('move', onMove)
        map.off('moveend', onMove)
        map.off('dragstart', onDragStart)
        if (mapRef.current === map) mapRef.current = null
      },
      onCreateError: (error) => {
        container.replaceChildren()
        mapRef.current = null
        mapInitFailed.value = true
        console.error('[LocationTab] Failed to initialize MapLibre map', error)
      },
    })
    return () => {
      host.destroy()
    }
  }, [preferredBasemapStyle])

  useEffect(() => {
    updateCurrentPinPosition()
  }, [workbench.saved.key])

  function previewSearchResult(result: LocationSearchResult): void {
    const next = workbench.previewSearchResultOnMap(result)
    const map = mapRef.current
    if (!map) return
    map.easeTo({
      center: [next.lon, next.lat],
      zoom: 14,
      duration: 600,
      essential: true,
    })
  }

  function commitMapLocation(): boolean {
    const center = mapRef.current?.getCenter()
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
    const map = mapRef.current
    if (map) updatePinPosition(map)
  }

  function asLocationMap(context: MapLibreHostContext): LocationMapLibreMap {
    return context.map as unknown as LocationMapLibreMap
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
