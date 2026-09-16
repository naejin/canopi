import { designSessionStore } from '../document-session/store'
import { readCanvasMapLayerPresentation } from '../canvas-layer-presentation/presentation'
import { readCurrentLidarPresentation } from '../lidar/library-store'
import { publishLidarMapViewBounds } from '../lidar/camera-request'
import { readPanelTargetOverlaySnapshot } from '../panel-targets/presentation'
import { theme } from '../settings/state'
import { loadMapLibreTerrainSupport } from '../../maplibre/terrain-loader'
import { resolveMapLibreSurfaceFrame } from '../../maplibre/canvas-surface-camera'
import { lidarMapLayers } from './lidar'
import { captureWorkspaceMapContributions, type WorkspaceMapContributionAdapter } from './workspace-map-contribution-adapter'

export function createDesktopWorkspaceMapContributionAdapter(): WorkspaceMapContributionAdapter {
  return {
    loadTerrainSupport: loadMapLibreTerrainSupport,
    publishViewBounds: publishLidarMapViewBounds,
    read(runtime) {
      const sessionIdentity = designSessionStore.sessionIdentity.value
      if (!designSessionStore.hasCurrentDesign()) return null
      const spatial = designSessionStore.readMetadata().spatialFrame
      if (!spatial) throw new Error('Current Design is missing its required spatial frame.')
      void runtime.revision.scene.value
      const anchor = { lat: spatial.anchor_latitude_deg, lon: spatial.anchor_longitude_deg }
      return captureWorkspaceMapContributions({
        sessionIdentity,
        lidar: lidarMapLayers(readCurrentLidarPresentation()),
        terrain: { ...readCanvasMapLayerPresentation().terrain, isDark: theme.value === 'dark' },
        overlays: {
          runtime,
          location: spatial.placement_status === 'confirmed' ? anchor : null,
          northBearingDeg: spatial.north_bearing_deg,
          ...readPanelTargetOverlaySnapshot(),
        },
        frame: resolveMapLibreSurfaceFrame(runtime, anchor, spatial.north_bearing_deg),
        designExtentMeters: runtime.getScenePhysicalExtentMeters(),
      })
    },
  }
}
