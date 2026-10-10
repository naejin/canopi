import type { StyleSpecification } from 'maplibre-gl'

export const MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID = 'basemap-background'
export const MAPLIBRE_SATELLITE_SOURCE_ID = 'canopi-satellite'
export const MAPLIBRE_SATELLITE_LAYER_ID = 'satellite-raster'

/**
 * MapLibre's own zoom ceiling on the workspace and snapshot maps: its tile ids stop at z25, and every background layer covers the
 * view with tiles up to the map's maxZoom, so a higher maxZoom throws on every frame. The camera driver's transform guard
 * (constrainCamera) replaces MapLibre's zoom clamp, so the camera still reaches WORKSPACE_MAP_MAX_ZOOM; past z25 MapLibre draws
 * its tiles over-scaled.
 */
export const MAPLIBRE_MAP_MAX_ZOOM = 25

/**
 * The local style every map starts from: one background layer and no remote
 * sources. The Basemap (vector) and Satellite (raster) are installed onto it
 * at runtime, so switching them never calls `setStyle()`.
 */
export function createMapLibreEmptyStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      {
        id: MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID,
        type: 'background',
        paint: { 'background-color': '#f3efe4' },
      },
    ],
  }
}
