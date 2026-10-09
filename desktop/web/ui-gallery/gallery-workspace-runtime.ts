import { signal } from '@preact/signals'
import { createAppCanvasRuntimeAppAdapter } from '../src/app/canvas-runtime/app-adapter'
import { createAppSceneRuntimePanelTargetAdapter } from '../src/app/canvas-runtime/panel-target-adapter'
import {
  readWorkspaceActivationSnapshot,
  readWorkspaceBackgroundPresentation,
} from '../src/app/canvas-map-surface/workspace-activation-snapshot'
import {
  createWorkspaceRuntimeComposition,
  type WorkspaceRuntimeComposition,
  type WorkspaceRuntimeMountOptions,
} from '../src/app/canvas-map-surface/workspace-runtime-composition'
import { mapLayers, type MapLayersState } from '../src/app/map-layers/state'
import {
  readWorkspaceMapContributions,
  type WorkspaceMapContributionAdapter,
} from '../src/app/canvas-map-surface/workspace-map-contribution-adapter'
import { installLidarDisplayDescriptors, lidarDisplayDescriptors, lidarDisplayLayers } from '../src/app/lidar/display'
import { installLidarLibraryObserver, readCurrentLidarPresentation } from '../src/app/lidar/library-store'
import { createRasterDisplay } from '../src/maplibre/raster-display/adapter'
import { savedObjectStampWorkbench } from '../src/app/saved-object-stamps'
import type { CanopiFile } from '../src/types/design'
import { createBrowserWorkspaceMapContributionAdapter } from '../src/web/browser-workspace-map-contribution-adapter'
import { DESKTOP_SITE_DATA_CAPABILITIES } from '../src/app/canvas-runtime/desktop-adapter'
import { readSiteHover, readSiteMapOverlay } from '../src/app/canvas-map-surface/desktop-workspace-map-contribution-adapter'
import { frenchNames, species } from './fixtures'

export interface GalleryWorkspaceRuntimeOptions extends WorkspaceRuntimeMountOptions {
  readonly design: CanopiFile
}

/**
 * The production shared workspace (MapLibre and its Pixi scene layer) with memory
 * presentation data. The gallery must run offline and render the same pixels
 * on every load, so the background band stays hidden and the map shows only
 * its local empty style; terrain is off and LiDAR is empty, except in
 * `state=lidar-raster`, where Desktop's raster renderer draws the Design's
 * Site data from the Rust engine's display COG (architecture review finding 15).
 */
export function createGalleryWorkspaceRuntimeComposition(
  options: GalleryWorkspaceRuntimeOptions,
): WorkspaceRuntimeComposition {
  const { design, ...mount } = options
  // Each gallery canvas owns its Design generation; the map never waits on the
  // app's Design Session store.
  const store = { sessionIdentity: signal<object>(Object.freeze({})), hasCurrentDesign: () => true }
  const params = new URLSearchParams(location.search)
  const edition: GalleryEdition = params.get('edition') === 'web' ? 'web' : 'desktop'
  return createWorkspaceRuntimeComposition({
    ...mount,
    appAdapter: createGalleryCanvasRuntimeAppAdapter(design, edition),
    targetPresentation: createAppSceneRuntimePanelTargetAdapter(),
    mapContributions: createGalleryMapContributionAdapter(store, { state: params.get('state'), edition }),
    readSnapshot: (readInitialCenter) => readWorkspaceActivationSnapshot({
      store,
      readInitialCenter,
      readMapLayers: readOfflineMapLayers,
    }),
    readBackgroundPresentation: () => readWorkspaceBackgroundPresentation({ readMapLayers: readOfflineMapLayers }),
  })
}

/** `edition=web` mounts the browser-safe registrations; otherwise the gallery stands in for Desktop. */
type GalleryEdition = 'desktop' | 'web'

/**
 * The gallery map's contributions. Web's hold no local data. As Desktop the map draws Desktop's Site data pin, profile
 * line and chart hover ring; in `state=lidar-raster` it also draws Desktop's raster seam over the memory backend: the
 * Design's Site data as the app joins it, the descriptors the backend serves (one Ready display COG) and the upstream
 * renderer, so a display change (Reverse, a range) repaints real pixels.
 */
export function createGalleryMapContributionAdapter(
  store: Parameters<typeof readWorkspaceMapContributions>[1],
  { state, edition }: { readonly state: string | null, readonly edition: GalleryEdition },
): WorkspaceMapContributionAdapter {
  if (edition === 'web') return createBrowserWorkspaceMapContributionAdapter(store)
  if (state !== 'lidar-raster') {
    return {
      readSiteHover,
      read: (runtime) => readWorkspaceMapContributions(runtime, store, () => ({
        lidar: [],
        terrain: OFFLINE_TERRAIN,
        site: readSiteMapOverlay(),
      })),
    }
  }
  installLidarLibraryObserver()
  installLidarDisplayDescriptors()
  return {
    createRasterDisplay: (map, options) => createRasterDisplay(map, options),
    readSiteHover,
    read: (runtime) => readWorkspaceMapContributions(runtime, store, () => ({
      // The memory backend's asset paths are already URLs the gallery server serves by range.
      lidar: lidarDisplayLayers(readCurrentLidarPresentation(), lidarDisplayDescriptors.value, null, (path) => path),
      terrain: OFFLINE_TERRAIN,
      site: readSiteMapOverlay(),
    })),
  }
}

const OFFLINE_TERRAIN = Object.freeze({
  contoursVisible: false, contoursOpacity: 0, contourIntervalMeters: 1,
  hillshadeVisible: false, hillshadeOpacity: 0, isDark: false,
})

function readOfflineMapLayers(): MapLayersState {
  const layers = mapLayers.value
  return {
    ...layers,
    basemap: { ...layers.basemap, visible: false },
    satellite: { ...layers.satellite, visible: false },
  }
}

/** The gallery canvas's app adapter over the fixture Design; as Desktop it hands taps and Profile lines to Site data. */
export function createGalleryCanvasRuntimeAppAdapter(design: CanopiFile, edition: GalleryEdition) {
  const names = new Map(design.plants.map(plant => [plant.canonical_name, plant.common_name]))
  // The catalog has names in English, and in French for a few species; every other species shows its English name, marked.
  const localized = (locale: string) => locale === 'en' ? names : new Map(locale === 'fr' ? Object.entries(frenchNames) : [])
  const englishFallbacks = (locale: string) => new Map([...names].filter((entry): entry is [string, string] => entry[1] !== null && !localized(locale).has(entry[0])))
  return createAppCanvasRuntimeAppAdapter({
    presentationData: {
      plantLabels: { getLocaleSnapshot: localized, getEnglishFallbackSnapshot: englishFallbacks, ensureEntries: async () => false },
      speciesCache: {
        getCache: () => new Map(species.map(plant => [plant.canonical_name, { ...plant }])),
        ensureEntries: async () => false,
        getSuggestedPlantColor: () => '#E9D28B',
      },
    },
    savedObjectStamps: {
      saveCurrentSelection: capture => savedObjectStampWorkbench.saveSelection(capture),
    },
    ...(edition === 'desktop' ? DESKTOP_SITE_DATA_CAPABILITIES : {}),
  })
}
