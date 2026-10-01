// canvas/runtime/scene-interaction.ts
//
// What is left of the legacy bridge (0B-2 to the end of 0B, plan §4 0B, spec §1.4 "The legacy bridge"): every tool runs on
// the ToolHost since D2's merge, and the bridge serves only drops until the host's drop route lands (0B-4). It owns no
// listener: the session hands it the drag event the DOM input source is handling (DomInputSource.currentEvent()), and it
// runs today's dragover, dragleave and drop on it: the plant drop cue and the saved stamp's ghost while a panel drag is over
// the map, then today's placement, its return to Select and the map's focus. The main agent deletes it at the end of 0B;
// the session is re-exported here for the suites that import it from here.

import { gridInterval, snapToGrid } from '../grid'
import { snapToGuides } from '../guides'
import type { ScenePoint } from './scene'
import {
  createInteractionPreview,
  hideInteractionPreview,
  showInteractionPreview,
} from './interaction/overlay-ui'
import { appendPlantStampSourceToDraft } from './tools/tool-actions'
import { isSceneLayerOpenForCreation } from './interaction/layer-guards'
import { hasPlantStampDragData, readPlantStampDropSource } from '../plant-stamp-source'
import {
  clearSavedObjectStampDragSource,
  hasSavedObjectStampDragData,
  readSavedObjectStampDragPreviewSource,
  readSavedObjectStampDropSource,
} from '../saved-object-stamp-source'
import {
  clearSavedObjectStampGhosts,
  placeSavedObjectStampAt,
  previewSavedObjectStampAt,
} from './interaction/saved-object-stamp-tool'
import { runCanvasRuntimeCleanups, throwCanvasRuntimeCleanupErrors } from './cleanup'
import type { SceneInteractionSessionDeps } from './interaction-session'

export {
  createSceneInteractionSession,
  type SceneInteractionSession,
  type SceneInteractionSessionDeps,
} from './interaction-session'

/** What the drops run on: the session's dependencies they read. */
export type LegacyInteractionBridgeDeps = Pick<
  SceneInteractionSessionDeps,
  | 'container'
  | 'camera'
  | 'getSceneStore'
  | 'getPlantPresentationContext'
  | 'sceneEdits'
  | 'commandAdmission'
  | 'settledReader'
  | 'readSnapToGridEnabled'
  | 'readSnapToGuidesEnabled'
>

/** What the interaction session lends the bridge. */
export interface LegacyInteractionBridgeHooks {
  /** Arms a tool through the session (the runtime's setTool, then the session), as today's _switchTool did. */
  switchTool(name: string): void
}

/** The drops the interaction session hands the bridge until 0B-4. */
export interface LegacyInteractionBridge {
  /** A tool change hides the drop cue, as today's cancellation did. */
  toolChanged(): void
  setOverviewMode(enabled: boolean): void
  prepareForDocumentReplacement(): void
  /** The rAF focus after a drop is dropped (a window blur). */
  cancelPendingFocus(): void
  dispose(): void

  // Today's handlers, given the DOM event being handled.
  dragOver(event: DragEvent): void
  dragLeave(): void
  drop(event: DragEvent): void
}

export function createLegacyInteractionBridge(
  deps: LegacyInteractionBridgeDeps,
  hooks: LegacyInteractionBridgeHooks,
): LegacyInteractionBridge {
  return new DefaultLegacyInteractionBridge(deps, hooks)
}

class DefaultLegacyInteractionBridge implements LegacyInteractionBridge {
  private readonly _preview: HTMLDivElement
  private _disposed = false
  private _pendingInteractionHostFocusFrame: number | null = null
  private _overviewMode = false

  constructor(
    private readonly _deps: LegacyInteractionBridgeDeps,
    private readonly _hooks: LegacyInteractionBridgeHooks,
  ) {
    this._preview = createInteractionPreview(this._deps.container)
  }

  toolChanged(): void {
    if (this._disposed) return
    hideInteractionPreview(this._preview)
  }

  setOverviewMode(enabled: boolean): void {
    if (this._disposed || this._overviewMode === enabled) return
    this._overviewMode = enabled
    if (!enabled) return
    runCanvasRuntimeCleanups([
      () => hideInteractionPreview(this._preview),
      () => clearSavedObjectStampGhosts(this._preview),
    ], 'Scene Interaction overview transition failed')
  }

  prepareForDocumentReplacement(): void {
    if (this._disposed) return
    runCanvasRuntimeCleanups([
      () => this._cancelPendingInteractionHostFocus(),
      () => hideInteractionPreview(this._preview),
      () => clearSavedObjectStampGhosts(this._preview),
    ], 'Scene Interaction document replacement preparation failed')
  }

  cancelPendingFocus(): void {
    this._cancelPendingInteractionHostFocus()
  }

  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    const errors: unknown[] = []
    const attempt = (cleanup: () => void): void => {
      try {
        cleanup()
      } catch (error) {
        errors.push(error)
      }
    }

    attempt(() => this._cancelPendingInteractionHostFocus())
    attempt(() => this._preview.remove())

    throwCanvasRuntimeCleanupErrors(errors, 'Scene Interaction Session disposal failed')
  }

  dragOver(event: DragEvent): void {
    event.preventDefault()
    if (this._overviewMode) {
      this._rejectDragOver(event)
      return
    }
    let admitted: boolean
    try {
      admitted = this._deps.settledReader.readWhenSettled(() => {
        this._dragOverWhenSettled(event)
        return true
      }, false)
    } catch (error) {
      this._rejectDragOver(event)
      throw error
    }
    if (admitted) return
    this._rejectDragOver(event)
  }

  private _rejectDragOver(event: DragEvent): void {
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
    hideInteractionPreview(this._preview)
    clearSavedObjectStampGhosts(this._preview)
    this._quarantineUnsettledSceneEvent(event)
  }

  private _dragOverWhenSettled(event: DragEvent): void {
    if (hasSavedObjectStampDragData(event.dataTransfer)) {
      const source = readSavedObjectStampDragPreviewSource(event.dataTransfer)
      const canDropStamp = source !== null
        && previewSavedObjectStampAt(this._savedObjectStampPlacementContext(), source, this._dragEventWorld(event))
      if (event.dataTransfer) event.dataTransfer.dropEffect = canDropStamp ? 'copy' : 'none'
      if (!canDropStamp) clearSavedObjectStampGhosts(this._preview)
      return
    }

    const canDropPlant = hasPlantStampDragData(event.dataTransfer)
      && isSceneLayerOpenForCreation(this._deps.getSceneStore().persisted, 'plants')
    if (event.dataTransfer) event.dataTransfer.dropEffect = canDropPlant ? 'copy' : 'none'
    if (!canDropPlant) {
      hideInteractionPreview(this._preview)
      return
    }
    const screen = this._screenPoint(event)
    showInteractionPreview(this._preview, 'band', screen, {
      x: screen.x + 12,
      y: screen.y + 12,
    })
  }

  dragLeave(): void {
    hideInteractionPreview(this._preview)
    clearSavedObjectStampGhosts(this._preview)
  }

  drop(event: DragEvent): void {
    event.preventDefault()
    hideInteractionPreview(this._preview)
    clearSavedObjectStampGhosts(this._preview)
    if (this._overviewMode) {
      this._quarantineUnsettledSceneEvent(event)
      return
    }
    this._runAdmittedSceneEvent(event, () => this._dropWhenSettled(event), {
      resumePending: true,
    })
  }

  private _dropWhenSettled(event: DragEvent): void {
    const savedObjectStampSource = readSavedObjectStampDropSource(event)
    if (savedObjectStampSource) {
      placeSavedObjectStampAt(
        this._savedObjectStampPlacementContext(),
        savedObjectStampSource,
        this._dragEventWorld(event),
        () => {
          clearSavedObjectStampDragSource()
          this._hooks.switchTool('select')
          this._activateInteractionHostAfterDrop()
        },
      )
      return
    }

    const source = readPlantStampDropSource(event)
    if (!source) return
    if (!isSceneLayerOpenForCreation(this._deps.getSceneStore().persisted, 'plants')) return
    const world = this._applySnapping(this._deps.camera.screenToWorld(this._screenPoint(event)))
    let placedPlantId: string | null = null
    this._deps.sceneEdits.run('interaction-drop', (tx) => {
      tx.mutate((draft) => {
        placedPlantId = appendPlantStampSourceToDraft(draft, source, world)
      })
      if (placedPlantId) tx.setSelection([{ kind: 'plant', id: placedPlantId }])
    }, {
      onCommitted: () => {
        this._hooks.switchTool('select')
        this._activateInteractionHostAfterDrop()
      },
    })
  }

  private _savedObjectStampPlacementContext() {
    return {
      preview: this._preview,
      camera: this._deps.camera,
      getSceneStore: this._deps.getSceneStore,
      getPlantPresentationContext: this._deps.getPlantPresentationContext,
      sceneEdits: this._deps.sceneEdits,
      applySnapping: (point: ScenePoint) => this._applySnapping(point),
    }
  }

  private _dragEventWorld(event: DragEvent): ScenePoint {
    return this._deps.camera.screenToWorld(this._screenPoint(event))
  }

  private _screenPoint(event: Pick<MouseEvent, 'clientX' | 'clientY'>): ScenePoint {
    const rect = this._deps.container.getBoundingClientRect()
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }
  }

  /** Snap a world-space point to grid and/or guides, as a placement does. */
  private _applySnapping(point: ScenePoint): ScenePoint {
    let next = point

    if (this._deps.readSnapToGridEnabled()) {
      next = snapToGrid(next.x, next.y, gridInterval(this._deps.camera.viewport.scale).interval)
    }

    const guides = this._deps.getSceneStore().persisted.guides
    if (this._deps.readSnapToGuidesEnabled() && guides.length > 0) {
      next = snapToGuides(next.x, next.y, this._deps.camera.viewport.scale, guides)
    }

    return next
  }

  private _focusInteractionHost(): void {
    this._deps.container.focus({ preventScroll: true })
  }

  private _quarantineUnsettledSceneEvent(event: Event): void {
    if (event.cancelable) event.preventDefault()
    event.stopImmediatePropagation()
  }

  private _runAdmittedSceneEvent(
    event: Event,
    operation: () => void,
    options: { resumePending?: boolean } = {},
  ): boolean {
    try {
      const admitted = this._deps.commandAdmission.runWhenSettled(() => {
        operation()
        return true
      }, false, options)
      if (!admitted) this._quarantineUnsettledSceneEvent(event)
      return admitted
    } catch (error) {
      this._quarantineUnsettledSceneEvent(event)
      throw error
    }
  }

  private _activateInteractionHostAfterDrop(): void {
    this._focusInteractionHost()
    this._cancelPendingInteractionHostFocus()
    this._pendingInteractionHostFocusFrame = window.requestAnimationFrame(() => {
      this._pendingInteractionHostFocusFrame = null
      this._focusInteractionHost()
    })
  }

  private _cancelPendingInteractionHostFocus(): void {
    if (this._pendingInteractionHostFocusFrame === null) return
    window.cancelAnimationFrame(this._pendingInteractionHostFocusFrame)
    this._pendingInteractionHostFocusFrame = null
  }
}
