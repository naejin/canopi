import type { CanopiFile } from '../../../types/design'
import { composeDocumentForSave } from '../../../app/contracts/document'
import type { SceneStore } from '../scene'
import type { PlantPresentationBackfill } from './presentation'
import {
  createScenePatchCommand,
  type SceneCommandRuntime,
  type SceneCommandSnapshot,
} from '../scene-commands'
import { SceneHistory } from '../scene-history'
import type { CanvasRuntimeDocumentMetadata } from '../runtime'

interface SceneRuntimeDocumentBridgeOptions {
  sceneStore: SceneStore
  history: SceneHistory
  setSelection(ids: Iterable<string>): void
  resetTransientRuntimeState(): void
  clearHoveredTargets(): void
  clearPanelOriginTargets(): void
  syncCanvasSignalsFromDocument(file: CanopiFile): void
  syncCanvasSignalsFromScene(): void
  invalidateScene(): void
  incrementSceneRevision(): void
  incrementViewportRevision(): void
}

export class SceneRuntimeDocumentBridge {
  private readonly _sceneStore: SceneStore
  private readonly _history: SceneHistory
  private readonly _setSelection: SceneRuntimeDocumentBridgeOptions['setSelection']
  private readonly _resetTransientRuntimeState: SceneRuntimeDocumentBridgeOptions['resetTransientRuntimeState']
  private readonly _clearHoveredTargets: SceneRuntimeDocumentBridgeOptions['clearHoveredTargets']
  private readonly _clearPanelOriginTargets: SceneRuntimeDocumentBridgeOptions['clearPanelOriginTargets']
  private readonly _syncCanvasSignalsFromDocument: SceneRuntimeDocumentBridgeOptions['syncCanvasSignalsFromDocument']
  private readonly _syncCanvasSignalsFromScene: SceneRuntimeDocumentBridgeOptions['syncCanvasSignalsFromScene']
  private readonly _invalidateScene: SceneRuntimeDocumentBridgeOptions['invalidateScene']
  private readonly _incrementSceneRevision: SceneRuntimeDocumentBridgeOptions['incrementSceneRevision']
  private readonly _incrementViewportRevision: SceneRuntimeDocumentBridgeOptions['incrementViewportRevision']

  constructor(options: SceneRuntimeDocumentBridgeOptions) {
    this._sceneStore = options.sceneStore
    this._history = options.history
    this._setSelection = options.setSelection
    this._resetTransientRuntimeState = options.resetTransientRuntimeState
    this._clearHoveredTargets = options.clearHoveredTargets
    this._clearPanelOriginTargets = options.clearPanelOriginTargets
    this._syncCanvasSignalsFromDocument = options.syncCanvasSignalsFromDocument
    this._syncCanvasSignalsFromScene = options.syncCanvasSignalsFromScene
    this._invalidateScene = options.invalidateScene
    this._incrementSceneRevision = options.incrementSceneRevision
    this._incrementViewportRevision = options.incrementViewportRevision
  }

  loadDocument(file: CanopiFile): void {
    this._clearHoveredTargets()
    this._clearPanelOriginTargets()
    this._sceneStore.hydrate(file)
    this._incrementViewportRevision()
    this._history.clear()
    this._syncCanvasSignalsFromDocument(file)
    this._syncCanvasSignalsFromScene()
    this._invalidateScene()
    this._incrementSceneRevision()
  }

  replaceDocument(file: CanopiFile): void {
    this._resetTransientRuntimeState()
    this._clearHoveredTargets()
    this._clearPanelOriginTargets()
    this._sceneStore.hydrate(file)
    this._incrementViewportRevision()
    this._history.clear()
    this._syncCanvasSignalsFromDocument(file)
    this._syncCanvasSignalsFromScene()
    this._invalidateScene()
    this._incrementSceneRevision()
  }

  serializeDocument(metadata: CanvasRuntimeDocumentMetadata, doc: CanopiFile): CanopiFile {
    const canvasOutput = this._sceneStore.toCanopiFile({ now: new Date() })
    return composeDocumentForSave({ metadata, document: doc, canvas: canvasOutput })
  }

  captureCommandSnapshot(): SceneCommandSnapshot {
    const snapshot = this._sceneStore.snapshot()
    return {
      persisted: snapshot.persisted,
      session: snapshot.session,
    }
  }

  markDirty(before: SceneCommandSnapshot, type = 'scene-mutation'): boolean {
    const after = this.captureCommandSnapshot()
    const command = createScenePatchCommand(type, before, after)
    if (!command) return false
    this._history.record(command)
    this._sceneStore.updateSession((session) => {
      session.documentRevision += 1
    })
    this._incrementSceneRevision()
    return true
  }

  historyRuntime(): SceneCommandRuntime {
    return {
      sceneStore: this._sceneStore,
      setSelection: (ids) => {
        this._setSelection(ids)
      },
    }
  }

  applyPresentationBackfills(backfills: ReadonlyArray<PlantPresentationBackfill> | null): boolean {
    if (!backfills || backfills.length === 0) return false
    const byId = new Map(backfills.map((entry) => [entry.plantId, entry]))
    let changed = false
    this._sceneStore.updatePersisted((draft) => {
      draft.plants = draft.plants.map((plant) => {
        const next = byId.get(plant.id)
        if (!next) return plant
        if (
          next.stratum === plant.stratum
          && next.canopySpreadM === plant.canopySpreadM
          && next.scale === plant.scale
        ) {
          return plant
        }
        changed = true
        return {
          ...plant,
          stratum: next.stratum,
          canopySpreadM: next.canopySpreadM,
          scale: next.scale,
        }
      })
    })
    return changed
  }

  markSaved(): void {
    this._history.markSaved()
  }

  clearHistory(): void {
    this._history.clear()
  }
}
