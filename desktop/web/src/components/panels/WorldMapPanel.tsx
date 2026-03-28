import { useRef, useEffect } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { t } from '../../i18n'
import { locale, persistCurrentSettings } from '../../state/app'
import { mapLayerVisible, mapStyle, mapLayerOpacity, type MapStyle } from '../../state/canvas'
import {
  templateCatalog, selectedTemplate, catalogLoading,
  climateFilter, styleFilter,
} from '../../state/community'
import { Dropdown, type DropdownItem } from '../shared/Dropdown'
import { LocationInput } from '../canvas/LocationInput'
import { getTemplateCatalog, downloadTemplate } from '../../ipc/community'
import { loadDesign } from '../../ipc/design'
import { currentDesign, designPath, designName, resetDirtyBaselines } from '../../state/design'
import { canvasEngine } from '../../canvas/engine'
import { fromCanopi, extractExtra } from '../../canvas/serializer'
import type { TemplateMeta } from '../../types/community'
import styles from './WorldMapPanel.module.css'

/** Map style dropdown items — translate lazily so i18n is resolved at render time. */
const STYLE_KEYS: { value: MapStyle; labelKey: string }[] = [
  { value: 'street', labelKey: 'canvas.location.mapStreet' },
  { value: 'terrain', labelKey: 'canvas.location.mapTerrain' },
  { value: 'satellite', labelKey: 'canvas.location.mapSatellite' },
]

function getStyleItems(): DropdownItem<MapStyle>[] {
  return STYLE_KEYS.map((s) => ({ value: s.value, label: t(s.labelKey) }))
}

function styleLabelFor(style: MapStyle): string {
  const key = STYLE_KEYS.find((s) => s.value === style)
  return key ? t(key.labelKey) : style
}

/** Unique climate zones from the catalog, for filter chips. */
function getClimateZones(catalog: TemplateMeta[]): string[] {
  const zones = new Set<string>()
  for (const tpl of catalog) zones.add(tpl.climate_zone)
  return Array.from(zones).sort()
}

/** Unique tags from the catalog, for filter chips. */
function getStyleTags(catalog: TemplateMeta[]): string[] {
  const tags = new Set<string>()
  for (const tpl of catalog) {
    for (const tag of tpl.tags) tags.add(tag)
  }
  return Array.from(tags).sort()
}

/** Filter the catalog by active climate + style filters. */
function filteredCatalog(catalog: TemplateMeta[], climate: string, style: string): TemplateMeta[] {
  return catalog.filter((tpl) => {
    if (climate && tpl.climate_zone !== climate) return false
    if (style && !tpl.tags.includes(style)) return false
    return true
  })
}

export function WorldMapPanel() {
  // Subscribe to locale for re-render on language change
  void locale.value

  const visible = mapLayerVisible.value
  const opacity = mapLayerOpacity.value
  const opacityPercent = Math.round(opacity * 100)

  return (
    <div className={styles.panel}>
      <LocationInput />

      <div className={styles.section}>
        <label className={styles.toggleRow}>
          <input
            type="checkbox"
            checked={visible}
            onChange={() => { mapLayerVisible.value = !mapLayerVisible.value; persistCurrentSettings() }}
          />
          {t('canvas.location.showMap')}
        </label>

        {visible && (
          <div className={styles.controls}>
            {/* Map style dropdown */}
            <div className={styles.controlRow}>
              <Dropdown<MapStyle>
                trigger={<span>{styleLabelFor(mapStyle.value)}</span>}
                items={getStyleItems()}
                value={mapStyle.value}
                onChange={(v) => { mapStyle.value = v; persistCurrentSettings() }}
                ariaLabel={t('canvas.location.showMap')}
                triggerClassName={styles.styleTrigger}
                menuClassName={styles.styleMenu}
              />
            </div>

            {/* Opacity slider */}
            <div className={styles.controlRow}>
              <label className={styles.controlLabel}>
                <span>{t('canvas.location.opacity')}</span>
                <span className={styles.opacityValue}>{opacityPercent}%</span>
              </label>
              <input
                type="range"
                className={styles.slider}
                min={0}
                max={100}
                value={opacityPercent}
                onInput={(e) => {
                  mapLayerOpacity.value = Number((e.target as HTMLInputElement).value) / 100
                  persistCurrentSettings()
                }}
                aria-label={t('canvas.location.opacity')}
              />
            </div>
          </div>
        )}
      </div>

      {/* Divider */}
      <div className={styles.divider} />

      {/* Discover section */}
      <DiscoverSection />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Discover section — MapLibre map + template catalog
// ---------------------------------------------------------------------------

function DiscoverSection() {
  void locale.value

  const loading = catalogLoading.value
  const catalog = templateCatalog.value
  const climate = climateFilter.value
  const style = styleFilter.value
  const selected = selectedTemplate.value
  const downloading = useSignal(false)

  // Fetch catalog on mount
  useEffect(() => {
    if (catalog.length > 0) return
    catalogLoading.value = true
    getTemplateCatalog()
      .then((items) => { templateCatalog.value = items })
      .catch((e) => console.error('Failed to load template catalog:', e))
      .finally(() => { catalogLoading.value = false })
  }, [])

  const filtered = filteredCatalog(catalog, climate, style)
  const climateZones = getClimateZones(catalog)
  const styleTags = getStyleTags(catalog)

  const handleUseTemplate = async (tpl: TemplateMeta) => {
    const engine = canvasEngine
    if (!engine) return
    downloading.value = true
    try {
      const tmpPath = await downloadTemplate(tpl.download_url)
      const file = await loadDesign(tmpPath)
      file.extra = extractExtra(file as unknown as Record<string, unknown>)
      fromCanopi(file, engine)
      currentDesign.value = file
      // Make it untitled — user must Save As
      designPath.value = null
      designName.value = tpl.title
      resetDirtyBaselines()
      engine.history.clear()
      engine.showCanvasChrome()
      selectedTemplate.value = null
    } catch (e) {
      console.error('Failed to use template:', e)
    } finally {
      downloading.value = false
    }
  }

  return (
    <div className={styles.discoverSection}>
      <h3 className={styles.discoverTitle}>{t('worldMap.discover')}</h3>

      {/* Filter chips */}
      {catalog.length > 0 && (
        <div className={styles.filterRow}>
          <FilterChips
            label={t('worldMap.filterByClimate')}
            options={climateZones}
            value={climate}
            onChange={(v) => { climateFilter.value = v }}
          />
          <FilterChips
            label={t('worldMap.filterByStyle')}
            options={styleTags}
            value={style}
            onChange={(v) => { styleFilter.value = v }}
          />
        </div>
      )}

      {/* Discovery map */}
      <DiscoveryMap templates={filtered} />

      {/* Template preview card overlay */}
      {selected && (
        <TemplatePreviewCard
          template={selected}
          downloading={downloading.value}
          onUse={() => handleUseTemplate(selected)}
          onClose={() => { selectedTemplate.value = null }}
        />
      )}

      {/* Template list below map */}
      {loading && <p className={styles.loadingText}>{t('plantDb.loading')}</p>}

      {!loading && filtered.length === 0 && (
        <p className={styles.emptyText}>{t('worldMap.noDesigns')}</p>
      )}

      {!loading && filtered.length > 0 && (
        <div className={styles.templateList}>
          {filtered.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              className={`${styles.templateCard}${selected?.id === tpl.id ? ` ${styles.templateCardActive}` : ''}`}
              onClick={() => { selectedTemplate.value = tpl }}
            >
              <span className={styles.templateName}>{tpl.title}</span>
              <span className={styles.templateMeta}>
                {t('worldMap.author', { author: tpl.author })}
                {' · '}
                {t('worldMap.plantCount', { count: tpl.plant_count })}
              </span>
              <span className={styles.templateZone}>{tpl.climate_zone}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Discovery map — MapLibre with clustered markers
// ---------------------------------------------------------------------------

function DiscoveryMap({ templates }: { templates: TemplateMeta[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<unknown>(null)
  const loaded = useSignal(false)

  // Initialize MapLibre lazily
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    let cancelled = false
    ;(async () => {
      const maplibregl = await import('maplibre-gl')
      await import('maplibre-gl/dist/maplibre-gl.css')

      if (cancelled) return

      const map = new maplibregl.Map({
        container: el,
        style: {
          version: 8,
          sources: {
            'osm-tiles': {
              type: 'raster',
              tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
              tileSize: 256,
              attribution: '&copy; OpenStreetMap contributors',
            },
          },
          layers: [{
            id: 'osm-layer',
            type: 'raster',
            source: 'osm-tiles',
            minzoom: 0,
            maxzoom: 19,
          }],
        },
        center: [10, 20],
        zoom: 1.2,
        interactive: true,
        attributionControl: false,
      })

      mapRef.current = map

      map.on('load', () => {
        if (cancelled) return
        loaded.value = true
        addClusterLayers(map, templates)
      })

      // Click handler for markers
      map.on('click', 'template-points', (e: { features?: { properties?: { id?: string } }[] }) => {
        const feature = e.features?.[0]
        if (!feature?.properties?.id) return
        const tpl = templateCatalog.value.find((t) => t.id === feature.properties!.id!)
        if (tpl) selectedTemplate.value = tpl
      })

      // Click on cluster to zoom in
      map.on('click', 'template-clusters', (e: { features?: { properties?: { cluster_id?: number } }[]; lngLat?: { lng: number; lat: number } }) => {
        const feature = e.features?.[0]
        if (!feature?.properties?.cluster_id) return
        const source = map.getSource('templates') as unknown as { getClusterExpansionZoom: (id: number, cb: (err: unknown, zoom: number) => void) => void }
        source.getClusterExpansionZoom(feature.properties.cluster_id, (_err: unknown, zoom: number) => {
          if (e.lngLat) {
            map.easeTo({ center: [e.lngLat.lng, e.lngLat.lat], zoom })
          }
        })
      })

      // Cursor feedback
      map.on('mouseenter', 'template-points', () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', 'template-points', () => { map.getCanvas().style.cursor = '' })
      map.on('mouseenter', 'template-clusters', () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', 'template-clusters', () => { map.getCanvas().style.cursor = '' })
    })()

    return () => {
      cancelled = true
      if (mapRef.current) {
        (mapRef.current as { remove: () => void }).remove()
        mapRef.current = null
      }
      loaded.value = false
    }
  }, [])

  // Update GeoJSON source when templates change.
  // `templates` is a plain prop (not a signal), so useSignalEffect would not
  // re-run when it changes. Use useEffect with templates as a dependency instead.
  useEffect(() => {
    if (!loaded.value) return
    const map = mapRef.current as { getSource: (id: string) => { setData: (data: unknown) => void } | undefined } | null
    if (!map) return
    const source = map.getSource('templates')
    if (source) {
      source.setData(templatesToGeoJSON(templates))
    }
  }, [templates])

  return (
    <div className={styles.mapContainer} ref={containerRef} />
  )
}

/** Build a GeoJSON FeatureCollection from templates. */
function templatesToGeoJSON(templates: TemplateMeta[]) {
  return {
    type: 'FeatureCollection' as const,
    features: templates.map((tpl) => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: [tpl.location.lon, tpl.location.lat],
      },
      properties: {
        id: tpl.id,
        title: tpl.title,
        plant_count: tpl.plant_count,
        climate_zone: tpl.climate_zone,
      },
    })),
  }
}

/** Add clustered GeoJSON source + circle/text layers to the map. */
function addClusterLayers(map: unknown, templates: TemplateMeta[]) {
  const m = map as {
    addSource: (id: string, source: unknown) => void
    addLayer: (layer: unknown) => void
  }

  m.addSource('templates', {
    type: 'geojson',
    data: templatesToGeoJSON(templates),
    cluster: true,
    clusterMaxZoom: 12,
    clusterRadius: 50,
  })

  // Cluster circles
  m.addLayer({
    id: 'template-clusters',
    type: 'circle',
    source: 'templates',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': '#A06B1F',
      'circle-radius': ['step', ['get', 'point_count'], 18, 5, 24, 10, 30],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#F0EBE1',
    },
  })

  // Cluster count labels
  m.addLayer({
    id: 'template-cluster-count',
    type: 'symbol',
    source: 'templates',
    filter: ['has', 'point_count'],
    layout: {
      'text-field': '{point_count_abbreviated}',
      'text-size': 12,
      'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
    },
    paint: {
      'text-color': '#F0EBE1',
    },
  })

  // Individual point markers
  m.addLayer({
    id: 'template-points',
    type: 'circle',
    source: 'templates',
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': '#A06B1F',
      'circle-radius': 8,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#F0EBE1',
    },
  })
}

// ---------------------------------------------------------------------------
// Filter chips
// ---------------------------------------------------------------------------

function FilterChips({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: string[]
  value: string
  onChange: (v: string) => void
}) {
  if (options.length === 0) return null
  return (
    <div className={styles.chipGroup}>
      <span className={styles.chipLabel}>{label}</span>
      <div className={styles.chips}>
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            className={`${styles.chip}${opt === value ? ` ${styles.chipActive}` : ''}`}
            onClick={() => onChange(opt === value ? '' : opt)}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Template preview card (overlay)
// ---------------------------------------------------------------------------

function TemplatePreviewCard({
  template,
  downloading,
  onUse,
  onClose,
}: {
  template: TemplateMeta
  downloading: boolean
  onUse: () => void
  onClose: () => void
}) {
  return (
    <div className={styles.previewCard}>
      <div className={styles.previewHeader}>
        <h4 className={styles.previewTitle}>{template.title}</h4>
        <button type="button" className={styles.previewClose} onClick={onClose} aria-label={t('window.close')}>
          ×
        </button>
      </div>
      <p className={styles.previewAuthor}>{t('worldMap.author', { author: template.author })}</p>
      <p className={styles.previewDescription}>{template.description}</p>
      <div className={styles.previewStats}>
        <span>{t('worldMap.plantCount', { count: template.plant_count })}</span>
        <span>{t('worldMap.climateZone')}: {template.climate_zone}</span>
      </div>
      {template.tags.length > 0 && (
        <div className={styles.previewTags}>
          {template.tags.map((tag) => (
            <span key={tag} className={styles.previewTag}>{tag}</span>
          ))}
        </div>
      )}
      <button
        type="button"
        className={styles.useTemplateBtn}
        onClick={onUse}
        disabled={downloading}
      >
        {downloading ? t('worldMap.downloading') : t('worldMap.useTemplate')}
      </button>
    </div>
  )
}
