import { designSessionStore } from '../document-session/store'
import { mapTerrainStateOf } from '../map-layers/state'
import { presentedMapLayers, presentedSiteDataVisible } from '../story-presentation/overrides'
import { readCurrentLidarPresentation } from '../lidar/library-store'
import { lidarDisplayDescriptors, lidarDisplayLayers } from '../lidar/display'
import { publishLidarMapViewBounds } from '../lidar/camera-request'
import { readPanelTargetOverlaySnapshot } from '../panel-targets/presentation'
import { theme } from '../settings/state'
import { canvasPaintRevision } from '../../canvas/theme-refresh'
import { loadMapLibreTerrainSupport } from '../../maplibre/terrain-loader'
import { createRasterDisplay } from '../../maplibre/raster-display/adapter'
import { resolveMapLibreSurfaceDiagnostics } from '../../maplibre/canvas-surface-camera'
import { captureWorkspaceMapContributions, type WorkspaceMapContributionAdapter } from './workspace-map-contribution-adapter'

export function createDesktopWorkspaceMapContributionAdapter(): WorkspaceMapContributionAdapter {
  return {
    loadTerrainSupport: loadMapLibreTerrainSupport,
    createRasterDisplay: (map, options) => createRasterDisplay(map, options),
    publishViewBounds: publishLidarMapViewBounds,
    read(runtime) {
      const sessionIdentity = designSessionStore.sessionIdentity.value
      if (!designSessionStore.hasCurrentDesign()) return null
      const plane = runtime.sessionPlane.value
      if (!plane) return null
      void runtime.revision.scene.value
      // Coarse view signals only: the contributions re-read when the camera settles or the mode changes, never on a camera frame
      // alone (INV-ENT-22).
      void runtime.view.settledCamera.value
      const overview = runtime.view.mode.value === 'overview'
      const panelTargets = readPanelTargetOverlaySnapshot()
      const anchor = { lat: plane.origin.lat, lon: plane.origin.lon }
      return captureWorkspaceMapContributions({
        sessionIdentity,
        lidar: lidarDisplayLayers(
          readCurrentLidarPresentation().map((item) => ({ ...item, visible: presentedSiteDataVisible(item.id, item.visible) })),
          lidarDisplayDescriptors.value,
        ),
        terrain: { ...mapTerrainStateOf(presentedMapLayers()), isDark: theme.value === 'dark' },
        overlays: {
          runtime,
          location: anchor,
          hoveredTargets: overview ? [] : panelTargets.hoveredTargets,
          selectedTargets: overview ? [] : panelTargets.selectedTargets,
          paintRevision: canvasPaintRevision.value,
        },
        frame: resolveMapLibreSurfaceDiagnostics(runtime),
      })
    },
  }
}
