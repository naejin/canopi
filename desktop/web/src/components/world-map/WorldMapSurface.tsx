import { useEffect, useRef } from 'preact/hooks'
import type { TemplateMeta } from '../../types/community'
import {
  createMapLibreHost,
  type MapLibreApi,
  type MapLibreHost,
  type MapLibreHostContext,
} from '../../maplibre/host'
import {
  createWorldMapBounds,
  createWorldMapLibreMap,
  createWorldMapMarker,
  readWorldMapViewState,
  type WorldMapLibreMap,
  type WorldMapMarker,
} from '../../maplibre/world-map'
import { basemapStyle } from '../../app/settings/state'
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
  const hostRef = useRef<MapLibreHost | null>(null)
  const mapRef = useRef<WorldMapLibreMap | null>(null)
  const maplibreRef = useRef<MapLibreApi | null>(null)
  const markersRef = useRef<WorldMapMarker[]>([])
  const lastTemplateLayoutKeyRef = useRef<string>('')
  const templatesRef = useRef(templates)
  const selectedIdRef = useRef(selectedId)
  const onSelectRef = useRef(onSelect)
  templatesRef.current = templates
  selectedIdRef.current = selectedId
  onSelectRef.current = onSelect
  if (!hostRef.current) hostRef.current = createMapLibreHost()

  const preferredBasemapStyle = basemapStyle.value

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const host = hostRef.current
    if (!host) return

    host.attach(container)
    host.requestMap({
      key: preferredBasemapStyle,
      createMap: (maplibre, target, preservedView) => createWorldMapLibreMap(
        maplibre,
        target,
        {
          basemapStyle: preferredBasemapStyle,
          center: preservedView?.center ?? [0, 14],
          zoom: preservedView?.zoom ?? 1.15,
        },
      ),
      captureViewState: (context) => readWorldMapViewState(asWorldMap(context)),
      onCreate: (context) => {
        const map = asWorldMap(context)
        mapRef.current = map
        maplibreRef.current = context.maplibre
        syncTemplateMarkers(map, context.maplibre)
        syncMarkerSelection()
        if (!context.preservedViewState) flyToSelectedTemplate(map)
      },
      onDestroy: (context) => {
        clearMarkers()
        const map = asWorldMap(context)
        if (mapRef.current === map) mapRef.current = null
        if (maplibreRef.current === context.maplibre) maplibreRef.current = null
      },
    })

    return () => {
      host.destroy()
    }
  }, [preferredBasemapStyle])

  useEffect(() => {
    const map = mapRef.current
    const maplibre = maplibreRef.current
    if (map && maplibre) syncTemplateMarkers(map, maplibre)
  }, [templates, preferredBasemapStyle])

  useEffect(() => {
    syncMarkerSelection()
  }, [selectedId, templates, preferredBasemapStyle])

  useEffect(() => {
    const map = mapRef.current
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

  function asWorldMap(context: MapLibreHostContext): WorldMapLibreMap {
    return context.map as unknown as WorldMapLibreMap
  }

  return <div ref={containerRef} className={styles.map} />
}
