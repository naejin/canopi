import type { CanvasQuerySurface } from '../../canvas/runtime/runtime'
import type { MapFrame } from '../../canvas/maplibre-camera'
import type { MapLibreApi } from '../../maplibre/loader'
import type { TerrainLayerState, TerrainProtocolSupport } from '../../maplibre/terrain'
import type { RasterDisplay, RasterDisplayLayer, RasterDisplayMap, RasterDisplayOptions } from '../../maplibre/raster-display/adapter'
import type { CanvasMapSurfaceOverlaySnapshot } from './overlays'

export interface WorkspaceMapContributionSnapshot {
  readonly sessionIdentity: object
  readonly lidar: readonly Readonly<RasterDisplayLayer>[]
  readonly terrain: TerrainLayerState
  readonly overlays: CanvasMapSurfaceOverlaySnapshot
  readonly frame: MapFrame | null
  readonly designExtentMeters: number | null
}

export interface WorkspaceMapContributionAdapter {
  read(runtime: CanvasQuerySurface): WorkspaceMapContributionSnapshot | null
  readonly loadTerrainSupport?: (maplibre: MapLibreApi) => Promise<TerrainProtocolSupport>
  /**
   * Create the map-lifetime raster display for this edition. Desktop renders
   * library data through the upstream renderer; an edition without local data
   * leaves the hook undefined and never loads the renderer.
   */
  readonly createRasterDisplay?: (
    map: RasterDisplayMap,
    options: Pick<RasterDisplayOptions, 'onLayersChanged'>,
  ) => RasterDisplay
  readonly publishViewBounds?: (bounds: [number, number, number, number] | null) => void
}

/** Captures presentation values; the read-only Scene query remains a live geometry authority. */
export function captureWorkspaceMapContributions(
  snapshot: WorkspaceMapContributionSnapshot,
): WorkspaceMapContributionSnapshot {
  return Object.freeze({
    ...snapshot,
    lidar: Object.freeze(snapshot.lidar.map((layer) => Object.freeze({
      ...layer,
      bounds: Object.freeze([...layer.bounds]) as RasterDisplayLayer['bounds'],
      rescale: Object.freeze([...layer.rescale]) as RasterDisplayLayer['rescale'],
      assets: Object.freeze(layer.assets.map((asset) => Object.freeze({
        ...asset,
        bbox: Object.freeze([...asset.bbox]) as RasterDisplayLayer['bounds'],
      }))),
    }))),
    terrain: Object.freeze({ ...snapshot.terrain }),
    overlays: Object.freeze({
      ...snapshot.overlays,
      location: snapshot.overlays.location && Object.freeze({ ...snapshot.overlays.location }),
      hoveredTargets: Object.freeze(snapshot.overlays.hoveredTargets.map((target) => Object.freeze({ ...target }))),
      selectedTargets: Object.freeze(snapshot.overlays.selectedTargets.map((target) => Object.freeze({ ...target }))),
    }),
    frame: snapshot.frame && Object.freeze({
      ...snapshot.frame,
      center: Object.freeze([...snapshot.frame.center]) as readonly [number, number],
      diagnostics: Object.freeze({
        ...snapshot.frame.diagnostics,
        viewportCenterWorld: Object.freeze({ ...snapshot.frame.diagnostics.viewportCenterWorld }),
        viewportCornerGeo: Object.freeze(snapshot.frame.diagnostics.viewportCornerGeo.map(
          (point) => Object.freeze({ ...point }),
        )) as unknown as MapFrame['diagnostics']['viewportCornerGeo'],
      }),
    }),
  })
}
