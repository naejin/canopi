import { useEffect, useRef, useState } from 'preact/hooks'
import type { TemplateMeta } from '../../types/community'
import type { MapLibreApi } from '../../maplibre/loader'
import { MapLibreSurface } from '../../maplibre/surface'
import {
  createWorldMapBounds,
  createWorldMapLibreMap,
  createWorldMapMarker,
  type WorldMapLibreMap,
  type WorldMapMarker,
} from '../../maplibre/world-map'
import { effect } from '@preact/signals'
import { readWorkspaceBackgroundPresentation } from '../../app/canvas-map-surface/workspace-activation-snapshot'
import { mountMapBackground, type MapBackgroundMap } from '../../maplibre/map-background'
import { BasemapTileAuth } from '../../maplibre/basemap-tile-auth'
import styles from './WorldMapSurface.module.css'

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
  const [surface] = useState(() => new MapLibreSurface<WorldMapLibreMap>())
  const markersRef = useRef<WorldMapMarker[]>([])
  const lastTemplateLayoutKeyRef = useRef<string>('')
  const templatesRef = useRef(templates)
  const selectedIdRef = useRef(selectedId)
  const onSelectRef = useRef(onSelect)
  templatesRef.current = templates
  selectedIdRef.current = selectedId
  onSelectRef.current = onSelect

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Created before the map, because MapLibre takes its request transform as a
    // construction option.
    const tileAuth = new BasemapTileAuth()
    // One map for the surface's life: a basemap change is reconciled into the live map by the background mount below,
    // so it cannot reset the camera, the markers or any other layer.
    surface.open(container, {
      createMap: (maplibre, target) => createWorldMapLibreMap(maplibre, target, tileAuth.transformRequest),
      // The World map has no camera driver: its request owns the map's resize (spec §1.1 "Resize").
      onResize: (context) => context.map.resize(),
      onCreate: (context) => {
        // The same background band owner as the workspace map: Basemap or
        // Satellite from the map layer store, with their attribution.
        const background = mountMapBackground({
          map: context.map as unknown as MapBackgroundMap,
          maplibre: context.maplibre,
          tileAuth,
          lifetime: context.lifetime,
        })
        const stopBackground = effect(() => background.update(readWorkspaceBackgroundPresentation()))
        context.lifetime.addCleanup(() => {
          stopBackground()
          background.dispose()
        })
        context.lifetime.addCleanup(clearMarkers)
        syncTemplateMarkers(context.map, context.maplibre)
        syncMarkerSelection()
        flyToSelectedTemplate(context.map)
      },
    })

    return () => {
      surface.destroy()
    }
    // Runs once: the background band follows the map layer store through the
    // effect installed above.
  }, [])

  // The live map gets new markers when the templates change; the map's creation places the first ones.
  useEffect(() => {
    const { map, maplibre } = surface
    if (map && maplibre) syncTemplateMarkers(map, maplibre)
  }, [templates])

  useEffect(() => {
    syncMarkerSelection()
  }, [selectedId, templates])

  useEffect(() => {
    const map = surface.map
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

  // MapLibre's keyboard handler pans this map with the arrows: the container owns them, so Shift+arrows on it never
  // turn or reset the workspace view (spec §1.6, fixture H26).
  return <div ref={containerRef} className={styles.map} data-owns-keys="arrows" />
}
