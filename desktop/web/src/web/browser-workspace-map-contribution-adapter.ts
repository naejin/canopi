import { designSessionStore, type DesignSessionStore } from '../app/document-session/store'
import { readPanelTargetOverlaySnapshot } from '../app/panel-targets/presentation'
import { resolveMapLibreSurfaceDiagnostics } from '../maplibre/canvas-surface-camera'
import { canvasPaintRevision } from '../canvas/theme-refresh'
import { captureWorkspaceMapContributions, type WorkspaceMapContributionAdapter } from '../app/canvas-map-surface/workspace-map-contribution-adapter'

export function createBrowserWorkspaceMapContributionAdapter(
  store: Pick<DesignSessionStore, 'sessionIdentity' | 'hasCurrentDesign'> = designSessionStore,
): WorkspaceMapContributionAdapter {
  return {
    read(runtime) {
      const sessionIdentity = store.sessionIdentity.value
      if (!store.hasCurrentDesign()) return null
      const plane = runtime.sessionPlane.value
      if (!plane) return null
      void runtime.revision.scene.value
      // Coarse view signals only: a camera frame alone never re-reads the contributions (INV-ENT-22).
      const overview = runtime.view.mode.value === 'overview'
      const panelTargets = readPanelTargetOverlaySnapshot()
      const anchor = { lat: plane.origin.lat, lon: plane.origin.lon }
      return captureWorkspaceMapContributions({
        sessionIdentity,
        lidar: [],
        terrain: {
          contoursVisible: false, contoursOpacity: 0, contourIntervalMeters: 1,
          hillshadeVisible: false, hillshadeOpacity: 0, isDark: false,
        },
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
