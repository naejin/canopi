import { designSessionStore } from '../document-session/store'
import { mapTerrainStateOf } from '../map-layers/state'
import { presentedMapLayers, presentedSiteDataVisible } from '../story-presentation/overrides'
import { readCurrentLidarPresentation } from '../lidar/library-store'
import { lidarDisplayDescriptors, lidarDisplayLayers } from '../lidar/display'
import { publishLidarMapViewBounds } from '../lidar/camera-request'
import { theme } from '../settings/state'
import { loadMapLibreTerrainSupport } from '../../maplibre/terrain-loader'
import { createRasterDisplay } from '../../maplibre/raster-display/adapter'
import { readWorkspaceMapContributions, type WorkspaceMapContributionAdapter } from './workspace-map-contribution-adapter'

export function createDesktopWorkspaceMapContributionAdapter(): WorkspaceMapContributionAdapter {
  return {
    loadTerrainSupport: loadMapLibreTerrainSupport,
    createRasterDisplay: (map, options) => createRasterDisplay(map, options),
    publishViewBounds: publishLidarMapViewBounds,
    read: (runtime) => readWorkspaceMapContributions(runtime, designSessionStore, () => ({
      lidar: lidarDisplayLayers(
        readCurrentLidarPresentation().map((item) => ({ ...item, visible: presentedSiteDataVisible(item.id, item.visible) })),
        lidarDisplayDescriptors.value,
      ),
      terrain: { ...mapTerrainStateOf(presentedMapLayers()), isDark: theme.value === 'dark' },
    })),
  }
}
