import { buildCanvasPrintSnapshot } from './print-snapshot'
import type { PlacedPlant } from '../../types/design'
import type { SelectedPlantColorContext } from '../plant-color-context'
import type { SelectedPlantSymbolContext } from '../plant-symbol-context'
import type { WorkspaceCameraFrameReader } from './camera'
import type {
  CanvasDesignObjects,
  CanvasDesignObjectSelectionModel,
  CanvasQueryRevision,
  CanvasQuerySurface,
} from './runtime'
import type {
  SceneDocumentReader,
  SceneDesignObjectTarget,
  ScenePersistedState,
  SceneStateReader,
} from './scene'
import type { SceneRuntimeMutationController } from './scene-runtime/mutations'
import type { SceneRuntimePresentationController } from './scene-runtime/presentation'
import { getDesignObjectSelectionModel } from './scene-runtime/selection'
import type { SettledSceneReader } from './scene-runtime/transactions'

interface SceneCanvasQuerySurfaceOptions {
  readonly revision: CanvasQueryRevision
  readonly sceneStore: SceneStateReader & SceneDocumentReader
  readonly camera: Pick<WorkspaceCameraFrameReader, 'viewport' | 'snapshot'>
  readonly settledReader: SettledSceneReader
  readonly mutations: Pick<
    SceneRuntimeMutationController,
    'getSelectedPlantColorContext' | 'getSelectedPlantSymbolContext'
  >
  readonly presentation: Pick<
    SceneRuntimePresentationController,
    'createPlantPresentationContext' | 'getLocalizedCommonNames'
  >
}

export function createSceneCanvasQuerySurface(
  options: SceneCanvasQuerySurfaceOptions,
): CanvasQuerySurface {
  return new SceneCanvasQueryRole(options)
}

class SceneCanvasQueryRole implements CanvasQuerySurface {
  constructor(private readonly options: SceneCanvasQuerySurfaceOptions) {}

  get revision(): CanvasQueryRevision { return this.options.revision }
  get viewport(): WorkspaceCameraFrameReader['snapshot'] { return this.options.camera.snapshot }
  get sessionPlane() { return this.options.sceneStore.sessionPlaneSignal }
  capturePrintSnapshot() {
    void this.options.settledReader.revision.value
    return this.options.settledReader.readWhenSettled(() => {
      const scene = this.options.sceneStore.persisted
      return buildCanvasPrintSnapshot(
        scene,
        this.options.presentation.createPlantPresentationContext(1, scene.plants),
      )
    }, null)
  }
  getScenePhysicalExtentMeters(): number | null { return this.options.sceneStore.physicalExtentMeters }
  getSceneSnapshot(): ScenePersistedState { return this.options.sceneStore.persisted }
  getSpeciesFocus() { return this.options.sceneStore.session.speciesFocus }
  getSelection(): SceneDesignObjectTarget[] {
    return this.options.sceneStore.session.selectedTargets.map((target) => ({ ...target }))
  }
  getDesignObjectSelection(): CanvasDesignObjectSelectionModel {
    const selectedTargets = this.options.sceneStore.session.selectedTargets
    if (selectedTargets.length === 0) {
      return {
        editableTargets: [], lockedTargets: [], blockedTargets: [], bounds: null,
        sameSpeciesReferenceCanonicalName: null,
        plantNamePinning: { plantIds: [], allPinned: false },
      }
    }
    const viewportScale = this.options.camera.viewport.scale
    const scene = this.options.sceneStore.persisted
    return getDesignObjectSelectionModel(
      scene,
      selectedTargets,
      {
        annotationViewportScale: viewportScale,
        plantContext: this.options.presentation.createPlantPresentationContext(viewportScale, scene.plants),
      },
    )
  }
  getSelectedPlantColorContext(): SelectedPlantColorContext {
    return this.options.mutations.getSelectedPlantColorContext()
  }
  getSelectedPlantSymbolContext(): SelectedPlantSymbolContext {
    return this.options.mutations.getSelectedPlantSymbolContext()
  }
  getPlacedPlants(): PlacedPlant[] { return this.options.sceneStore.toCanopiFile().plants }
  getSettledPlacedPlants(): PlacedPlant[] | null {
    void this.options.settledReader.revision.value
    return this.options.settledReader.readWhenSettled(
      () => this.options.sceneStore.toCanopiFile().plants,
      null,
    )
  }
  getSettledDesignObjects(): CanvasDesignObjects | null {
    return this.options.settledReader.readWhenSettled(() => {
      const file = this.options.sceneStore.toCanopiFile()
      return {
        plants: file.plants,
        zones: file.zones,
        annotations: file.annotations,
        measurementGuides: file.measurement_guides ?? [],
        groups: file.groups,
      }
    }, null)
  }
  getLocalizedCommonNames(): ReadonlyMap<string, string | null> {
    return this.options.presentation.getLocalizedCommonNames()
  }
}
