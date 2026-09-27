import { effect } from '@preact/signals'
import { clearPlantStampSource, readPlantStampSource, type PlantStampSource } from '../../plant-stamp-source'
import type { CanvasRuntimeTranslator } from '../app-adapter'
import type { WorkspaceCameraFrameReader } from '../camera'
import type { PlantPresentationContext } from '../plant-presentation'
import { appendPlantStampSourceToDraft } from './tool-actions'
import type { ScenePoint, SceneStateReader } from '../scene'
import type { SceneEditCoordinator } from '../scene-runtime/transactions'
import type { SceneToolAdapter } from './tool-adapter'
import { isSceneLayerOpenForCreation } from './layer-guards'
import { createPlantPlacementPreview } from './plant-placement-preview'

export interface PlantStampToolContext {
  readonly container: HTMLElement
  readonly camera: WorkspaceCameraFrameReader
  readonly getSceneStore: () => SceneStateReader
  readonly getPlantPresentationContext: (viewportScale: number) => PlantPresentationContext
  readonly getLocalizedCommonNames: () => ReadonlyMap<string, string | null>
  readonly translate: CanvasRuntimeTranslator
  readonly sceneEdits: SceneEditCoordinator
  readonly applySnapping: (point: ScenePoint) => ScenePoint
  /** Runs a placement outside a map event once the Scene is settled. */
  readonly runWhenSettled: (operation: () => void) => void
  /** The tool card's guidance changed outside a map event. */
  readonly notifyGuidanceChange: () => void
}

export interface PlantStampTool {
  readonly pointerDown: (world: ScenePoint) => void
  /**
   * Place plants here: places the chosen species at `world`; with none chosen
   * yet, asks for one and places the pick there.
   */
  readonly placeAt: (world: ScenePoint) => void
  /** Preview the placement under the pointer; false when there is nothing to place. */
  readonly previewAt: (rawWorld: ScenePoint) => boolean
  readonly refreshPreview: () => void
  readonly hidePreview: () => void
  readonly hasSource: () => boolean
  /** A click found no species chosen, and none has been chosen since. */
  readonly promptsSpecies: () => boolean
  readonly clear: () => void
  readonly dispose: () => void
}

export function createPlantStampTool(context: PlantStampToolContext): PlantStampTool {
  const preview = createPlantPlacementPreview(context.container, context.translate)
  let speciesPrompted = false
  let previewWorld: ScenePoint | null = null
  /** Where Place plants here waits for a species to be chosen. */
  let pendingWorld: ScenePoint | null = null
  let disposed = false
  // The pick that answers Place plants here lands where the user right-clicked.
  const stopWatchingSource = effect(() => {
    const source = readPlantStampSource()
    if (!source || !pendingWorld) return
    const world = pendingWorld
    pendingWorld = null
    // Leave the picker's own update before editing the Scene.
    queueMicrotask(() => {
      if (disposed) return
      context.runWhenSettled(() => place(source, world))
      context.notifyGuidanceChange()
    })
  })

  function pointerDown(world: ScenePoint): void {
    pendingWorld = null
    const source = readPlantStampSource()
    speciesPrompted = source === null
    if (!source) return
    place(source, context.applySnapping(world))
  }

  function placeAt(world: ScenePoint): void {
    const source = readPlantStampSource()
    speciesPrompted = source === null
    if (!source) {
      pendingWorld = context.applySnapping(world)
      return
    }
    pendingWorld = null
    place(source, context.applySnapping(world))
  }

  function place(source: PlantStampSource, point: ScenePoint): void {
    speciesPrompted = false
    if (!isSceneLayerOpenForCreation(context.getSceneStore().persisted, 'plants')) return
    context.sceneEdits.run('interaction-stamp-plant', (tx) => {
      let placedPlantId = ''
      tx.mutate((draft) => {
        placedPlantId = appendPlantStampSourceToDraft(draft, source, point)
      })
      if (placedPlantId) tx.setSelection([{ kind: 'plant', id: placedPlantId }])
    }, { onCommitted: refreshPreview })
  }

  function previewAt(rawWorld: ScenePoint): boolean {
    previewWorld = context.applySnapping(rawWorld)
    return showPreview()
  }

  /** Read-only: draws from the settled scene and never opens a Scene Edit. */
  function showPreview(): boolean {
    const source = readPlantStampSource()
    const scene = context.getSceneStore().persisted
    if (!source || !previewWorld || !isSceneLayerOpenForCreation(scene, 'plants')) {
      preview.hide()
      return false
    }
    preview.show({
      source,
      world: previewWorld,
      scene,
      camera: context.camera,
      plantContext: context.getPlantPresentationContext(context.camera.viewport.scale),
      commonNames: context.getLocalizedCommonNames(),
    })
    return true
  }

  function refreshPreview(): void {
    if (previewWorld) showPreview()
  }

  function hidePreview(): void {
    previewWorld = null
    preview.hide()
  }

  function clear(): void {
    speciesPrompted = false
    pendingWorld = null
    hidePreview()
    clearPlantStampSource()
  }

  return {
    pointerDown,
    placeAt,
    previewAt,
    refreshPreview,
    hidePreview,
    hasSource: () => readPlantStampSource() !== null,
    promptsSpecies: () => speciesPrompted && readPlantStampSource() === null,
    clear,
    dispose() {
      disposed = true
      stopWatchingSource()
      clear()
      preview.dispose()
    },
  }
}

export function createPlantStampToolAdapter(tool: PlantStampTool): SceneToolAdapter {
  return {
    onDeactivate: tool.clear,
    describeGuidance: () => ({ promptSpecies: tool.promptsSpecies() }),
    shouldSuppressHover: tool.hasSource,
    pointerDown({ rawWorld }) {
      tool.pointerDown(rawWorld)
      return true
    },
    placeAt: tool.placeAt,
    pointerMoveWithoutCapture({ rawWorld }) {
      return tool.previewAt(rawWorld)
    },
    clearHoverPreview: tool.hidePreview,
    refreshViewportDependent: tool.refreshPreview,
    refreshTranslations: tool.refreshPreview,
    dispose: tool.dispose,
  }
}
