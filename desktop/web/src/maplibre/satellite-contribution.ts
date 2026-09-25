import {
  MAPLIBRE_SATELLITE_LAYER_ID,
  MAPLIBRE_SATELLITE_SOURCE_ID,
} from './config'
import type { SatelliteProviderState } from './satellite-provider-session'
import { hasUnresolvedSession } from './basemap-tile-auth'

/**
 * The narrow MapLibre surface this adapter mutates.
 *
 * Declared structurally so the adapter is testable without a browser GL
 * context, and so it cannot reach anything beyond exactly these operations.
 */
export interface SatelliteReconcileTarget {
  getSource(id: string): unknown
  getLayer(id: string): unknown
  removeLayer(id: string): void
  removeSource(id: string): void
  // These take the map's own parameter shape so a real MapLibre instance
  // satisfies this interface structurally. `SatelliteRasterSource` and
  // `SatelliteRasterLayer` remain the shapes this module *builds*, which is what
  // keeps the reconciler from reaching beyond a raster source and layer.
  addSource(id: string, source: Record<string, unknown>): void
  addLayer(layer: Record<string, unknown>, beforeId?: string): void
  setLayoutProperty?(id: string, name: string, value: unknown): void
  /**
   * Optional: update basemap attribution without removing the tile source.
   *
   * Installed MapLibre has no dynamic raster-source attribution setter, so a
   * map-owned attribution control adapter is the supported way to change only
   * the copyright. When absent, a copyright-only change is applied by replacing
   * the attribution-bearing source only if tile configuration also changed.
   */
  replaceSatelliteAttribution?(attribution: string): void
}

export interface SatelliteRasterSource {
  readonly type: 'raster'
  readonly tiles: string[]
  readonly tileSize: number
  readonly attribution: string
  readonly maxzoom: number
}

export interface SatelliteRasterLayer {
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
 * Tile configuration (provider/template, tile size, zoom limits) is compared
 * separately from attribution and visibility. Identical publications are
 * no-ops; copyright-only changes update attribution without removing the tile
 * source; a source is rebuilt only when its actual tile configuration requires
 * it, preserving layer order, opacity and overlays.
 */
export interface SatelliteContributionOptions {
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

function readInstalledSource(target: SatelliteReconcileTarget): SatelliteRasterSource | null {
  const source = target.getSource(MAPLIBRE_SATELLITE_SOURCE_ID) as SatelliteRasterSource | null | undefined
  if (!source || source.type !== 'raster') return null
  return source
}

function sameTiles(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  return a.every((tile, index) => tile === b[index])
}

function sameTileConfig(
  a: SatelliteRasterSource,
  tiles: readonly string[],
  tileSize: number,
  maxzoom: number,
): boolean {
  return a.tileSize === tileSize && a.maxzoom === maxzoom && sameTiles(a.tiles, tiles)
}

export function reconcileSatelliteContribution(
  target: SatelliteReconcileTarget,
  state: SatelliteProviderState,
  options: SatelliteContributionOptions = {},
): void {
  const descriptor = state.state === 'ready' ? state.descriptor : null
  const tiles = descriptor?.tiles ?? []

  // A loading official provider may keep an already-installed source whose tile
  // configuration is unchanged, hidden via visibility so it cannot present
  // falsely attributed imagery while metadata is pending.
  if (state.state === 'loading') {
    const installed = readInstalledSource(target)
    if (installed) {
      setSatelliteContributionVisibility(target, false)
      return
    }
    removeContribution(target)
    return
  }

  // An idle or unavailable provider has no imagery to show, so the existing
  // contribution is withdrawn. A provider that cannot serve must not leave the
  // previous provider's tiles on screen: that would present one provider's
  // imagery under another's name.
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

  const tileSize = descriptor?.tileSize ?? 256
  const maxzoom = descriptor?.maxzoom ?? 19
  const attribution = descriptor?.attribution ?? ''
  const installed = readInstalledSource(target)

  if (installed && sameTileConfig(installed, tiles, tileSize, maxzoom)) {
    // Identical tile configuration retains the source and its loaded state.
    // Copyright-only: update attribution without removing the tile source.
    if (typeof target.replaceSatelliteAttribution === 'function') {
      target.replaceSatelliteAttribution(attribution)
    }
    setSatelliteContributionVisibility(target, true)
    return
  }

  // Rebuild only when the actual tile configuration requires it. The layer is
  // removed before its source because MapLibre refuses to drop a source that a
  // layer still references; layer order is re-applied by the insertion anchor.
  removeContribution(target)
  const hasAttributionAdapter = typeof target.replaceSatelliteAttribution === 'function'
  target.addSource(MAPLIBRE_SATELLITE_SOURCE_ID, {
    type: 'raster',
    tiles: [...tiles],
    tileSize,
    // With an attribution adapter the credit lives on the map-owned control so
    // a copyright-only change never rebuilds the source. Without one, the
    // source carries the credit so the required attribution cannot disappear.
    attribution: hasAttributionAdapter ? '' : attribution,
    maxzoom,
  })
  if (hasAttributionAdapter) {
    target.replaceSatelliteAttribution?.(attribution)
  }
  const layer = {
    id: MAPLIBRE_SATELLITE_LAYER_ID,
    type: 'raster' as const,
    source: MAPLIBRE_SATELLITE_SOURCE_ID,
    minzoom: 0,
    layout: { visibility: 'visible' as const },
  }
  // The anchor is optional rather than `undefined`, so a target that takes no
  // insertion point is called with exactly the layer it must add.
  const beforeId = options.beforeLayerId?.() ?? null
  if (beforeId) target.addLayer(layer, beforeId)
  else target.addLayer(layer)
}

/** Withdraw the basemap contribution and its owned credit when there is one. */
function removeContribution(target: SatelliteReconcileTarget): void {
  if (target.getLayer(MAPLIBRE_SATELLITE_LAYER_ID)) {
    target.removeLayer(MAPLIBRE_SATELLITE_LAYER_ID)
  }
  if (target.getSource(MAPLIBRE_SATELLITE_SOURCE_ID)) {
    target.removeSource(MAPLIBRE_SATELLITE_SOURCE_ID)
  }
  // Clearing the basemap-owned credit on withdrawal keeps Idle/Unavailable
  // from retaining stale credit after imagery is gone, while credits belonging
  // to other sources remain untouched.
  if (target.replaceSatelliteAttribution) {
    target.replaceSatelliteAttribution('')
  }
}

/** Hide or show the current basemap without touching its source. */
export function setSatelliteContributionVisibility(
  target: SatelliteReconcileTarget,
  visible: boolean,
): void {
  if (!target.getLayer(MAPLIBRE_SATELLITE_LAYER_ID)) return
  target.setLayoutProperty?.(
    MAPLIBRE_SATELLITE_LAYER_ID,
    'visibility',
    visible ? 'visible' : 'none',
  )
}
