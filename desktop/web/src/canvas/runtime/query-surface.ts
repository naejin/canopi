import type { PlacedPlant } from '../../types/design'
import type { SelectedPlantColorContext } from '../plant-color-context'
import type { SelectedPlantSymbolContext } from '../plant-symbol-context'
import type { CameraController } from './camera'
import type { CanvasDesignObjectSelectionModel, CanvasQueryRevision, CanvasQuerySurface } from './runtime'
import type { ScenePersistedState, SceneStore, SceneViewportState } from './scene'
import type { SceneRuntimeMutationController } from './scene-runtime/mutations'
import type { SceneRuntimePresentationController } from './scene-runtime/presentation'
import { getDesignObjectSelectionModel } from './scene-runtime/selection'

interface SceneCanvasQuerySurfaceOptions {
  readonly revision: CanvasQueryRevision
  readonly sceneStore: Pick<SceneStore, 'persisted' | 'session' | 'toCanopiFile'>
  readonly camera: Pick<CameraController, 'viewport' | 'screenSize'>
  readonly viewportRevision: CanvasQueryRevision['viewport']
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
  get viewportRevision(): CanvasQueryRevision['viewport'] { return this.options.viewportRevision }
  getSceneSnapshot(): ScenePersistedState { return this.options.sceneStore.persisted }
  getViewport(): SceneViewportState { return this.options.camera.viewport }
  getViewportScreenSize(): { width: number; height: number } { return this.options.camera.screenSize }
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
  getLocalizedCommonNames(): ReadonlyMap<string, string | null> {
    return this.options.presentation.getLocalizedCommonNames()
  }
}
