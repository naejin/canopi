import type { CanvasQuerySurface } from '../../canvas/runtime/runtime'
import { canvasPaintRevision } from '../../canvas/theme-refresh'
import type { DesignSessionStore } from '../document-session/store'
import { readPanelTargetOverlaySnapshot } from '../panel-targets/presentation'
import type { MapLibreApi } from '../../maplibre/loader'
import type { TerrainLayerState, TerrainProtocolSupport } from '../../maplibre/terrain'
import type { RasterDisplay, RasterDisplayLayer, RasterDisplayMap, RasterDisplayOptions } from '../../maplibre/raster-display/adapter'
import type { CanvasMapSurfaceOverlaySnapshot } from './overlays'

export interface WorkspaceMapContributionSnapshot {
  readonly sessionIdentity: object
  readonly lidar: readonly Readonly<RasterDisplayLayer>[]
  readonly terrain: TerrainLayerState
  readonly overlays: CanvasMapSurfaceOverlaySnapshot
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

/**
 * The contributions both editions read: null without a Design or a plane, else the panel Targets (none in overview) over the
 * edition's LiDAR layers and terrain. Coarse view signals only: the contributions re-read when the Scene changes, the camera
 * settles, the mode changes or the canvas paint changes (theme, backdrop: overlays already on the map repaint in its colours),
 * never on a camera frame alone.
 */
export function readWorkspaceMapContributions(
  runtime: CanvasQuerySurface,
  store: Pick<DesignSessionStore, 'sessionIdentity' | 'hasCurrentDesign'>,
  edition: () => Pick<WorkspaceMapContributionSnapshot, 'lidar' | 'terrain'>,
): WorkspaceMapContributionSnapshot | null {
  const sessionIdentity = store.sessionIdentity.value
  if (!store.hasCurrentDesign()) return null
  const plane = runtime.sessionPlane.value
  if (!plane) return null
  void runtime.revision.scene.value
  void runtime.view.settledCamera.value
  void canvasPaintRevision.value
  const overview = runtime.view.mode.value === 'overview'
  const panelTargets = readPanelTargetOverlaySnapshot()
  return {
    sessionIdentity,
    ...edition(),
    overlays: {
      runtime,
      location: { lat: plane.origin.lat, lon: plane.origin.lon },
      hoveredTargets: overview ? [] : panelTargets.hoveredTargets,
      selectedTargets: overview ? [] : panelTargets.selectedTargets,
    },
  }
}
