import { signal } from '@preact/signals'
import type { CameraViewportSnapshot } from '../../canvas/runtime/camera'
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
  setSettled(settled: boolean): void
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
  const viewportSnapshot = signal<CameraViewportSnapshot>({
    viewport,
    screenSize: { width: 400, height: 300 },
    referenceScale: 1,
    revision: 0,
  })
  const admissionRevision = signal(0)
  const revision = {
    scene: sceneRevision,
    plantNames: plantNamesRevision,
  }
  let currentPlants = [...plants]
  let currentLocalizedNames = localizedNames
  let settled = true

  return {
    revision,
    viewport: viewportSnapshot,
    getSceneSnapshot: () => scene,
    getSelection: () => new Set(),
    getDesignObjectSelection: () => ({
      editableTargets: [],
      lockedTargets: [],
      blockedTargets: [],
      bounds: null,
      sameSpeciesReferenceCanonicalName: null,
      plantNamePinning: {
        plantIds: [],
        allPinned: false,
      },
    }),
    getSelectedPlantColorContext: () => ({
      plantIds: [],
      singleSpeciesCanonicalName: null,
      singleSpeciesCommonName: null,
      sharedCurrentColor: null,
      suggestedColor: null,
      singleSpeciesDefaultColor: null,
    }),
    getSelectedPlantSymbolContext: () => ({
      plantIds: [],
      singleSpeciesCanonicalName: null,
      singleSpeciesCommonName: null,
      sharedCurrentSymbol: null,
      sharedEffectiveSymbol: 'round',
      inheritedSymbol: null,
      singleSpeciesDefaultSymbol: null,
      canClearSelectedSymbol: false,
    }),
    getPlacedPlants: () => [...currentPlants],
    getSettledPlacedPlants: () => {
      void admissionRevision.value
      return settled ? [...currentPlants] : null
    },
    getLocalizedCommonNames: () => currentLocalizedNames,
    bumpSceneRevision: () => {
      sceneRevision.value += 1
    },
    bumpPlantNamesRevision: () => {
      plantNamesRevision.value += 1
    },
    setSettled: (nextSettled) => {
      if (settled === nextSettled) return
      settled = nextSettled
      admissionRevision.value += 1
    },
    setPlants: (nextPlants) => {
      currentPlants = [...nextPlants]
    },
    setLocalizedNames: (names) => {
      currentLocalizedNames = names
    },
  }
}
