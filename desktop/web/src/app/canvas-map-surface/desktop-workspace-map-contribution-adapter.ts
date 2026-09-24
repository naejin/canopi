import { designSessionStore } from '../document-session/store'
import { readCanvasMapLayerPresentation } from '../canvas-layer-presentation/presentation'
import { lidarLibrary, readCurrentLidarPresentation } from '../lidar/library-store'
import { lidarDisplayDescriptors, lidarDisplayLayers } from '../lidar/display'
import { publishLidarMapViewBounds } from '../lidar/camera-request'
import { readPanelTargetOverlaySnapshot } from '../panel-targets/presentation'
import { theme } from '../settings/state'
import { loadMapLibreTerrainSupport } from '../../maplibre/terrain-loader'
import { createRasterDisplay } from '../../maplibre/raster-display/adapter'
import { resolveMapLibreSurfaceFrame } from '../../maplibre/canvas-surface-camera'
import { captureWorkspaceMapContributions, type WorkspaceMapContributionAdapter } from './workspace-map-contribution-adapter'

export function createDesktopWorkspaceMapContributionAdapter(): WorkspaceMapContributionAdapter {
  return {
    loadTerrainSupport: loadMapLibreTerrainSupport,
    createRasterDisplay: (map, options) => createRasterDisplay(map, options),
    publishViewBounds: publishLidarMapViewBounds,
    read(runtime) {
      const sessionIdentity = designSessionStore.sessionIdentity.value
      if (!designSessionStore.hasCurrentDesign()) return null
      const spatial = designSessionStore.readMetadata().spatialFrame
      if (!spatial) throw new Error('Current Design is missing its required spatial frame.')
      void runtime.revision.scene.value
      const overview = runtime.viewport.value.mode === 'overview'
      const panelTargets = readPanelTargetOverlaySnapshot()
      const anchor = { lat: spatial.anchor_latitude_deg, lon: spatial.anchor_longitude_deg }
      return captureWorkspaceMapContributions({
        sessionIdentity,
        lidar: lidarDisplayLayers(
          readCurrentLidarPresentation(),
          lidarDisplayDescriptors.value,
          (item) => lidarLibrary.value?.layers.find((layer) => layer.id === item.id)?.units ?? '',
        ),
        terrain: { ...readCanvasMapLayerPresentation().terrain, isDark: theme.value === 'dark' },
        overlays: {
          runtime,
          location: spatial.placement_status === 'confirmed' ? anchor : null,
          northBearingDeg: spatial.north_bearing_deg,
          hoveredTargets: overview ? [] : panelTargets.hoveredTargets,
          selectedTargets: overview ? [] : panelTargets.selectedTargets,
        },
        frame: resolveMapLibreSurfaceFrame(runtime, anchor, spatial.north_bearing_deg),
        designExtentMeters: runtime.getScenePhysicalExtentMeters(),
      })
    },
  }
}
