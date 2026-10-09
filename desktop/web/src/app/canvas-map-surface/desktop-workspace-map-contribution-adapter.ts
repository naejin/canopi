import { designSessionStore } from '../document-session/store'
import { mapTerrainStateOf } from '../map-layers/state'
import { presentedMapLayers, storyPresentationOverrides } from '../story-presentation/overrides'
import { readCurrentLidarPresentation } from '../lidar/library-store'
import { lidarDisplayDescriptors, lidarDisplayLayers } from '../lidar/display'
import { pin, profileLine } from '../lidar/site-transients'
import { profileHover } from '../lidar/profile'
import type { SiteMapOverlay } from '../../maplibre/site-overlay'
import { theme } from '../settings/state'
import { loadMapLibreTerrainSupport } from '../../maplibre/terrain-loader'
import { createRasterDisplay } from '../../maplibre/raster-display/adapter'
import { readWorkspaceMapContributions, type WorkspaceMapContributionAdapter } from './workspace-map-contribution-adapter'

export function createDesktopWorkspaceMapContributionAdapter(): WorkspaceMapContributionAdapter {
  return {
    loadTerrainSupport: loadMapLibreTerrainSupport,
    createRasterDisplay: (map, options) => createRasterDisplay(map, options),
    readSiteHover,
    read: (runtime) => readWorkspaceMapContributions(runtime, designSessionStore, () => ({
      lidar: lidarDisplayLayers(
        readCurrentLidarPresentation(),
        lidarDisplayDescriptors.value,
        storyPresentationOverrides.value?.siteDataIds ?? null,
      ),
      terrain: { ...mapTerrainStateOf(presentedMapLayers()), isDark: theme.value === 'dark' },
      site: readSiteMapOverlay(),
    })),
  }
}

/** The profile chart's hover point in [lon, lat], or null; the UI gallery, which stands in for Desktop, reads it too. */
export function readSiteHover(): readonly [number, number] | null {
  const hover = profileHover.value
  return hover ? [hover.lon, hover.lat] : null
}

/** The Site data pin and profile line in [lon, lat], or null with neither; the UI gallery reads it too. */
export function readSiteMapOverlay(): SiteMapOverlay | null {
  const point = pin.value
  const line = profileLine.value
  if (!point && !line) return null
  return {
    pin: point ? [point.lon, point.lat] : null,
    profileLine: line ? line.map((vertex) => [vertex.lon, vertex.lat] as const) : null,
  }
}
