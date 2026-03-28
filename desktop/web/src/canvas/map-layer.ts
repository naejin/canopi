import { stageViewportCenter, stageScaleToMapZoom } from './projection'
import { mapLayerVisible, mapStyle, offlineTilesAvailable, type MapStyle } from '../state/canvas'
import { getTile } from '../ipc/tiles'
import {
  DEM_TILES_URL,
  DEM_MAX_ZOOM,
  DEM_ENCODING,
  getContourSourceConfig,
  getContourLayerConfigs,
  getHillshadeLayerConfig,
} from './contours'

// ---------------------------------------------------------------------------
// MapLayerManager — lazy MapLibre integration behind the Konva stage
//
// AD-1: MapLibre renders in a separate <div> behind Konva via z-index.
// AD-6: Konva world meters are authoritative; MapLibre is derived.
//
// Terrain layers (Phase 4.3-4.4):
//   - Hillshade: native MapLibre `hillshade` layer from raster-dem source
//   - Contours: client-side isoline generation via `maplibre-contour` from
//     the same DEM tiles, registered as a custom MapLibre protocol source
// ---------------------------------------------------------------------------

// MapLibre types — imported dynamically to avoid loading ~500KB on startup
type MaplibreMap = import('maplibre-gl').Map

const TILE_SOURCES: Record<MapStyle, string> = {
  street: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  terrain: 'https://tile.opentopomap.org/{z}/{x}/{y}.png',
  satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
}

export interface MapLayerState {
  container: HTMLDivElement
  map: MaplibreMap | null
  /** Whether the maplibre-contour DemSource protocol has been registered. */
  contourReady: boolean
  destroy(): void
}

/**
 * Create the MapLibre container div and position it behind the Konva stage.
 * The map is NOT initialized until `syncMap()` is called — lazy loading.
 */
export function createMapLayer(stageContainer: HTMLElement): MapLayerState {
  const container = document.createElement('div')
  container.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 0;
    pointer-events: none;
    display: none;
  `
  // Insert before the Konva container so it renders behind
  stageContainer.parentElement?.insertBefore(container, stageContainer)

  const state: MapLayerState = {
    container,
    map: null,
    contourReady: false,
    destroy() {
      state.map?.remove()
      state.map = null
      container.remove()
    },
  }

  return state
}

// Custom protocol prefix for offline tiles served via IPC
const OFFLINE_PROTOCOL = 'canopi-tiles'
let _offlineProtocolRegistered = false

/**
 * Register the `canopi-tiles://` custom protocol with MapLibre.
 * When offline tiles are available, MapLibre will call this handler
 * instead of fetching from the network.
 *
 * URL format: canopi-tiles://{z}/{x}/{y}
 */
async function _ensureOfflineProtocol(
  maplibregl: typeof import('maplibre-gl'),
): Promise<void> {
  if (_offlineProtocolRegistered) return
  _offlineProtocolRegistered = true

  maplibregl.addProtocol(OFFLINE_PROTOCOL, async (params: { url: string }) => {
    // Parse z/x/y from URL: canopi-tiles://{z}/{x}/{y}
    const url = params.url.replace(`${OFFLINE_PROTOCOL}://`, '')
    const parts = url.split('/')
    if (parts.length < 3) {
      throw new Error(`Invalid tile URL: ${params.url}`)
    }
    const z = parseInt(parts[0]!, 10)
    const x = parseInt(parts[1]!, 10)
    const y = parseInt(parts[2]!, 10)

    const bytes = await getTile(z, x, y)
    // Tauri returns Vec<u8> as a number array — convert to Uint8Array
    const data = new Uint8Array(bytes)
    return { data }
  })
}

// Minimal type for the DemSource instance — the package uses a default export
// object pattern that doesn't expose DemSource as a top-level named export,
// so we define the interface for the methods we actually use.
interface DemSourceInstance {
  setupMaplibre(maplibregl: unknown): void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  contourProtocolUrl: (options: any) => string
}

// Cached DemSource instance — shared across style rebuilds so protocols
// are only registered once per app session.
let _demSource: DemSourceInstance | null = null

/**
 * Initialize the maplibre-contour DemSource and register its protocol
 * handlers with the MapLibre global. Returns the DemSource for building
 * contour source URLs.
 *
 * Safe to call multiple times — the protocol is registered only once.
 */
async function _ensureDemProtocol(
  maplibregl: typeof import('maplibre-gl'),
): Promise<DemSourceInstance> {
  if (_demSource) return _demSource

  const mlContour = (await import('maplibre-contour')).default

  const source = new mlContour.DemSource({
    url: DEM_TILES_URL,
    encoding: DEM_ENCODING,
    maxzoom: DEM_MAX_ZOOM,
    worker: true,
    cacheSize: 100,
  }) as unknown as DemSourceInstance

  source.setupMaplibre(maplibregl)
  _demSource = source

  return source
}

/**
 * Sync MapLibre viewport with the Konva stage. Call on every pan/zoom.
 * Lazily initializes MapLibre on first call when conditions are met.
 */
export async function syncMap(
  state: MapLayerState,
  stage: { width(): number; height(): number; position(): { x: number; y: number }; scaleX(): number },
  location: { lat: number; lon: number } | null,
): Promise<void> {
  // Must have location AND map toggle on
  if (!mapLayerVisible.value || !location) {
    state.container.style.display = 'none'
    return
  }

  state.container.style.display = 'block'

  // Lazy init
  if (!state.map) {
    const maplibregl = await import('maplibre-gl')
    // Import MapLibre CSS
    await import('maplibre-gl/dist/maplibre-gl.css')

    // Register offline tile protocol (always register, used when tiles are available)
    await _ensureOfflineProtocol(maplibregl)

    // Register contour DEM protocol before building the style
    const demSource = await _ensureDemProtocol(maplibregl)
    state.contourReady = true

    const center = stageViewportCenter(stage, location.lat, location.lon)
    const zoom = stageScaleToMapZoom(stage.scaleX(), location.lat)

    state.map = new maplibregl.Map({
      container: state.container,
      style: _buildStyle(mapStyle.value, demSource),
      center: [center.lng, center.lat],
      zoom: Math.max(0, Math.min(22, zoom)),
      interactive: false, // Konva handles all interaction
      attributionControl: false,
    })

    return
  }

  // Update viewport
  const center = stageViewportCenter(stage, location.lat, location.lon)
  const zoom = stageScaleToMapZoom(stage.scaleX(), location.lat)

  state.map.jumpTo({
    center: [center.lng, center.lat],
    zoom: Math.max(0, Math.min(22, zoom)),
  })
}

/**
 * Switch MapLibre tile style. Rebuilds with terrain sources included.
 */
export function setMapStyle(state: MapLayerState, style: MapStyle): void {
  if (state.map) {
    state.map.setStyle(_buildStyle(style, _demSource))
  }
}

/**
 * Set the opacity of the MapLibre container div (0-1).
 */
export function setMapOpacity(state: MapLayerState, opacity: number): void {
  state.container.style.opacity = String(Math.max(0, Math.min(1, opacity)))
}

// ── Terrain layer visibility / paint controls ───────────────────────────────

/**
 * Toggle visibility of contour layers (minor lines, major lines, labels).
 */
export function setContourVisibility(state: MapLayerState, visible: boolean): void {
  if (!state.map) return
  const vis = visible ? 'visible' : 'none'
  for (const id of ['contour-minor', 'contour-major', 'contour-labels']) {
    try { state.map.setLayoutProperty(id, 'visibility', vis) } catch { /* layer not yet loaded */ }
  }
}

/**
 * Toggle visibility of the hillshade layer.
 */
export function setHillshadeVisibility(state: MapLayerState, visible: boolean): void {
  if (!state.map) return
  try {
    state.map.setLayoutProperty('hillshade-layer', 'visibility', visible ? 'visible' : 'none')
  } catch { /* layer not yet loaded */ }
}

/**
 * Update the hillshade layer's overall opacity (exaggeration).
 * Uses `hillshade-exaggeration` paint property (0-1).
 */
export function setHillshadeOpacity(state: MapLayerState, opacity: number): void {
  if (!state.map) return
  const clamped = Math.max(0, Math.min(1, opacity))
  try {
    state.map.setPaintProperty('hillshade-layer', 'hillshade-exaggeration', clamped)
  } catch { /* layer not yet loaded */ }
}

/**
 * Rebuild the contour source with a new interval. Requires removing and
 * re-adding the source + layers since MapLibre doesn't allow mutating
 * protocol tile URLs on an existing source.
 */
export function updateContourInterval(state: MapLayerState, interval: number, isDark: boolean): void {
  if (!state.map || !_demSource) return

  const map = state.map

  // Capture current visibility before removing layers
  let wasVisible = true
  try {
    wasVisible = map.getLayoutProperty('contour-minor', 'visibility') !== 'none'
  } catch { /* layer not present */ }

  // Remove existing contour layers + source
  for (const id of ['contour-labels', 'contour-major', 'contour-minor']) {
    try { map.removeLayer(id) } catch { /* not present */ }
  }
  try { map.removeSource('contour-source') } catch { /* not present */ }

  // Re-add with updated interval
  const contourSrc = getContourSourceConfig(_demSource.contourProtocolUrl, interval)
  map.addSource('contour-source', contourSrc as import('maplibre-gl').SourceSpecification)

  const contourLayers = getContourLayerConfigs(isDark)
  const vis = wasVisible ? 'visible' : 'none'

  map.addLayer(contourLayers.minor as import('maplibre-gl').LayerSpecification)
  map.addLayer(contourLayers.major as import('maplibre-gl').LayerSpecification)
  map.addLayer(contourLayers.labels as import('maplibre-gl').LayerSpecification)

  // Restore visibility state
  for (const id of ['contour-minor', 'contour-major', 'contour-labels']) {
    try { map.setLayoutProperty(id, 'visibility', vis) } catch { /* */ }
  }
}

// ── Style builder ───────────────────────────────────────────────────────────

function _buildStyle(
  style: MapStyle,
  demSource: DemSourceInstance | null = null,
): import('maplibre-gl').StyleSpecification {
  // Base sources: raster tiles
  // When offline tiles are available, use the custom canopi-tiles:// protocol
  // which fetches tiles from disk via IPC. Otherwise use online sources.
  const useOffline = offlineTilesAvailable.value
  const tileUrl = useOffline
    ? `${OFFLINE_PROTOCOL}://{z}/{x}/{y}`
    : TILE_SOURCES[style]

  const sources: Record<string, import('maplibre-gl').SourceSpecification> = {
    'raster-tiles': {
      type: 'raster' as const,
      tiles: [tileUrl],
      tileSize: 256,
      attribution: useOffline
        ? 'Offline tiles &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        : style === 'street'
          ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          : style === 'terrain'
            ? '&copy; <a href="https://opentopomap.org">OpenTopoMap</a>'
            : '&copy; Esri &amp; contributors',
    },
  }

  // Layers: base raster first
  const layers: import('maplibre-gl').LayerSpecification[] = [
    {
      id: 'base-tiles',
      type: 'raster' as const,
      source: 'raster-tiles',
      minzoom: 0,
      maxzoom: 19,
    } as import('maplibre-gl').LayerSpecification,
  ]

  // Add DEM terrain source for hillshade
  sources['terrain-dem'] = {
    type: 'raster-dem' as const,
    tiles: [DEM_TILES_URL],
    tileSize: 256,
    encoding: DEM_ENCODING,
  } as import('maplibre-gl').SourceSpecification

  // Hillshade layer — rendered from raster-dem, warm field-notebook colors
  const hillshade = getHillshadeLayerConfig(0.3)
  layers.push(hillshade as unknown as import('maplibre-gl').LayerSpecification)

  // Contour source + layers (only if DemSource protocol is registered)
  if (demSource) {
    // Default adaptive intervals (interval=0 means adaptive)
    const contourSrc = getContourSourceConfig(demSource.contourProtocolUrl, 0)
    sources['contour-source'] = contourSrc as import('maplibre-gl').SourceSpecification

    const isDark = document.documentElement.dataset.theme === 'dark'
    const contourLayers = getContourLayerConfigs(isDark)

    layers.push(contourLayers.minor as import('maplibre-gl').LayerSpecification)
    layers.push(contourLayers.major as import('maplibre-gl').LayerSpecification)
    layers.push(contourLayers.labels as import('maplibre-gl').LayerSpecification)
  }

  return {
    version: 8 as const,
    sources,
    layers,
  }
}
