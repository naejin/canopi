import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import type { BasemapStyle } from '../../generated/contracts'
import type { PlacementStatus, SpatialFrame } from '../../types/design'
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
  mapStyleReadiness,
  mountBasemapLifecycle,
} from '../../maplibre/basemap-bind'
import { BasemapTileAuth } from '../../maplibre/basemap-tile-auth'
import type {
  BasemapViewport,
} from '../../maplibre/basemap-provider-session'
import {
  computeSavedPinState,
  type PinOverlayState,
  type SavedLocationPresentation,
} from './model'

const DEFAULT_CENTER: [number, number] = [0, 20]

/**
 * The provider viewport for a live location map.
 *
 * A map that is not ready yet reports the whole world at overview zoom, which
 * describes what it is actually showing rather than inventing an extent.
 */
function readLocationMapViewport(map: LocationMapLibreMap | null): BasemapViewport {
  const bounds = map?.getBounds?.()
  const zoom = map?.getZoom?.()
  if (!bounds || typeof zoom !== 'number') {
    return { west: -180, south: -85, east: 180, north: 85, zoom: 0 }
  }
  return {
    west: bounds.getWest(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    north: bounds.getNorth(),
    zoom,
  }
}

interface LocationMapEditingWorkbench {
  readonly saved: SavedLocationPresentation
  readonly pendingPlacement: SpatialFrame | null
  readonly committedPlacementStatus: PlacementStatus | null
  readonly hasPendingPlacementChange: boolean
  readonly previewMapCenter: (center: { lat: number; lon: number } | null) => boolean
  readonly confirmPlacement: () => boolean
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
  readonly hasPendingPlacement: boolean
  readonly canConfirmLocation: boolean
  readonly previewSearchResult: (result: LocationMapSearchResult) => void
  readonly confirmLocation: () => boolean
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
  const tileAuthRef = useRef<BasemapTileAuth | null>(null)
  if (!tileAuthRef.current) tileAuthRef.current = new BasemapTileAuth()

  const mapInitFailed = useSignal(false)
  const pinState = useSignal<PinOverlayState>({ visible: false, x: 0, y: 0, clamped: false, angle: 0 })
  const currentMapCenter = useSignal<{ lat: number; lon: number } | null>(null)
  const preferredBasemapStyle = options.basemapStyle ?? basemapStyle.value

  useEffect(() => {
    const container = mapContainerRef.current
    if (!container) return
    const surface = surfaceRef.current
    if (!surface) return

    mapInitFailed.value = false
    currentMapCenter.value = null
    surface.attach(container)

    const onMove = () => updateCurrentMapState()
    // A settled viewport move refreshes the provider's metadata in place. The
    // session is not per-viewport, so this must not restart the provider.
    const onClick = (event?: unknown) => previewClickedLocation(event)

    // The credential owner is created before the map, because MapLibre takes
    // its request transform as a construction option.
    const tileAuth = tileAuthRef.current ?? new BasemapTileAuth()
    surface.requestMap({
      // Deliberately independent of the provider. A basemap change is
      // reconciled into this map by the binding below, so switching provider
      // cannot reset the camera, the placement crosshair or an edit in
      // progress — which is what the product contract requires and what
      // recreating the map used to break.
      key: 'location-map',
      createMap: (maplibre, target, preservedView) => {
        const savedLoc = savedLocationRef.current
        return createLocationMapLibreMap(
          maplibre,
          target,
          {
            basemapStyle: preferredBasemapStyle,
            center: preservedView?.center
              ?? (workbenchRef.current.saved.anchorLocation
                ? [
                    workbenchRef.current.saved.anchorLocation.lon,
                    workbenchRef.current.saved.anchorLocation.lat,
                  ]
                : DEFAULT_CENTER),
            zoom: preservedView?.zoom ?? (savedLoc ? 10 : 3.2),
            transformRequest: tileAuth.transformRequest,
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

        // The provider's session and viewport work belongs to this map's
        // lifetime, so the binding, the provider and its credential are all
        // torn down together rather than leaving requests and a live session
        // token behind a removed map.
        const basemapMount = mountBasemapLifecycle({
            map: context.map,
            tileAuth,
            readStyle: () => basemapStyle.value,
            readViewport: () => readLocationMapViewport(surfaceRef.current?.map ?? null),
            readVisible: () => !mapInitFailed.peek(),
            styleReady: mapStyleReadiness(context.map, context.lifetime),
            maplibre: context.maplibre,
            mapControls: context.map,
          })
        context.lifetime.addCleanup(() => basemapMount.dispose())
        context.lifetime.on('error', onMapRuntimeError)
        context.lifetime.on('move', onMove)
        context.lifetime.on('moveend', onMove)
        context.lifetime.on('click', onClick)
        updateMapState(context.map)
      },
      onResize: (context) => {
        updateMapState(context.map)
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
    // Only the surface's own structural key belongs here; the basemap style is
    // applied through the provider observer installed in onCreate.
  }, [])

  useEffect(() => {
    updateCurrentMapState()
  }, [workbench.saved.key])

  function previewSearchResult(result: LocationMapSearchResult): void {
    if (!isValidLocation(result)) return
    const next = workbench.previewSearchResultOnMap
      ? workbench.previewSearchResultOnMap(result)
      : workbench.previewMapLocation(result)
    const map = surfaceRef.current?.map
    if (!map) return
    currentMapCenter.value = next
    map.easeTo({
      center: [next.lon, next.lat],
      zoom: 14,
      duration: 600,
      essential: true,
    })
  }

  function confirmLocation(): boolean {
    if (workbench.pendingPlacement !== null) {
      if (!workbench.hasPendingPlacementChange) return false
      return workbench.confirmPlacement()
    }

    const center = currentMapCenter.peek()
    if (!canCommitMapCenter(workbench, center, mapInitFailed.peek())) return false
    if (!workbench.previewMapCenter(center)) return false
    return workbench.confirmPlacement()
  }

  function previewClickedLocation(event?: unknown): void {
    const lngLat = isLocationMapClickEvent(event) ? event.lngLat : undefined
    const lng = lngLat?.lng
    const lat = lngLat?.lat
    if (typeof lng !== 'number' || typeof lat !== 'number') return
    if (!isValidLocation({ lat, lon: lng })) return
    workbenchRef.current.previewMapLocation({ lat, lon: lng })
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

  function updateMapState(map: LocationMapLibreMap): void {
    const center = map.getCenter()
    currentMapCenter.value = { lat: center.lat, lon: center.lng }
    updatePinPosition(map)
  }

  function updateCurrentMapState(): void {
    const map = surfaceRef.current?.map
    if (map) updateMapState(map)
  }

  const hasPendingPlacement = workbench.pendingPlacement !== null
  const canConfirmLocation = hasPendingPlacement
    ? workbench.hasPendingPlacementChange && isValidSpatialFrameAnchor(workbench.pendingPlacement)
    : canCommitMapCenter(workbench, currentMapCenter.value, mapInitFailed.value)

  return {
    mapContainerRef,
    mapUnavailable: mapInitFailed.value,
    pin: pinState.value,
    hasPendingPlacement,
    canConfirmLocation,
    previewSearchResult,
    confirmLocation,
  }
}

function canCommitMapCenter(
  workbench: LocationMapEditingWorkbench,
  center: { lat: number; lon: number } | null,
  mapUnavailable: boolean,
): center is { lat: number; lon: number } {
  if (mapUnavailable || !center || !isValidLocation(center)) return false
  if (workbench.committedPlacementStatus === 'provisional') return true
  const anchor = workbench.saved.anchorLocation
  return workbench.committedPlacementStatus === 'confirmed'
    && Boolean(anchor && (center.lat !== anchor.lat || center.lon !== anchor.lon))
}

function isValidLocation(location: { lat: number; lon: number }): boolean {
  return Number.isFinite(location.lat)
    && Number.isFinite(location.lon)
    && location.lat >= -90
    && location.lat <= 90
    && location.lon >= -180
    && location.lon <= 180
}

function isValidSpatialFrameAnchor(frame: SpatialFrame): boolean {
  return isValidLocation({
    lat: frame.anchor_latitude_deg,
    lon: frame.anchor_longitude_deg,
  })
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
