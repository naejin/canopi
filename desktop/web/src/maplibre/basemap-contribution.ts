import {
  MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
  MAPLIBRE_BASEMAP_SOURCE_ID,
} from './config'
import type { BasemapProviderState } from './basemap-provider-session'

/**
 * The narrow MapLibre surface this adapter mutates.
 *
 * Declared structurally so the adapter is testable without a browser GL
 * context, and so it cannot reach anything beyond exactly these operations.
 */
export interface BasemapReconcileTarget {
  getSource(id: string): unknown
  getLayer(id: string): unknown
  removeLayer(id: string): void
  removeSource(id: string): void
  addSource(id: string, source: BasemapRasterSource): void
  addLayer(layer: BasemapRasterLayer): void
  setLayoutProperty?(id: string, name: string, value: unknown): void
}

export interface BasemapRasterSource {
  readonly type: 'raster'
  readonly tiles: string[]
  readonly tileSize: number
  readonly attribution: string
  readonly maxzoom: number
}

export interface BasemapRasterLayer {
  readonly id: string
  readonly type: 'raster'
  readonly source: string
  readonly minzoom: number
  readonly layout: { readonly visibility: 'visible' | 'none' }
}

/**
 * Apply one published provider state to a live map by reconciling only the
 * basemap source and layer.
 *
 * This is the map side of the provider boundary, and it deliberately never
 * calls `setStyle()` and never recreates the map. A provider switch, a key
 * change or a new session therefore cannot disturb the camera, the scene
 * runtime or any other layer — which is the property the product contract
 * requires and the reason provider changes are safe mid-edit.
 *
 * Removing the source before adding it keeps one contribution rather than
 * accumulating them, and the layer is removed before its source because
 * MapLibre refuses to drop a source that a layer still references.
 */
export function reconcileBasemapContribution(
  target: BasemapReconcileTarget,
  state: BasemapProviderState,
): void {
  const descriptor = state.state === 'ready' ? state.descriptor : null
  const tiles = descriptor?.tiles ?? []

  // An idle, loading or unavailable provider has no imagery to show, so the
  // existing contribution is withdrawn. A provider that cannot serve must not
  // leave the previous provider's tiles on screen: that would present one
  // provider's imagery under another's name.
  if (tiles.length === 0) {
    removeContribution(target)
    return
  }

  // Rebuild the contribution so a changed provider, tile size, zoom ceiling or
  // attribution is applied wholesale rather than partially updated.
  removeContribution(target)
  target.addSource(MAPLIBRE_BASEMAP_SOURCE_ID, {
    type: 'raster',
    tiles: [...tiles],
    tileSize: descriptor?.tileSize ?? 256,
    attribution: descriptor?.attribution ?? '',
    maxzoom: descriptor?.maxzoom ?? 19,
  })
  target.addLayer({
    id: MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
    type: 'raster',
    source: MAPLIBRE_BASEMAP_SOURCE_ID,
    minzoom: 0,
    layout: { visibility: 'visible' },
  })
}

/** Withdraw the basemap contribution when there is one. */
function removeContribution(target: BasemapReconcileTarget): void {
  if (target.getLayer(MAPLIBRE_BASEMAP_RASTER_LAYER_ID)) {
    target.removeLayer(MAPLIBRE_BASEMAP_RASTER_LAYER_ID)
  }
  if (target.getSource(MAPLIBRE_BASEMAP_SOURCE_ID)) {
    target.removeSource(MAPLIBRE_BASEMAP_SOURCE_ID)
  }
}

/** Hide or show the current basemap without touching its source. */
export function setBasemapContributionVisibility(
  target: BasemapReconcileTarget,
  visible: boolean,
): void {
  if (!target.getLayer(MAPLIBRE_BASEMAP_RASTER_LAYER_ID)) return
  target.setLayoutProperty?.(
    MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
    'visibility',
    visible ? 'visible' : 'none',
  )
}
