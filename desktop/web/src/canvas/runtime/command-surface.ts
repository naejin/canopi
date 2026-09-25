import { mapZoomToStageScale } from '../projection'
import type { SpeciesFocusCommands } from './species-key'
import { computed, type ReadonlySignal } from '@preact/signals'
import { setCanvasTool } from '../session-state'
import type {
  CanvasRuntimeSavedObjectStampAdapter,
  CanvasRuntimeSettingsAdapter,
} from './app-adapter'
import type {
  SceneBounds,
  TemporaryBoundsFocusOptions,
  WorkspaceCameraFrameReader,
  WorkspaceCameraNavigation,
} from './camera'
import type { SceneRuntimePresentationController } from './scene-runtime/presentation'
import { getDesignObjectSelectionModel } from './scene-runtime/selection'
import type {
  CanvasChromeCommandSurface,
  CanvasCommandSurface,
  CanvasDesignObjectImportReceipt,
  CanvasDesignObjects,
  CanvasHistoryCommandSurface,
  CanvasLayerCommandSurface,
  CanvasPlantPresentationCommandSurface,
  CanvasSceneEditCommandSurface,
  CanvasToolCommandSurface,
  CanvasViewportCommandSurface,
} from './runtime'
import {
  createSceneGeoFrame,
  hydrateScenePersistedStateInFrame,
  type SceneLayerEntity,
  type SceneStateReader,
} from './scene'
import { createSceneArrangementPlacement } from './scene-runtime/arrangement-placement'
import { CURRENT_CANOPI_FILE_VERSION } from '../../generated/canopi-design-format'
import { DEFAULT_BUDGET_CURRENCY } from '../../generated/known-canopi-keys'
import type { SceneRuntimeMutationController } from './scene-runtime/mutations'
import type {
  SceneCommandAdmission,
  SceneEditCoordinator,
  SceneHistoryCommands,
  ScenePresentationMaintenance,
  SettledSceneReader,
} from './scene-runtime/transactions'

type CommandInvalidationKind = 'scene' | 'viewport' | 'chrome'

const DESIGN_OBJECTS_NOT_IMPORTED: CanvasDesignObjectImportReceipt = Object.freeze({
  committed: false,
  createdCount: 0,
})
type SceneLayerEdit = Partial<Pick<SceneLayerEntity, 'visible' | 'locked' | 'opacity'>>

interface SceneCanvasCommandSurfaceOptions {
  readonly readEmptySceneScale?: () => number
  readonly speciesFocus: SpeciesFocusCommands
  readonly sceneStore: SceneStateReader
  readonly camera: Pick<WorkspaceCameraFrameReader, 'viewport'>
  readonly cameraNavigation: Pick<
    WorkspaceCameraNavigation,
    'zoomIn' | 'zoomOut' | 'zoomToFit' | 'returnToDesign' | 'focusTemporaryBounds' | 'returnFromTemporaryFocus' | 'centerOn'
  >
  readonly history: SceneHistoryCommands
  readonly commandAdmission: SceneCommandAdmission
  readonly settledReader: SettledSceneReader
  readonly savedObjectStamps?: CanvasRuntimeSavedObjectStampAdapter
  readonly transientHistory: {
    readonly revision: ReadonlySignal<number>
    readonly canUndo: () => boolean
    readonly canRedo: () => boolean
    readonly undo: () => boolean
    readonly redo: () => boolean
  }
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
  readonly presentationMaintenance: ScenePresentationMaintenance
  readonly presentation: Pick<
    SceneRuntimePresentationController,
    | 'createPlantPresentationContext'
    | 'getLocalizedCommonNames'
    | 'refreshSpeciesCacheEntries'
    | 'publishRefresh'
  >
  readonly settings: Pick<
    CanvasRuntimeSettingsAdapter,
    'toggleGridVisible' | 'toggleSnapToGrid' | 'toggleRulersVisible' | 'layerProjections'
  >
  readonly setInteractionTool: (name: string) => void
  readonly invalidate: (kind: CommandInvalidationKind) => void
  readonly isRuntimeActive: () => boolean
  readonly isSpatialEditingEnabled: () => boolean
}

export function createSceneCanvasCommandSurface(
  options: SceneCanvasCommandSurfaceOptions,
): CanvasCommandSurface {
  return new SceneCanvasCommandRole(options)
}

class SceneCanvasCommandRole implements CanvasCommandSurface {
  readonly speciesFocus: SpeciesFocusCommands
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
      void options.settledReader.revision.value
      return options.settledReader.readWhenSettled(
        () => options.transientHistory.canUndo()
          || options.history.canUndo.value,
        false,
      )
    })
    const canRedo = computed(() => {
      void options.transientHistory.revision.value
      void options.settledReader.revision.value
      return options.settledReader.readWhenSettled(
        () => options.transientHistory.canRedo()
          || options.history.canRedo.value,
        false,
      )
    })

    this.speciesFocus = options.speciesFocus
    this.tools = {
      setTool: (name) => this.setTool(name),
    }
    this.viewport = {
      zoomIn: () => this.zoomIn(),
      zoomOut: () => this.zoomOut(),
      zoomToFit: () => this.zoomToFit(),
      returnToDesign: () => this.returnToDesign(),
      focusTemporaryBounds: (bounds, options) => this.focusTemporaryBounds(bounds, options),
      showPlace: (place, zoom) => this.showPlace(place, zoom),
      returnFromTemporaryFocus: () => this.returnFromTemporaryFocus(),
    }
    this.history = {
      canUndo,
      canRedo,
      undo: () => this.undo(),
      redo: () => this.redo(),
    }
    this.sceneEdits = {
      saveSelectionAsObjectStamp: () => this.saveSelectionAsObjectStamp(),
      importDesignObjects: (objects) => this.importDesignObjects(objects),
      copy: () => this.options.mutations.copy(),
      paste: () => this.runSpatialEdit(() => this.options.mutations.paste()),
      pasteAt: (point) => this.runSpatialEdit(() => this.options.mutations.pasteAt(point)),
      canPaste: () => this.options.isSpatialEditingEnabled() && this.options.mutations.canPaste(),
      duplicateSelected: () => this.runSpatialEdit(() => this.options.mutations.duplicateSelected()),
      toggleSelectedPlantNamePins: () => this.options.mutations.toggleSelectedPlantNamePins(),
      deleteSelected: () => this.runSpatialEdit(() => this.options.mutations.deleteSelected()),
      selectAll: () => this.options.mutations.selectAll(),
      selectSameSpecies: (canonicalName, options) => this.options.mutations.selectSameSpecies(canonicalName, options),
      bringToFront: () => this.runSpatialEdit(() => this.options.mutations.bringToFront()),
      sendToBack: () => this.runSpatialEdit(() => this.options.mutations.sendToBack()),
      lockSelected: () => this.runSpatialEdit(() => this.options.mutations.lockSelected()),
      unlockSelected: () => this.runSpatialEdit(() => this.options.mutations.unlockSelected()),
      groupSelected: () => this.runSpatialEdit(() => this.options.mutations.groupSelected()),
      ungroupSelected: () => this.runSpatialEdit(() => this.options.mutations.ungroupSelected()),
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
    this.options.setInteractionTool(name)
    setCanvasTool(name)
  }

  private saveSelectionAsObjectStamp(): void {
    this.options.commandAdmission.runWhenSettled(() => {
      const savedObjectStamps = this.options.savedObjectStamps
      if (!savedObjectStamps) return

      const scene = this.options.sceneStore.persisted
      const viewportScale = this.options.camera.viewport.scale
      const selection = getDesignObjectSelectionModel(
        scene,
        this.options.sceneStore.session.selectedTargets,
        {
          annotationViewportScale: viewportScale,
          plantContext: this.options.presentation.createPlantPresentationContext(viewportScale),
        },
      )
      void savedObjectStamps.saveCurrentSelection({
        scene,
        selection,
        localizedCommonNames: new Map(this.options.presentation.getLocalizedCommonNames()),
      })
    }, undefined, { resumePending: true })
  }

  // Hydrates through a frame at the runtime's own plane origin, so imported
  // lon/lat land in the same session-plane metres as the open Design.
  private importDesignObjects(objects: CanvasDesignObjects): CanvasDesignObjectImportReceipt {
    return this.options.commandAdmission.runWhenSettled(() => {
      const scene = hydrateScenePersistedStateInFrame(
        {
          version: CURRENT_CANOPI_FILE_VERSION,
          name: '',
          description: null,
          plant_species_colors: {},
          layers: [],
          plants: [...objects.plants],
          zones: [...objects.zones],
          annotations: [...objects.annotations],
          measurement_guides: [...objects.measurementGuides],
          consortiums: [],
          groups: [...objects.groups],
          timeline: [],
          budget: [],
          budget_currency: DEFAULT_BUDGET_CURRENCY,
          created_at: '',
          updated_at: '',
        },
        createSceneGeoFrame(this.options.sceneStore.sessionPlane.origin),
      )
      const receipt = createSceneArrangementPlacement({ sceneEdits: this.options.sceneEdits }).place({
        template: {
          plants: scene.plants.map((entity) => ({ sourceId: entity.id, entity })),
          zones: scene.zones.map((entity) => ({ sourceId: entity.name, entity })),
          annotations: scene.annotations.map((entity) => ({ sourceId: entity.id, entity })),
          measurementGuides: scene.measurementGuides.map((entity) => ({ sourceId: entity.id, entity })),
          groups: scene.groups.map((entity) => ({ sourceId: entity.id, entity })),
        },
        translateBy: { x: 0, y: 0 },
        historyType: 'import-design-objects',
      })
      return { committed: receipt.committed, createdCount: receipt.createdCount }
    }, DESIGN_OBJECTS_NOT_IMPORTED, { resumePending: true })
  }

  private zoomIn(): void {
    this.options.cameraNavigation.zoomIn()
    this.options.invalidate('viewport')
  }

  private zoomOut(): void {
    this.options.cameraNavigation.zoomOut()
    this.options.invalidate('viewport')
  }

  private showPlace(place: { readonly lon: number; readonly lat: number }, zoom: number): boolean {
    if (![place.lon, place.lat, zoom].every(Number.isFinite)) return false
    const point = this.options.sceneStore.sessionPlane.toPlane(place)
    this.options.cameraNavigation.centerOn(point, mapZoomToStageScale(zoom, place.lat))
    this.options.invalidate('viewport')
    return true
  }

  private zoomToFit(): void {
    this.options.cameraNavigation.zoomToFit(this.options.sceneStore.persisted, {
      plantContext: this.options.presentation.createPlantPresentationContext(this.options.camera.viewport.scale),
      emptySceneScale: this.options.readEmptySceneScale?.(),
    })
    this.options.invalidate('viewport')
  }

  private returnToDesign(): void {
    this.options.cameraNavigation.returnToDesign(this.options.sceneStore.persisted, {
      plantContext: this.options.presentation.createPlantPresentationContext(this.options.camera.viewport.scale),
    })
    this.options.invalidate('viewport')
  }

  private runSpatialEdit(operation: () => void): void {
    if (!this.options.isSpatialEditingEnabled()) return
    operation()
  }

  private focusTemporaryBounds(
    bounds: SceneBounds,
    options: TemporaryBoundsFocusOptions,
  ): boolean {
    const changed = this.options.cameraNavigation.focusTemporaryBounds(bounds, options)
    if (changed) this.options.invalidate('viewport')
    return changed
  }

  private returnFromTemporaryFocus(): boolean {
    const changed = this.options.cameraNavigation.returnFromTemporaryFocus()
    if (changed) this.options.invalidate('viewport')
    return changed
  }

  private undo(): void {
    this.options.commandAdmission.runWhenSettled(() => {
      if (this.options.transientHistory.undo()) return
      this.options.history.undo()
    }, undefined, { resumePending: true })
  }

  private redo(): void {
    this.options.commandAdmission.runWhenSettled(() => {
      if (this.options.transientHistory.redo()) return
      this.options.history.redo()
    }, undefined, { resumePending: true })
  }

  private toggleRulers(): void {
    this.options.settings.toggleRulersVisible()
    this.options.invalidate('chrome')
  }

  private setSceneLayerOpacity(name: string, opacity: number): boolean {
    return this.options.commandAdmission.runWhenSettled(() => {
      if (!Number.isFinite(opacity)) return false
      return this.setSceneLayerStateWhenSettled(name, {
        opacity: Math.min(1, Math.max(0, opacity)),
      })
    }, false, { resumePending: true })
  }

  private setSceneLayerState(name: string, edit: SceneLayerEdit): boolean {
    return this.options.commandAdmission.runWhenSettled(
      () => this.setSceneLayerStateWhenSettled(name, edit),
      false,
      { resumePending: true },
    )
  }

  private setSceneLayerStateWhenSettled(name: string, edit: SceneLayerEdit): boolean {
    return this.options.sceneEdits.run('scene-layer-settings', (tx) => {
      tx.mutate((draft) => {
        const layer = draft.layers.find((entry) => entry.name === name)
        if (!layer) return
        if (edit.visible !== undefined) layer.visible = edit.visible
        if (edit.locked !== undefined) layer.locked = edit.locked
        if (edit.opacity !== undefined) layer.opacity = edit.opacity
      })
    })
  }

  private async ensureSpeciesCacheEntries(
    canonicalNames: string[],
    activeLocale: string,
  ): Promise<boolean> {
    if (!this.options.isRuntimeActive()) return false
    const ticket = this.options.presentationMaintenance.issueTicket()
    const result = await this.options.presentation.refreshSpeciesCacheEntries(canonicalNames, activeLocale)
    if (!this.options.isRuntimeActive()) {
      if (result.failure) throw result.failure.error
      return false
    }
    const plantNamesPublished = this.options.presentation.publishRefresh(result)
    if (result.failure) {
      if (result.changed || plantNamesPublished) this.options.invalidate('scene')
      throw result.failure.error
    }
    const backfillResult = this.options.presentationMaintenance.applyBackfills(ticket, result.backfills)
    if (result.changed || plantNamesPublished) this.options.invalidate('scene')
    return result.changed || plantNamesPublished || backfillResult === 'applied'
  }
}
