import {
  MAPLIBRE_SATELLITE_LAYER_ID,
  MAPLIBRE_SATELLITE_SOURCE_ID,
} from './config'
import type { SatelliteState } from './satellite-provider-session'
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
  setLayoutProperty(id: string, name: string, value: unknown): void
  /**
   * Sets the Satellite credit on the map-owned attribution control. MapLibre has
   * no setter for a raster source's attribution, so the credit lives on the
   * control and a copyright-only change never rebuilds the tile source.
   */
  replaceSatelliteAttribution(attribution: string): void
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

interface SatelliteContributionOptions {
  /**
   * Whether the map's tile transport can resolve an official session template.
   *
   * An official descriptor carries a credential-free `{session}` template, so a
   * map without that transport would request a literal placeholder and fail
   * every tile. Withdrawing the contribution is the honest outcome; installing
   * a source that cannot load would look like a provider outage.
   */
  readonly officialTilesResolvable: boolean
  /**
   * Where the raster layer belongs in the target's own stack: beneath the first
   * layer that is not background. Read per reconciliation because the stack
   * changes.
   */
  readonly beforeLayerId: () => string | null
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

/**
 * Apply one published provider state to a live map by reconciling only the
 * basemap source and layer.
 *
 * This is the map side of the provider boundary, and it deliberately never
 * calls `setStyle()` and never recreates the map. A key change or a new
 * session therefore cannot disturb the camera, the scene
 * runtime or any other layer — which is the property the product contract
 * requires and the reason key changes are safe mid-edit.
 *
 * Tile configuration (template, tile size, zoom limits) is compared
 * separately from attribution and visibility. Identical publications are
 * no-ops; copyright-only changes update attribution without removing the tile
 * source; a source is rebuilt only when its actual tile configuration requires
 * it, preserving layer order, opacity and overlays.
 */
export function reconcileSatelliteContribution(
  target: SatelliteReconcileTarget,
  state: SatelliteState,
  options: SatelliteContributionOptions,
): void {
  // A loading official provider may keep an already-installed source whose tile
  // configuration is unchanged, hidden via visibility so it cannot present
  // falsely attributed imagery while metadata is pending.
  if (state.state === 'loading') {
    if (readInstalledSource(target)) {
      setSatelliteContributionVisibility(target, false)
      return
    }
    removeContribution(target)
    return
  }

  // An idle or unavailable provider has no imagery to show, so the existing
  // contribution is withdrawn. A generation that cannot serve must not leave
  // the previous generation's tiles on screen: that would present keyless
  // imagery as if the configured key were serving it.
  const descriptor = state.state === 'ready' ? state.descriptor : null
  if (!descriptor || descriptor.tiles.length === 0) {
    removeContribution(target)
    return
  }

  // An official template is only usable through the transport that resolves its
  // session for this fixed endpoint.
  const { tiles, tileSize, maxzoom, attribution } = descriptor
  if (descriptor.official && tiles.some(hasUnresolvedSession) && !options.officialTilesResolvable) {
    removeContribution(target)
    return
  }

  const installed = readInstalledSource(target)
  if (installed && sameTileConfig(installed, tiles, tileSize, maxzoom)) {
    // Identical tile configuration retains the source and its loaded state.
    // Copyright-only: update attribution without removing the tile source.
    target.replaceSatelliteAttribution(attribution)
    setSatelliteContributionVisibility(target, true)
    return
  }

  // Rebuild only when the actual tile configuration requires it. The layer is
  // removed before its source because MapLibre refuses to drop a source that a
  // layer still references; layer order is re-applied by the insertion anchor.
  removeContribution(target)
  // The credit lives on the map-owned control, so the source carries none.
  target.addSource(MAPLIBRE_SATELLITE_SOURCE_ID, { type: 'raster', tiles: [...tiles], tileSize, attribution: '', maxzoom })
  target.replaceSatelliteAttribution(attribution)
  target.addLayer({
    id: MAPLIBRE_SATELLITE_LAYER_ID,
    type: 'raster',
    source: MAPLIBRE_SATELLITE_SOURCE_ID,
    minzoom: 0,
    layout: { visibility: 'visible' },
  }, options.beforeLayerId() ?? undefined)
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
  target.replaceSatelliteAttribution('')
}

/** Hide or show the current basemap without touching its source. */
export function setSatelliteContributionVisibility(
  target: SatelliteReconcileTarget,
  visible: boolean,
): void {
  if (!target.getLayer(MAPLIBRE_SATELLITE_LAYER_ID)) return
  target.setLayoutProperty(
    MAPLIBRE_SATELLITE_LAYER_ID,
    'visibility',
    visible ? 'visible' : 'none',
  )
}
