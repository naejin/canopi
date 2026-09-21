import type { CanvasQuerySurface } from '../../canvas/runtime/runtime'
import type { MapFrame } from '../../canvas/maplibre-camera'
import type { MapLibreApi } from '../../maplibre/loader'
import type { TerrainLayerState, TerrainProtocolSupport } from '../../maplibre/terrain'
import type { LidarMapLayer } from './lidar-sync'
import type { CanvasMapSurfaceOverlaySnapshot } from './overlays'

export interface WorkspaceMapContributionSnapshot {
  readonly sessionIdentity: object
  readonly lidar: readonly Readonly<LidarMapLayer>[]
  readonly terrain: TerrainLayerState
  readonly overlays: CanvasMapSurfaceOverlaySnapshot
  readonly frame: MapFrame | null
  readonly designExtentMeters: number | null
}

export interface WorkspaceMapContributionAdapter {
  read(runtime: CanvasQuerySurface): WorkspaceMapContributionSnapshot | null
  readonly loadTerrainSupport?: (maplibre: MapLibreApi) => Promise<TerrainProtocolSupport>
  /**
   * Register any map protocols this edition serves itself. Desktop installs
   * the bounded raster tile protocol here; an edition without it leaves the
   * hook undefined and stays free of native raster transport.
   */
  readonly installRasterProtocol?: (maplibre: MapLibreApi) => void
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
      bounds: Object.freeze([...layer.bounds]) as LidarMapLayer['bounds'],
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
