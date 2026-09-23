import {
  MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
  MAPLIBRE_BASEMAP_SOURCE_ID,
} from './config'
import type { BasemapProviderState } from './basemap-provider-session'
import { hasUnresolvedSession } from './basemap-tile-auth'

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
  // These take the map's own parameter shape so a real MapLibre instance
  // satisfies this interface structurally. `BasemapRasterSource` and
  // `BasemapRasterLayer` remain the shapes this module *builds*, which is what
  // keeps the reconciler from reaching beyond a raster source and layer.
  addSource(id: string, source: Record<string, unknown>): void
  addLayer(layer: Record<string, unknown>, beforeId?: string): void
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
export interface BasemapContributionOptions {
  /**
   * Whether the map's tile transport can resolve an official session template.
   *
   * An official descriptor carries a credential-free `{session}` template, so a
   * map without that transport would request a literal placeholder and fail
   * every tile. Withdrawing the contribution is the honest outcome; installing
   * a source that cannot load would look like a provider outage.
   */
  readonly officialTilesResolvable?: boolean
  /**
   * Where the raster layer belongs in the target's own stack.
   *
   * The canvas keeps a local background layer beneath the basemap, so the
   * contribution is inserted directly above it rather than appended over the
   * shared scene. Read per reconciliation because the stack changes.
   */
  readonly beforeLayerId?: () => string | null
}

export function reconcileBasemapContribution(
  target: BasemapReconcileTarget,
  state: BasemapProviderState,
  options: BasemapContributionOptions = {},
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

  // An official template is only usable through the transport that resolves its
  // session for this fixed endpoint.
  if (
    descriptor?.official
    && tiles.some(hasUnresolvedSession)
    && options.officialTilesResolvable !== true
  ) {
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
  const layer = {
    id: MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
    type: 'raster' as const,
    source: MAPLIBRE_BASEMAP_SOURCE_ID,
    minzoom: 0,
    layout: { visibility: 'visible' as const },
  }
  // The anchor is optional rather than `undefined`, so a target that takes no
  // insertion point is called with exactly the layer it must add.
  const beforeId = options.beforeLayerId?.() ?? null
  if (beforeId) target.addLayer(layer, beforeId)
  else target.addLayer(layer)
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
