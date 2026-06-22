import type { CameraController } from '../camera'
import type { ScenePoint, SceneStore } from '../scene'
import type { SceneEditCoordinator } from '../scene-runtime/transactions'
import { createMeasurementGuideDraftMeasurements } from '../measurement-guides'
import { hideInteractionPreview, showInteractionPreview } from './overlay-ui'
import { createZoneMeasurementOverlay } from './zone-measurement-overlay'
import { isSceneLayerOpenForCreation } from './layer-guards'
import type { SceneToolAdapter } from './tool-adapter'
import { appendMeasurementGuideToDraft } from './tool-actions'

interface ActiveMeasurementGuideDraft {
  readonly startWorld: ScenePoint
  readonly startScreen: ScenePoint
}

export interface MeasurementGuideToolContext {
  readonly container: HTMLElement
  readonly preview: HTMLDivElement
  readonly camera: CameraController
  readonly getSceneStore: () => SceneStore
  readonly sceneEdits: SceneEditCoordinator
  readonly applySnapping: (point: ScenePoint) => ScenePoint
}

export interface MeasurementGuideTool {
  readonly beginDrag: (world: ScenePoint) => void
  readonly updateDrag: (rawWorld: ScenePoint) => void
  readonly commitDrag: (rawWorld: ScenePoint) => void
  readonly cancelTransient: () => void
  readonly dispose: () => void
}

export function createMeasurementGuideTool(
  context: MeasurementGuideToolContext,
): MeasurementGuideTool {
  const measurements = createZoneMeasurementOverlay(context.container)
  let activeDraft: ActiveMeasurementGuideDraft | null = null

  function beginDrag(world: ScenePoint): void {
    if (!isMeasurementGuideLayerOpen()) return
    const snappedWorld = context.applySnapping(world)
    const snappedScreen = context.camera.worldToScreen(snappedWorld)
    activeDraft = {
      startWorld: snappedWorld,
      startScreen: snappedScreen,
    }
    showInteractionPreview(context.preview, 'line', snappedScreen, snappedScreen)
  }

  function updateDrag(rawWorld: ScenePoint): void {
    if (!activeDraft) return
    const endWorld = context.applySnapping(rawWorld)
    showInteractionPreview(
      context.preview,
      'line',
      activeDraft.startScreen,
      context.camera.worldToScreen(endWorld),
    )
    measurements.update(
      createMeasurementGuideDraftMeasurements(activeDraft.startWorld, endWorld),
      context.camera,
    )
  }

  function commitDrag(rawWorld: ScenePoint): void {
    if (!activeDraft) return
    const draft = activeDraft
    activeDraft = null
    measurements.hide()
    hideInteractionPreview(context.preview)
    if (!isMeasurementGuideLayerOpen()) return

    const endWorld = context.applySnapping(rawWorld)
    context.sceneEdits.run('interaction-measurement-guide', (tx) => {
      tx.mutate((sceneDraft) => {
        appendMeasurementGuideToDraft(sceneDraft, draft.startWorld, endWorld)
      })
    })
  }

  function cancelTransient(): void {
    activeDraft = null
    measurements.hide()
    hideInteractionPreview(context.preview)
  }

  function isMeasurementGuideLayerOpen(): boolean {
    return isSceneLayerOpenForCreation(context.getSceneStore().persisted, 'measurement-guides')
  }

  return {
    beginDrag,
    updateDrag,
    commitDrag,
    cancelTransient,
    dispose: measurements.dispose,
  }
}

export function createMeasurementGuideToolAdapter(
  tool: MeasurementGuideTool,
): SceneToolAdapter {
  return {
    onDeactivate: () => tool.cancelTransient(),
    pointerDown({ event, rawWorld, beginDrag }) {
      event.preventDefault()
      tool.beginDrag(rawWorld)
      beginDrag({
        update: ({ rawWorld }) => tool.updateDrag(rawWorld),
        commit: ({ rawWorld }) => tool.commitDrag(rawWorld),
      })
      return true
    },
    cancelTransient: () => tool.cancelTransient(),
    dispose: tool.dispose,
  }
}
