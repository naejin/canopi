import { designSessionStore, type DesignSessionStore } from '../app/document-session/store'
import {
  readWorkspaceMapContributions,
  type WorkspaceMapContributionAdapter,
} from '../app/canvas-map-surface/workspace-map-contribution-adapter'

/** The Web Edition holds no local data: no LiDAR layers, no terrain and no Site data pin or line. */
const WEB_CONTRIBUTIONS = Object.freeze({
  site: null,
  lidar: [],
  terrain: {
    contoursVisible: false, contoursOpacity: 0, contourIntervalMeters: 1,
    hillshadeVisible: false, hillshadeOpacity: 0, isDark: false,
  },
})

export function createBrowserWorkspaceMapContributionAdapter(
  store: Pick<DesignSessionStore, 'sessionIdentity' | 'hasCurrentDesign'> = designSessionStore,
): WorkspaceMapContributionAdapter {
  return {
    read: (runtime) => readWorkspaceMapContributions(runtime, store, () => WEB_CONTRIBUTIONS),
  }
}
