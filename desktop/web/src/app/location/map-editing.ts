import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import type { BasemapStyle } from '../../generated/contracts'
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
  type PinOverlayState,
  type SavedLocationPresentation,
} from './model'

const DEFAULT_CENTER: [number, number] = [0, 20]

interface LocationMapEditingWorkbench {
  readonly saved: SavedLocationPresentation
  readonly clearLocation: () => boolean
  readonly clearPendingMapResult: () => void
  readonly commitMapLocation: (center: { lat: number; lon: number } | null) => boolean
  readonly previewMapLocation: (coords: { lat: number; lon: number }) => { lat: number; lon: number }
  readonly previewSearchResultOnMap?: (result: LocationMapSearchResult) => { lat: number; lon: number }
}

interface LocationMapSearchResult {
  readonly displayName: string
  readonly lat: number
  readonly lon: number
}

interface LocationMapClickEvent {
  readonly lngLat?: {
    readonly lng?: unknown
    readonly lat?: unknown
  }
}

export interface LocationMapEditingHostOptions {
  readonly basemapStyle?: BasemapStyle
}

export interface LocationMapEditingHost {
  readonly mapContainerRef: { current: HTMLDivElement | null }
  readonly mapUnavailable: boolean
  readonly pin: PinOverlayState
  readonly committedLocation: SavedLocationPresentation['location']
  readonly previewSearchResult: (result: LocationMapSearchResult) => void
  readonly commitMapLocation: () => boolean
  readonly clearLocation: () => boolean
}

export function useLocationMapEditingHost(
  workbench: LocationMapEditingWorkbench,
  options: LocationMapEditingHostOptions = {},
): LocationMapEditingHost {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<MapLibreSurfaceAdapter<LocationMapLibreMap> | null>(null)
  const savedLocationRef = useRef(workbench.saved.location)
  const workbenchRef = useRef(workbench)
  savedLocationRef.current = workbench.saved.location
  workbenchRef.current = workbench
  if (!surfaceRef.current) surfaceRef.current = createMapLibreSurfaceAdapter()

  const mapInitFailed = useSignal(false)
  const pinState = useSignal<PinOverlayState>({ visible: false, x: 0, y: 0, clamped: false, angle: 0 })
  const preferredBasemapStyle = options.basemapStyle ?? basemapStyle.value

  useEffect(() => {
    const container = mapContainerRef.current
    if (!container) return
    const surface = surfaceRef.current
    if (!surface) return

    mapInitFailed.value = false
    surface.attach(container)

    const onMove = () => updateCurrentPinPosition()
    const onDragStart = () => workbenchRef.current.clearPendingMapResult()
    const onClick = (event?: unknown) => commitClickedLocation(event)

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
        const onMapRuntimeError = (event?: unknown) => {
          if (!context.isCurrent()) return
          if (isLocationMapVisiblyReady(context.map)) return

          mapInitFailed.value = true
          try {
            surface.clearMap()
          } catch (clearError) {
            console.error('[LocationMapEditing] Failed to clear unavailable MapLibre map', clearError)
          } finally {
            container.replaceChildren()
          }
          console.error('[LocationMapEditing] MapLibre map failed before it became ready', event)
        }

        context.lifetime.on('error', onMapRuntimeError)
        context.lifetime.on('move', onMove)
        context.lifetime.on('moveend', onMove)
        context.lifetime.on('dragstart', onDragStart)
        context.lifetime.on('click', onClick)
        updatePinPosition(context.map)
      },
      onResize: (context) => {
        updatePinPosition(context.map)
      },
      onCreateError: (error) => {
        container.replaceChildren()
        mapInitFailed.value = true
        console.error('[LocationMapEditing] Failed to initialize MapLibre map', error)
      },
    })
    return () => {
      surface.destroy()
    }
  }, [preferredBasemapStyle])

  useEffect(() => {
    updateCurrentPinPosition()
  }, [workbench.saved.key])

  function previewSearchResult(result: LocationMapSearchResult): void {
    const next = workbench.previewSearchResultOnMap
      ? workbench.previewSearchResultOnMap(result)
      : workbench.previewMapLocation(result)
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

  function commitClickedLocation(event?: unknown): void {
    const lngLat = isLocationMapClickEvent(event) ? event.lngLat : undefined
    const lng = lngLat?.lng
    const lat = lngLat?.lat
    if (typeof lng !== 'number' || typeof lat !== 'number') return
    workbenchRef.current.clearPendingMapResult()
    workbenchRef.current.commitMapLocation({ lat, lon: lng })
  }

  function isLocationMapClickEvent(event: unknown): event is LocationMapClickEvent {
    if (!event || typeof event !== 'object') return false
    const lngLat = (event as { lngLat?: unknown }).lngLat
    return Boolean(lngLat && typeof lngLat === 'object')
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

function isLocationMapVisiblyReady(map: LocationMapLibreMap): boolean {
  let inspectedReadiness = false

  const readLoaded = readMapReadiness(map.loaded?.bind(map))
  if (readLoaded !== null) {
    inspectedReadiness = true
    if (readLoaded) return true
  }

  const readStyleLoaded = readMapReadiness(map.isStyleLoaded?.bind(map))
  if (readStyleLoaded !== null) {
    inspectedReadiness = true
    if (readStyleLoaded) return true
  }

  return !inspectedReadiness
}

function readMapReadiness(read: (() => boolean) | undefined): boolean | null {
  if (!read) return null
  try {
    return read()
  } catch {
    return false
  }
}
