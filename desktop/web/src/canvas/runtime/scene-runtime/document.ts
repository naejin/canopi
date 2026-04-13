import type { CanopiFile } from '../../../types/design'
import { guides } from '../../scene-metadata-state'
import { lockedObjectIds, sceneEntityRevision } from '../../runtime-mirror-state'
import type { SceneStore } from '../scene'
import type { PlantPresentationBackfill } from './presentation'
import {
  createScenePatchCommand,
  type SceneCommandRuntime,
  type SceneCommandSnapshot,
} from '../scene-commands'
import { SceneHistory } from '../scene-history'
import type { CanvasRuntimeDocumentMetadata } from '../runtime'

interface ApplySignalBackedSceneStateOptions {
  recordHistory: boolean
  syncGuides: boolean
}

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
  incrementViewportRevision(): void
  applySignalBackedSceneState(options: ApplySignalBackedSceneStateOptions): boolean
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
  private readonly _incrementViewportRevision: SceneRuntimeDocumentBridgeOptions['incrementViewportRevision']
  private readonly _applySignalBackedSceneState: SceneRuntimeDocumentBridgeOptions['applySignalBackedSceneState']

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
    this._incrementViewportRevision = options.incrementViewportRevision
    this._applySignalBackedSceneState = options.applySignalBackedSceneState
  }

  loadDocument(file: CanopiFile): void {
    this._clearHoveredTargets()
    this._clearPanelOriginTargets()
    this._sceneStore.hydrate(file)
    this._incrementViewportRevision()
    this._history.clear()
    lockedObjectIds.value = new Set()
    this._syncCanvasSignalsFromDocument(file)
    this._syncCanvasSignalsFromScene()
    this._invalidateScene()
    sceneEntityRevision.value += 1
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
    sceneEntityRevision.value += 1
  }

  serializeDocument(metadata: CanvasRuntimeDocumentMetadata, doc: CanopiFile): CanopiFile {
    const shouldSyncGuides =
      guides.value.length > 0
      || this._sceneStore.persisted.guides.length > 0

    this._applySignalBackedSceneState({ recordHistory: false, syncGuides: shouldSyncGuides })

    const canvasOutput = this._sceneStore.toCanopiFile({ now: new Date() })
    const nextExtra = { ...(doc.extra ?? {}) }
    if (canvasOutput.extra && 'guides' in canvasOutput.extra) nextExtra.guides = canvasOutput.extra.guides
    else delete nextExtra.guides

    return {
      ...doc,
      ...canvasOutput,
      name: metadata.name,
      description: metadata.description ?? doc.description ?? null,
      location: metadata.location
        ? {
            lat: metadata.location.lat,
            lon: metadata.location.lon,
            altitude_m: metadata.location.altitude_m ?? null,
          }
        : doc.location ?? null,
      north_bearing_deg: metadata.northBearingDeg ?? doc.north_bearing_deg ?? 0,
      created_at: doc.created_at,
      extra: nextExtra,
      consortiums: doc.consortiums,
      timeline: doc.timeline,
      budget: doc.budget,
      budget_currency: doc.budget_currency ?? 'EUR',
    }
  }

  captureCommandSnapshot(): SceneCommandSnapshot {
    const snapshot = this._sceneStore.snapshot()
    return {
      persisted: snapshot.persisted,
      session: snapshot.session,
      lockedIds: new Set(lockedObjectIds.value),
    }
  }

  markDirty(before: SceneCommandSnapshot, type = 'scene-mutation'): void {
    const after = this.captureCommandSnapshot()
    const command = createScenePatchCommand(type, before, after)
    if (!command) return
    this._history.record(command)
    this._sceneStore.updateSession((session) => {
      session.documentRevision += 1
    })
    sceneEntityRevision.value += 1
  }

  historyRuntime(): SceneCommandRuntime {
    return {
      sceneStore: this._sceneStore,
      setSelection: (ids) => {
        this._setSelection(ids)
      },
      setLockedIds: (ids) => {
        lockedObjectIds.value = new Set(ids)
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
