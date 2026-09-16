import { designSessionStore, type DesignSessionStore } from '../app/document-session/store'
import { readPanelTargetOverlaySnapshot } from '../app/panel-targets/presentation'
import { resolveMapLibreSurfaceFrame } from '../maplibre/canvas-surface-camera'
import { captureWorkspaceMapContributions, type WorkspaceMapContributionAdapter } from '../app/canvas-map-surface/workspace-map-contribution-adapter'

export function createBrowserWorkspaceMapContributionAdapter(
  store: Pick<DesignSessionStore, 'sessionIdentity' | 'hasCurrentDesign' | 'readMetadata'> = designSessionStore,
): WorkspaceMapContributionAdapter {
  return {
    read(runtime) {
      const sessionIdentity = store.sessionIdentity.value
      if (!store.hasCurrentDesign()) return null
      const spatial = store.readMetadata().spatialFrame
      if (!spatial) throw new Error('Current Design is missing its required spatial frame.')
      void runtime.revision.scene.value
      const overview = runtime.viewport.value.mode === 'overview'
      const panelTargets = readPanelTargetOverlaySnapshot()
      const anchor = { lat: spatial.anchor_latitude_deg, lon: spatial.anchor_longitude_deg }
      return captureWorkspaceMapContributions({
        sessionIdentity,
        lidar: [],
        terrain: {
          contoursVisible: false, contoursOpacity: 0, contourIntervalMeters: 1,
          hillshadeVisible: false, hillshadeOpacity: 0, isDark: false,
        },
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
