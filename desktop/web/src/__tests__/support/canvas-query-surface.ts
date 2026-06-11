import { signal } from '@preact/signals'
import {
  createDefaultScenePersistedState,
  type ScenePersistedState,
  type SceneViewportState,
} from '../../canvas/runtime/scene'
import type {
  CanvasQuerySurface,
} from '../../canvas/runtime/runtime'
import type { PlacedPlant } from '../../types/design'

interface TestCanvasQuerySurfaceOptions {
  readonly scene?: ScenePersistedState
  readonly viewport?: SceneViewportState
  readonly plants?: readonly PlacedPlant[]
  readonly localizedNames?: ReadonlyMap<string, string | null>
}

export type TestCanvasQuerySurface = CanvasQuerySurface & {
  bumpSceneRevision(): void
  bumpPlantNamesRevision(): void
  bumpViewportRevision(): void
  setPlants(plants: readonly PlacedPlant[]): void
  setLocalizedNames(names: ReadonlyMap<string, string | null>): void
}

export function createTestCanvasQuerySurface({
  scene = createDefaultScenePersistedState(),
  viewport = { x: 0, y: 0, scale: 1 },
  plants = [],
  localizedNames = new Map(),
}: TestCanvasQuerySurfaceOptions = {}): TestCanvasQuerySurface {
  const sceneRevision = signal(0)
  const plantNamesRevision = signal(0)
  const viewportRevision = signal(0)
  const revision = {
    scene: sceneRevision,
    plantNames: plantNamesRevision,
    viewport: viewportRevision,
  }
  let currentPlants = [...plants]
  let currentLocalizedNames = localizedNames

  return {
    revision,
    viewportRevision,
    getSceneSnapshot: () => scene,
    getViewport: () => viewport,
    getViewportScreenSize: () => ({ width: 400, height: 300 }),
    getSelection: () => new Set(),
    getDesignObjectSelection: () => ({
      editableTargets: [],
      lockedTargets: [],
      blockedTargets: [],
      bounds: null,
      sameSpeciesReferenceCanonicalName: null,
    }),
    getPlantSizeMode: () => 'default',
    getPlantColorByAttr: () => null,
    getSelectedPlantColorContext: () => ({
      plantIds: [],
      singleSpeciesCanonicalName: null,
      singleSpeciesCommonName: null,
      sharedCurrentColor: null,
      suggestedColor: null,
      singleSpeciesDefaultColor: null,
    }),
    getPlacedPlants: () => [...currentPlants],
    getLocalizedCommonNames: () => currentLocalizedNames,
    bumpSceneRevision: () => {
      sceneRevision.value += 1
    },
    bumpPlantNamesRevision: () => {
      plantNamesRevision.value += 1
    },
    bumpViewportRevision: () => {
      viewportRevision.value += 1
    },
    setPlants: (nextPlants) => {
      currentPlants = [...nextPlants]
    },
    setLocalizedNames: (names) => {
      currentLocalizedNames = names
    },
  }
}
