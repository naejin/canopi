import { computed, type ReadonlySignal } from '@preact/signals'
import { setCanvasTool } from '../session-state'
import type { CanvasRuntimeSettingsAdapter } from './app-adapter'
import type { CameraController } from './camera'
import type { PlantPresentationBackfill, SceneRuntimePresentationController } from './scene-runtime/presentation'
import type {
  CanvasChromeCommandSurface,
  CanvasCommandSurface,
  CanvasHistoryCommandSurface,
  CanvasLayerCommandSurface,
  CanvasPlantPresentationCommandSurface,
  CanvasSceneEditCommandSurface,
  CanvasToolCommandSurface,
  CanvasViewportCommandSurface,
} from './runtime'
import type { SceneLayerEntity, SceneStore, SceneViewportState } from './scene'
import type { SceneHistory } from './scene-history'
import type { SceneRuntimeDocumentBridge } from './scene-runtime/document'
import type { SceneRuntimeMutationController } from './scene-runtime/mutations'
import { syncSceneLayerSignalsFromScene } from './scene-runtime/scene-sync'
import type { SceneEditCoordinator } from './scene-runtime/transactions'

type CommandInvalidationKind = 'scene' | 'viewport' | 'chrome'
type SceneLayerEdit = Partial<Pick<SceneLayerEntity, 'visible' | 'locked' | 'opacity'>>

interface SceneCanvasCommandSurfaceOptions {
  readonly sceneStore: Pick<SceneStore, 'persisted'>
  readonly camera: Pick<CameraController, 'zoomIn' | 'zoomOut' | 'zoomToFit' | 'viewport'>
  readonly history: Pick<SceneHistory, 'canUndo' | 'canRedo' | 'undo' | 'redo'>
  readonly transientHistory: {
    readonly revision: ReadonlySignal<number>
    readonly canUndo: () => boolean
    readonly canRedo: () => boolean
    readonly undo: () => boolean
    readonly redo: () => boolean
  }
  readonly documents: Pick<
    SceneRuntimeDocumentBridge,
    'historyRuntime' | 'applyPresentationBackfills'
  >
  readonly mutations: Pick<
    SceneRuntimeMutationController,
    | 'copy'
    | 'paste'
    | 'pasteAt'
    | 'canPaste'
    | 'duplicateSelected'
    | 'toggleSelectedPlantNamePins'
    | 'deleteSelected'
    | 'selectAll'
    | 'selectSameSpecies'
    | 'bringToFront'
    | 'sendToBack'
    | 'lockSelected'
    | 'unlockSelected'
    | 'groupSelected'
    | 'ungroupSelected'
    | 'setSelectedPlantColor'
    | 'setSelectedPlantSymbol'
    | 'setPlantColorForSpecies'
    | 'setPlantSymbolForSpecies'
    | 'clearPlantSpeciesColor'
    | 'clearPlantSpeciesSymbol'
  >
  readonly sceneEdits: SceneEditCoordinator
  readonly presentation: Pick<
    SceneRuntimePresentationController,
    'createPlantPresentationContext' | 'refreshSpeciesCacheEntries'
  >
  readonly settings: Pick<
    CanvasRuntimeSettingsAdapter,
    'toggleGridVisible' | 'toggleSnapToGrid' | 'toggleRulersVisible' | 'layerProjections'
  >
  readonly setViewport: (viewport: SceneViewportState) => void
  readonly setInteractionTool: (name: string) => void
  readonly syncCanvasSignalsFromScene: () => void
  readonly incrementSceneRevision: () => void
  readonly currentPresentationRevision: () => number
  readonly invalidate: (kind: CommandInvalidationKind) => void
}

export function createSceneCanvasCommandSurface(
  options: SceneCanvasCommandSurfaceOptions,
): CanvasCommandSurface {
  return new SceneCanvasCommandRole(options)
}

class SceneCanvasCommandRole implements CanvasCommandSurface {
  readonly tools: CanvasToolCommandSurface
  readonly viewport: CanvasViewportCommandSurface
  readonly history: CanvasHistoryCommandSurface
  readonly sceneEdits: CanvasSceneEditCommandSurface
  readonly chrome: CanvasChromeCommandSurface
  readonly layers: CanvasLayerCommandSurface
  readonly plantPresentation: CanvasPlantPresentationCommandSurface

  constructor(private readonly options: SceneCanvasCommandSurfaceOptions) {
    const canUndo = computed(() => {
      void options.transientHistory.revision.value
      return options.transientHistory.canUndo() || options.history.canUndo.value
    })
    const canRedo = computed(() => {
      void options.transientHistory.revision.value
      return options.transientHistory.canRedo() || options.history.canRedo.value
    })

    this.tools = {
      setTool: (name) => this.setTool(name),
    }
    this.viewport = {
      zoomIn: () => this.zoomIn(),
      zoomOut: () => this.zoomOut(),
      zoomToFit: () => this.zoomToFit(),
    }
    this.history = {
      canUndo,
      canRedo,
      undo: () => this.undo(),
      redo: () => this.redo(),
    }
    this.sceneEdits = {
      copy: () => this.options.mutations.copy(),
      paste: () => this.options.mutations.paste(),
      pasteAt: (point) => this.options.mutations.pasteAt(point),
      canPaste: () => this.options.mutations.canPaste(),
      duplicateSelected: () => this.options.mutations.duplicateSelected(),
      toggleSelectedPlantNamePins: () => this.options.mutations.toggleSelectedPlantNamePins(),
      deleteSelected: () => this.options.mutations.deleteSelected(),
      selectAll: () => this.options.mutations.selectAll(),
      selectSameSpecies: (canonicalName, options) => this.options.mutations.selectSameSpecies(canonicalName, options),
      bringToFront: () => this.options.mutations.bringToFront(),
      sendToBack: () => this.options.mutations.sendToBack(),
      lockSelected: () => this.options.mutations.lockSelected(),
      unlockSelected: () => this.options.mutations.unlockSelected(),
      groupSelected: () => this.options.mutations.groupSelected(),
      ungroupSelected: () => this.options.mutations.ungroupSelected(),
    }
    this.chrome = {
      toggleGrid: () => this.options.settings.toggleGridVisible(),
      toggleSnapToGrid: () => this.options.settings.toggleSnapToGrid(),
      toggleRulers: () => this.toggleRulers(),
    }
    this.layers = {
      setSceneLayerVisibility: (name, visible) => this.setSceneLayerState(name, { visible }),
      setSceneLayerOpacity: (name, opacity) => this.setSceneLayerOpacity(name, opacity),
      setSceneLayerLocked: (name, locked) => this.setSceneLayerState(name, { locked }),
    }
    this.plantPresentation = {
      ensureSpeciesCacheEntries: (canonicalNames, activeLocale) =>
        this.ensureSpeciesCacheEntries(canonicalNames, activeLocale),
      setSelectedPlantColor: (color) => this.options.mutations.setSelectedPlantColor(color),
      setSelectedPlantSymbol: (symbol) => this.options.mutations.setSelectedPlantSymbol(symbol),
      setPlantColorForSpecies: (canonicalName, color) =>
        this.options.mutations.setPlantColorForSpecies(canonicalName, color),
      setPlantSymbolForSpecies: (canonicalName, symbol) =>
        this.options.mutations.setPlantSymbolForSpecies(canonicalName, symbol),
      clearPlantSpeciesColor: (canonicalName) => this.options.mutations.clearPlantSpeciesColor(canonicalName),
      clearPlantSpeciesSymbol: (canonicalName) => this.options.mutations.clearPlantSpeciesSymbol(canonicalName),
    }
  }

  private setTool(name: string): void {
    setCanvasTool(name)
    this.options.setInteractionTool(name)
  }

  private zoomIn(): void {
    this.options.setViewport(this.options.camera.zoomIn())
    this.options.invalidate('viewport')
  }

  private zoomOut(): void {
    this.options.setViewport(this.options.camera.zoomOut())
    this.options.invalidate('viewport')
  }

  private zoomToFit(): void {
    this.options.setViewport(this.options.camera.zoomToFit(this.options.sceneStore.persisted, {
      plantContext: this.options.presentation.createPlantPresentationContext(this.options.camera.viewport.scale),
    }))
    this.options.invalidate('viewport')
  }

  private undo(): void {
    if (this.options.transientHistory.undo()) return
    this.options.history.undo(this.options.documents.historyRuntime())
    this.options.syncCanvasSignalsFromScene()
    this.options.incrementSceneRevision()
    this.options.invalidate('scene')
  }

  private redo(): void {
    if (this.options.transientHistory.redo()) return
    this.options.history.redo(this.options.documents.historyRuntime())
    this.options.syncCanvasSignalsFromScene()
    this.options.incrementSceneRevision()
    this.options.invalidate('scene')
  }

  private toggleRulers(): void {
    this.options.settings.toggleRulersVisible()
    this.options.invalidate('chrome')
  }

  private setSceneLayerOpacity(name: string, opacity: number): boolean {
    if (!Number.isFinite(opacity)) return false
    return this.setSceneLayerState(name, {
      opacity: Math.min(1, Math.max(0, opacity)),
    })
  }

  private setSceneLayerState(name: string, edit: SceneLayerEdit): boolean {
    if (this.options.settings.layerProjections.isAppOwnedLayerProjection(name)) return false

    const committed = this.options.sceneEdits.run('scene-layer-settings', (tx) => {
      tx.mutate((draft) => {
        const layer = draft.layers.find((entry) => entry.name === name)
        if (!layer) return
        if (edit.visible !== undefined) layer.visible = edit.visible
        if (edit.locked !== undefined) layer.locked = edit.locked
        if (edit.opacity !== undefined) layer.opacity = edit.opacity
      })
    })
    if (committed) {
      syncSceneLayerSignalsFromScene(
        this.options.sceneStore as SceneStore,
        name,
        this.options.settings.layerProjections,
      )
    }
    return committed
  }

  private async ensureSpeciesCacheEntries(
    canonicalNames: string[],
    activeLocale: string,
  ): Promise<boolean> {
    const presentationRevision = this.options.currentPresentationRevision()
    const result = await this.options.presentation.refreshSpeciesCacheEntries(canonicalNames, activeLocale)
    const appliedBackfills = this.applyPresentationBackfillsIfCurrent(
      presentationRevision,
      result.backfills,
    )
    if (presentationRevision !== this.options.currentPresentationRevision()) return false
    if (result.changed) this.options.invalidate('scene')
    return result.changed || appliedBackfills
  }

  private applyPresentationBackfillsIfCurrent(
    expectedRevision: number,
    backfills: ReadonlyArray<PlantPresentationBackfill> | null,
  ): boolean {
    if (expectedRevision !== this.options.currentPresentationRevision()) return false
    return this.options.documents.applyPresentationBackfills(backfills)
  }
}
