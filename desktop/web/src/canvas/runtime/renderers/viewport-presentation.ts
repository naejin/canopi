import { getCanvasPlantNameLabels } from '../automatic-detail'
import type { ScenePoint, SceneViewportState } from '../scene'
import { computePinnedPlantNameLabels, computeSelectionLabels, type PlantNameLabel } from '../selection-labels'
import type { SceneRendererSnapshot } from './scene-types'

type PlantLabelInput = Pick<SceneRendererSnapshot,
  'scene' | 'viewport' | 'speciesCache' | 'localizedCommonNames' | 'selectionLabelPlantIds'>

export function projectScenePlantLabels(input: PlantLabelInput): Pick<SceneRendererSnapshot,
  'pinnedPlantNameLabels' | 'selectionLabels'> {
  const { scene, viewport, speciesCache, localizedCommonNames, selectionLabelPlantIds } = input
  const plantContext = { plants: scene.plants, viewport, speciesCache, localizedCommonNames }
  return {
    pinnedPlantNameLabels: computePinnedPlantNameLabels(scene.plants, viewport, localizedCommonNames,
      { plantContext, selectionLabelPlantIds }),
    selectionLabels: computeSelectionLabels(scene.plants, selectionLabelPlantIds, viewport,
      localizedCommonNames, { plantContext }),
  }
}

interface ViewportPresentation {
  readonly snapshot: SceneRendererSnapshot
  readonly plantNameLabels: readonly PlantNameLabel[]
}

/** Retains renderer projection only; CameraController remains viewport authority. */
export class SceneViewportPresentation {
  private retained: ViewportPresentation | null = null

  get current(): ViewportPresentation | null { return this.retained }

  setScene(snapshot: SceneRendererSnapshot): ViewportPresentation {
    return this.retained = { snapshot, plantNameLabels: getCanvasPlantNameLabels(snapshot) }
  }

  setViewport(viewport: SceneViewportState): ViewportPresentation | null {
    if (!this.retained) return null
    const { snapshot, plantNameLabels } = this.retained
    const previous = snapshot.viewport
    if (previous.scale === viewport.scale) {
      // Pan cannot change collision admission, label text, or screen-space offsets.
      const translate = <T extends { screenPoint: ScenePoint }>(label: T): T => ({
        ...label,
        screenPoint: {
          x: label.screenPoint.x + viewport.x - previous.x,
          y: label.screenPoint.y + viewport.y - previous.y,
        },
      })
      return this.retained = {
        snapshot: { ...snapshot, viewport,
          pinnedPlantNameLabels: snapshot.pinnedPlantNameLabels.map(translate),
          selectionLabels: snapshot.selectionLabels.map(translate) },
        plantNameLabels: plantNameLabels.map(translate),
      }
    }
    const next = { ...snapshot, viewport }
    return this.setScene({ ...next, ...projectScenePlantLabels(next) })
  }

  dispose(): void { this.retained = null }
}
