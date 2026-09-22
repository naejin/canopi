import { useEffect, useRef } from 'preact/hooks'
import type { TemplateMeta } from '../../types/community'
import {
  type MapLibreApi,
} from '../../maplibre/host'
import {
  createMapLibreSurfaceAdapter,
  type MapLibreSurfaceAdapter,
} from '../../maplibre/surface-adapter'
import {
  createWorldMapBounds,
  createWorldMapLibreMap,
  createWorldMapMarker,
  readWorldMapViewState,
  type WorldMapLibreMap,
  type WorldMapMarker,
} from '../../maplibre/world-map'
import { basemapStyle } from '../../app/settings/state'
import { bindBasemapProvider, createBasemapProvider } from '../../maplibre/basemap-bind'
import type {
  BasemapProvider,
  BasemapViewport,
} from '../../maplibre/basemap-provider-session'
import styles from './WorldMapSurface.module.css'

/** The provider viewport for a live map, or a whole-world fallback before one exists. */
function readWorldMapViewport(map: WorldMapLibreMap | null): BasemapViewport {
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

export function WorldMapSurface({
  templates,
  selectedId,
  onSelect,
}: {
  templates: TemplateMeta[]
  selectedId: string | null
  onSelect: (template: TemplateMeta) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<MapLibreSurfaceAdapter<WorldMapLibreMap> | null>(null)
  const providerRef = useRef<BasemapProvider | null>(null)
  const markersRef = useRef<WorldMapMarker[]>([])
  const lastTemplateLayoutKeyRef = useRef<string>('')
  const templatesRef = useRef(templates)
  const selectedIdRef = useRef(selectedId)
  const onSelectRef = useRef(onSelect)
  templatesRef.current = templates
  selectedIdRef.current = selectedId
  onSelectRef.current = onSelect
  if (!surfaceRef.current) surfaceRef.current = createMapLibreSurfaceAdapter()

  const preferredBasemapStyle = basemapStyle.value

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const surface = surfaceRef.current
    if (!surface) return

    surface.attach(container)
    const provider = createBasemapProvider()
    providerRef.current = provider
    surface.requestMap({
      // Deliberately independent of the provider: a basemap change is
      // reconciled into the live map by the binding below, so it cannot reset
      // the camera, the scene or any other layer.
      key: 'world-map',
      createMap: (maplibre, target, preservedView) => createWorldMapLibreMap(
        maplibre,
        target,
        {
          basemapStyle: preferredBasemapStyle,
          center: preservedView?.center ?? [0, 14],
          zoom: preservedView?.zoom ?? 1.15,
        },
      ),
      captureViewState: (context) => readWorldMapViewState(context.map),
      onCreate: (context) => {
        // The provider's session and viewport work belongs to this map's
        // lifetime, so both are torn down together.
        context.lifetime.addCleanup(bindBasemapProvider({ provider, map: context.map }))
        context.lifetime.addCleanup(() => {
          providerRef.current = null
        })
        context.lifetime.addCleanup(clearMarkers)
        syncTemplateMarkers(context.map, context.maplibre)
        syncMarkerSelection()
        if (!context.preservedViewState) flyToSelectedTemplate(context.map)
      },
    })

    return () => {
      surface.destroy()
    }
    // Only the surface's own structural key belongs here. The basemap style is
    // applied through the provider below.
  }, [])

  // A style change updates the provider rather than rebuilding the map, so the
  // camera, the markers and the scene survive a provider switch mid-edit.
  useEffect(() => {
    providerRef.current?.update(
      { style: preferredBasemapStyle },
      readWorldMapViewport(surfaceRef.current?.map ?? null),
    )
  }, [preferredBasemapStyle])

  // Markers are rebuilt when the map is recreated, so the map itself is the
  // signal here rather than the basemap style.
  useEffect(() => {
    const map = surfaceRef.current?.map
    const maplibre = surfaceRef.current?.maplibre
    if (map && maplibre) syncTemplateMarkers(map, maplibre)
  }, [templates])

  useEffect(() => {
    syncMarkerSelection()
  }, [selectedId, templates])

  useEffect(() => {
    const map = surfaceRef.current?.map
    if (map) flyToSelectedTemplate(map)
  }, [selectedId, templates])

  function syncTemplateMarkers(map: WorldMapLibreMap, maplibre: MapLibreApi): void {
    clearMarkers()

    const currentTemplates = templatesRef.current
    if (currentTemplates.length === 0) return

    const bounds = createWorldMapBounds(maplibre)
    const nextTemplateLayoutKey = currentTemplates
      .map((template) => `${template.id}:${template.location.lon}:${template.location.lat}`)
      .join('|')
    const shouldFitBounds = nextTemplateLayoutKey !== lastTemplateLayoutKeyRef.current
    lastTemplateLayoutKeyRef.current = nextTemplateLayoutKey

    for (const template of currentTemplates) {
      const markerElement = document.createElement('button')
      markerElement.type = 'button'
      markerElement.className = styles.marker ?? ''
      markerElement.dataset.templateId = template.id
      markerElement.title = template.title
      markerElement.addEventListener('click', () => onSelectRef.current(template))

      const marker = createWorldMapMarker(maplibre, markerElement)
        .setLngLat([template.location.lon, template.location.lat])
        .addTo(map)

      markersRef.current.push(marker)
      bounds.extend([template.location.lon, template.location.lat])
    }

    if (shouldFitBounds && !bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 48, maxZoom: 4.5, duration: 0 })
      map.resize()
    }
  }

  function syncMarkerSelection(): void {
    for (const marker of markersRef.current) {
      const el = marker.getElement()
      const isActive = el.dataset.templateId === selectedIdRef.current
      el.className = `${styles.marker} ${isActive ? styles.markerActive : ''}`
    }
  }

  function flyToSelectedTemplate(map: WorldMapLibreMap): void {
    const selectedId = selectedIdRef.current
    if (!selectedId) return

    const selected = templatesRef.current.find((template) => template.id === selectedId)
    if (!selected) return

    map.flyTo({
      center: [selected.location.lon, selected.location.lat],
      zoom: Math.max(map.getZoom(), 4.5),
      duration: 600,
      essential: true,
    })
  }

  function clearMarkers(): void {
    markersRef.current.forEach((marker) => marker.remove())
    markersRef.current = []
  }

  return <div ref={containerRef} className={styles.map} />
}
