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
import { savedObjectStampWorkbench } from '../src/app/saved-object-stamps'
import type { CanopiFile } from '../src/types/design'
import { createBrowserWorkspaceMapContributionAdapter } from '../src/web/browser-workspace-map-contribution-adapter'
import { species } from './fixtures'

export interface GalleryWorkspaceRuntimeOptions extends WorkspaceRuntimeMountOptions {
  readonly design: CanopiFile
}

/**
 * The production shared workspace (MapLibre + maplibre-pixi) with memory
 * presentation data. The gallery must run offline and render the same pixels
 * on every load, so the background band stays hidden and the map shows only
 * its local empty style; LiDAR and terrain contributions are empty.
 */
export function createGalleryWorkspaceRuntimeComposition(
  options: GalleryWorkspaceRuntimeOptions,
): WorkspaceRuntimeComposition {
  const { design, ...mount } = options
  // Each gallery canvas owns its Design generation; the map never waits on the
  // app's Design Session store.
  const store = { sessionIdentity: signal<object>(Object.freeze({})), hasCurrentDesign: () => true }
  return createWorkspaceRuntimeComposition({
    ...mount,
    appAdapter: createGalleryCanvasRuntimeAppAdapter(design),
    targetPresentation: createAppSceneRuntimePanelTargetAdapter(),
    mapContributions: createBrowserWorkspaceMapContributionAdapter(store),
    readSnapshot: (readInitialCenter) => readWorkspaceActivationSnapshot({
      store,
      readInitialCenter,
      readMapLayers: readOfflineMapLayers,
    }),
    readBackgroundPresentation: () => readWorkspaceBackgroundPresentation({ readMapLayers: readOfflineMapLayers }),
  })
}

function readOfflineMapLayers(): MapLayersState {
  const layers = mapLayers.value
  return {
    ...layers,
    basemap: { ...layers.basemap, visible: false },
    satellite: { ...layers.satellite, visible: false },
  }
}

function createGalleryCanvasRuntimeAppAdapter(design: CanopiFile) {
  const names = new Map(design.plants.map(plant => [plant.canonical_name, plant.common_name]))
  return createAppCanvasRuntimeAppAdapter({
    presentationData: {
      plantLabels: { getLocaleSnapshot: () => names, ensureEntries: async () => false },
      speciesCache: {
        getCache: () => new Map(species.map(plant => [plant.canonical_name, { ...plant }])),
        ensureEntries: async () => false,
        getSuggestedPlantColor: () => '#E9D28B',
      },
    },
    savedObjectStamps: {
      saveCurrentSelection: capture => savedObjectStampWorkbench.saveSelection(capture),
    },
  })
}
