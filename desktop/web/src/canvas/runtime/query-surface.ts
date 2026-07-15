import type { PlacedPlant } from '../../types/design'
import type { SelectedPlantColorContext } from '../plant-color-context'
import type { SelectedPlantSymbolContext } from '../plant-symbol-context'
import type { CameraController } from './camera'
import type { CanvasDesignObjectSelectionModel, CanvasQueryRevision, CanvasQuerySurface } from './runtime'
import type {
  SceneDocumentReader,
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
  readonly camera: Pick<CameraController, 'viewport' | 'snapshot'>
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
  get viewport(): CameraController['snapshot'] { return this.options.camera.snapshot }
  getSceneSnapshot(): ScenePersistedState { return this.options.sceneStore.persisted }
  getSelection(): Set<string> { return new Set(this.options.sceneStore.session.selectedEntityIds) }
  getDesignObjectSelection(): CanvasDesignObjectSelectionModel {
    const viewportScale = this.options.camera.viewport.scale
    return getDesignObjectSelectionModel(
      this.options.sceneStore.persisted,
      this.options.sceneStore.session.selectedEntityIds,
      {
        annotationViewportScale: viewportScale,
        plantContext: this.options.presentation.createPlantPresentationContext(viewportScale),
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
  getLocalizedCommonNames(): ReadonlyMap<string, string | null> {
    return this.options.presentation.getLocalizedCommonNames()
  }
}
