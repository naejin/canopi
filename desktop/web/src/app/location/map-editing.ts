import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import maplibregl from 'maplibre-gl'
import { createMapLibreBasemapStyle } from '../../maplibre/config'
import { basemapStyle } from '../settings/state'
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
  const mapRef = useRef<maplibregl.Map | null>(null)
  const preservedViewRef = useRef<{ center: [number, number]; zoom: number } | null>(null)
  const savedLocationRef = useRef(workbench.saved.location)
  const workbenchRef = useRef(workbench)
  savedLocationRef.current = workbench.saved.location
  workbenchRef.current = workbench

  const mapInitFailed = useSignal(false)
  const pinState = useSignal<PinOverlayState>({ visible: false, x: 0, y: 0, clamped: false, angle: 0 })
  const preferredBasemapStyle = basemapStyle.value

  useEffect(() => {
    const container = mapContainerRef.current
    if (!container) return
    mapInitFailed.value = false
    const savedLoc = savedLocationRef.current
    const preservedView = preservedViewRef.current
    const center: [number, number] = preservedView?.center
      ?? (savedLoc ? [savedLoc.lon, savedLoc.lat] : DEFAULT_CENTER)

    let map: maplibregl.Map | null = null
    const onMove = () => {
      if (map) updatePinPosition(map)
    }
    const onDragStart = () => workbenchRef.current.clearPendingMapResult()

    try {
      map = new maplibregl.Map({
        container,
        style: createMapLibreBasemapStyle(preferredBasemapStyle),
        center,
        zoom: preservedView?.zoom ?? (savedLoc ? 10 : 3.2),
        attributionControl: { compact: true },
      })

      map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'bottom-right')
    } catch (error) {
      if (map) {
        try {
          map.remove()
        } catch (cleanupError) {
          console.error('[LocationTab] Failed to clean up MapLibre map after initialization failure', cleanupError)
        }
      }
      container.replaceChildren()
      mapRef.current = null
      mapInitFailed.value = true
      console.error('[LocationTab] Failed to initialize MapLibre map', error)
      return
    }

    map.on('move', onMove)
    map.on('moveend', onMove)
    map.on('dragstart', onDragStart)

    mapRef.current = map
    updatePinPosition(map)

    return () => {
      const center = map.getCenter()
      preservedViewRef.current = {
        center: [center.lng, center.lat],
        zoom: map.getZoom(),
      }
      map.off('move', onMove)
      map.off('moveend', onMove)
      map.off('dragstart', onDragStart)
      map.remove()
      mapRef.current = null
    }
  }, [preferredBasemapStyle])

  useEffect(() => {
    const container = mapContainerRef.current
    if (!container) return

    const observer = new ResizeObserver(() => {
      const map = mapRef.current
      if (!map) return
      map.resize()
      updatePinPosition(map)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (map) updatePinPosition(map)
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

  function updatePinPosition(map: maplibregl.Map) {
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
