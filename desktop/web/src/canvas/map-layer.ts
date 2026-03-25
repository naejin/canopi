import { stageViewportCenter, stageScaleToMapZoom } from './projection'
import { mapLayerVisible, mapStyle, type MapStyle } from '../state/canvas'

// ---------------------------------------------------------------------------
// MapLayerManager — lazy MapLibre integration behind the Konva stage
//
// AD-1: MapLibre renders in a separate <div> behind Konva via z-index.
// AD-6: Konva world meters are authoritative; MapLibre is derived.
// ---------------------------------------------------------------------------

// MapLibre types — imported dynamically to avoid loading ~500KB on startup
type MaplibreMap = import('maplibre-gl').Map

const TILE_SOURCES: Record<MapStyle, string> = {
  street: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  terrain: 'https://tile.opentopomap.org/{z}/{x}/{y}.png',
}

export interface MapLayerState {
  container: HTMLDivElement
  map: MaplibreMap | null
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
    destroy() {
      state.map?.remove()
      state.map = null
      container.remove()
    },
  }

  return state
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

    const center = stageViewportCenter(stage, location.lat, location.lon)
    const zoom = stageScaleToMapZoom(stage.scaleX(), location.lat)

    state.map = new maplibregl.Map({
      container: state.container,
      style: _buildStyle(mapStyle.value),
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
 * Switch MapLibre tile style.
 */
export function setMapStyle(state: MapLayerState, style: MapStyle): void {
  if (state.map) {
    state.map.setStyle(_buildStyle(style))
  }
}

function _buildStyle(style: MapStyle): import('maplibre-gl').StyleSpecification {
  return {
    version: 8 as const,
    sources: {
      'raster-tiles': {
        type: 'raster' as const,
        tiles: [TILE_SOURCES[style]],
        tileSize: 256,
        attribution: style === 'street'
          ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          : '&copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
      },
    },
    layers: [
      {
        id: 'base-tiles',
        type: 'raster' as const,
        source: 'raster-tiles',
        minzoom: 0,
        maxzoom: 19,
      },
    ],
  }
}
