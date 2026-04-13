import { useEffect, useRef } from 'preact/hooks'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { TemplateMeta } from '../../types/community'
import { DEFAULT_MAPLIBRE_BASEMAP_STYLE_URL } from '../../maplibre/config'
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
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])

  useEffect(() => {
    const container = containerRef.current
    if (!container || mapRef.current) return

    const map = new maplibregl.Map({
      container,
      style: DEFAULT_MAPLIBRE_BASEMAP_STYLE_URL,
      center: [0, 14],
      zoom: 1.15,
      attributionControl: false,
    })

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right')
    mapRef.current = map

    return () => {
      markersRef.current.forEach((marker) => marker.remove())
      markersRef.current = []
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    const map = mapRef.current
    if (!container || !map) return

    const observer = new ResizeObserver(() => {
      map.resize()
    })
    observer.observe(container)

    return () => observer.disconnect()
  }, [])

  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    markersRef.current.forEach((marker) => marker.remove())
    markersRef.current = []

    if (templates.length === 0) return

    const bounds = new maplibregl.LngLatBounds()

    for (const template of templates) {
      const markerElement = document.createElement('button')
      markerElement.type = 'button'
      markerElement.className = styles.marker ?? ''
      markerElement.dataset.templateId = template.id
      markerElement.title = template.title
      markerElement.addEventListener('click', () => onSelectRef.current(template))

      const marker = new maplibregl.Marker({ element: markerElement })
        .setLngLat([template.location.lon, template.location.lat])
        .addTo(map)

      markersRef.current.push(marker)
      bounds.extend([template.location.lon, template.location.lat])
    }

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 48, maxZoom: 4.5, duration: 0 })
      map.resize()
    }
  }, [templates])

  useEffect(() => {
    for (const marker of markersRef.current) {
      const el = marker.getElement()
      const isActive = el.dataset.templateId === selectedId
      el.className = `${styles.marker} ${isActive ? styles.markerActive : ''}`
    }
  }, [selectedId])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !selectedId) return

    const selected = templates.find((template) => template.id === selectedId)
    if (!selected) return

    map.flyTo({
      center: [selected.location.lon, selected.location.lat],
      zoom: Math.max(map.getZoom(), 4.5),
      duration: 600,
      essential: true,
    })
  }, [selectedId, templates])

  return <div ref={containerRef} className={styles.map} />
}
