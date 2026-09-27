import type { SpeciesFocus, SpeciesFocusCommands } from './species-key'
import type { CanvasPrintSnapshot } from '../print'
import type { CanvasInspectionHandle } from '../inspection'
import type { ReadonlySignal } from '@preact/signals'
import type {
  Annotation,
  CanopiFile,
  MeasurementGuide,
  ObjectGroup,
  PlacedPlant,
  Zone,
} from '../../types/design'
import type { SessionPlane } from '../session-plane'
import type { SelectedPlantColorContext } from '../plant-color-context'
import type { SelectedPlantSymbolContext } from '../plant-symbol-context'
import type { PlantSymbolId, SceneDesignObjectTarget, ScenePoint } from './scene'
import type {
  CameraViewportSnapshot,
  SceneBounds,
  TemporaryBoundsFocusOptions,
  CameraFrameInsets,
} from './camera'
import type { ScenePersistedState, SceneViewportState } from './scene'
import type { SceneRendererSnapshot } from './renderers/scene-types'

export interface CanvasRuntimeDocumentMetadata {
  name: string
  description?: string | null
}

export type CanvasDesignObjectSelectionTarget = SceneDesignObjectTarget

export type CanvasDesignObjectSelectionBlockReason =
  | 'grouped-member'
  | 'hidden-layer'
  | 'locked-layer'
  | 'locked-design-object'
  | 'missing-design-object'

export interface CanvasDesignObjectSelectionBlockedTarget {
  readonly target: CanvasDesignObjectSelectionTarget
  readonly reason: CanvasDesignObjectSelectionBlockReason
  readonly layerName: string | null
  readonly groupId?: string
}

export interface CanvasDesignObjectSelectionModel {
  readonly editableTargets: readonly CanvasDesignObjectSelectionTarget[]
  readonly lockedTargets: readonly CanvasDesignObjectSelectionTarget[]
  readonly blockedTargets: readonly CanvasDesignObjectSelectionBlockedTarget[]
  readonly bounds: SceneBounds | null
  readonly sameSpeciesReferenceCanonicalName: string | null
  readonly plantNamePinning?: {
    readonly plantIds: readonly string[]
    readonly allPinned: boolean
  }
}

export interface CanvasQueryRevision {
  readonly scene: ReadonlySignal<number>
  readonly plantNames: ReadonlySignal<number>
}

export interface CanvasToolCommandSurface {
  setTool(name: string): void
}

export interface CanvasViewportCommandSurface {
  zoomIn(): void
  zoomOut(): void
  /** Multiply the scale about the screen centre (camera only). */
  zoomBy(factor: number): void
  zoomToFit(): void
  returnToDesign(): void
  focusTemporaryBounds(bounds: SceneBounds, options: TemporaryBoundsFocusOptions): boolean
  returnFromTemporaryFocus(): boolean
  /**
   * Screen edges covered by the workspace's floating chrome. Fit to Design,
   * Return to Design and temporary focus frame into the visible map area.
   */
  setFramingInsets(insets: CameraFrameInsets): void
  /**
   * Moves the view to a place; design objects never move. `fly` animates the
   * move on the map; the default jumps.
   */
  showPlace(
    place: { readonly lon: number; readonly lat: number },
    zoom: number,
    options?: { readonly motion?: 'fly' | 'jump' },
  ): boolean
}

export interface CanvasHistoryCommandSurface {
  readonly canUndo: ReadonlySignal<boolean>
  readonly canRedo: ReadonlySignal<boolean>
  undo(): void
  redo(): void
}

/** Design objects in their persisted lon/lat form (no metres). */
export interface CanvasDesignObjects {
  readonly plants: readonly PlacedPlant[]
  readonly zones: readonly Zone[]
  readonly annotations: readonly Annotation[]
  readonly measurementGuides: readonly MeasurementGuide[]
  readonly groups: readonly ObjectGroup[]
}

export interface CanvasDesignObjectImportReceipt {
  readonly committed: boolean
  readonly createdCount: number
}

export interface CanvasSceneEditCommandSurface {
  saveSelectionAsObjectStamp(): void
  /**
   * Adds lon/lat design objects as one undoable edit: positions enter the
   * session plane, identities are re-allocated, locks are cleared and the new
   * objects become the selection. Group members refer to the given ids.
   */
  importDesignObjects(objects: CanvasDesignObjects): CanvasDesignObjectImportReceipt
  copy(): void
  paste(): void
  pasteAt(point: ScenePoint): void
  canPaste(): boolean
  duplicateSelected(): void
  toggleSelectedPlantNamePins(): void
  deleteSelected(): void
  selectAll(): void
  selectSameSpecies(canonicalName?: string, options?: { additive?: boolean }): void
  /** Replaces the selection with every selectable plant of these species. */
  selectSpecies(canonicalNames: readonly string[]): void
  bringToFront(): void
  sendToBack(): void
  lockSelected(): void
  unlockSelected(): void
  groupSelected(): void
  ungroupSelected(): void
}

export interface CanvasChromeCommandSurface {
  toggleGrid(): void
  toggleSnapToGrid(): void
  toggleRulers(): void
}

export interface CanvasLayerCommandSurface {
  setSceneLayerVisibility(name: string, visible: boolean): boolean
  setSceneLayerOpacity(name: string, opacity: number): boolean
  setSceneLayerLocked(name: string, locked: boolean): boolean
}

export interface CanvasPlantPresentationCommandSurface {
  ensureSpeciesCacheEntries(canonicalNames: string[], activeLocale: string): Promise<boolean>
  setSelectedPlantColor(color: string | null): number
  setSelectedPlantSymbol(symbol: PlantSymbolId | null): number
  setPlantColorForSpecies(canonicalName: string, color: string | null): number
  setPlantSymbolForSpecies(canonicalName: string, symbol: PlantSymbolId): number
  clearPlantSpeciesColor(canonicalName: string): boolean
  clearPlantSpeciesSymbol(canonicalName: string): boolean
}

export interface CanvasCommandSurface {
  readonly speciesFocus: SpeciesFocusCommands
  readonly tools: CanvasToolCommandSurface
  readonly viewport: CanvasViewportCommandSurface
  readonly history: CanvasHistoryCommandSurface
  readonly sceneEdits: CanvasSceneEditCommandSurface
  readonly chrome: CanvasChromeCommandSurface
  readonly layers: CanvasLayerCommandSurface
  readonly plantPresentation: CanvasPlantPresentationCommandSurface
}

export interface CanvasViewSceneRequest {
  readonly viewport: SceneViewportState
  /** Design layers drawn; every other layer is hidden. */
  readonly visibleLayerNames: readonly string[]
  /** Species the view focuses; others are dimmed as Species Focus does. */
  readonly focusedSpecies: string | null
}

export interface CanvasQuerySurface {
  getSpeciesFocus(): SpeciesFocus
  readonly revision: CanvasQueryRevision
  readonly viewport: ReadonlySignal<CameraViewportSnapshot>
  // The open Design's metre frame; null only before the first hydration.
  readonly sessionPlane: ReadonlySignal<SessionPlane | null>
  capturePrintSnapshot(): CanvasPrintSnapshot | null
  /**
   * The settled scene as a saved view shows it at `viewport`, for an off-screen
   * snapshot: no selection, hover or panel highlight. Null while an edit owns
   * the Scene. Never changes session state.
   */
  captureViewScene(request: CanvasViewSceneRequest): SceneRendererSnapshot | null
  getScenePhysicalExtentMeters(): number | null
  getSceneSnapshot(): ScenePersistedState
  getSelection(): SceneDesignObjectTarget[]
  getDesignObjectSelection(): CanvasDesignObjectSelectionModel
  getSelectedPlantColorContext(): SelectedPlantColorContext
  getSelectedPlantSymbolContext(): SelectedPlantSymbolContext
  getPlacedPlants(): PlacedPlant[]
  getSettledPlacedPlants(): PlacedPlant[] | null
  /** Canonical lon/lat design objects, as a save would write them; null while busy. */
  getSettledDesignObjects(): CanvasDesignObjects | null
  getLocalizedCommonNames(): ReadonlyMap<string, string | null>
}

export interface CanvasDocumentReplacementReceipt {
  readonly callerFinalizerInvoked: boolean
}

export class CanvasDocumentReplacementNotAdmittedError extends Error {
  constructor(readonly reason: unknown) {
    super(
      reason instanceof Error
        ? reason.message
        : 'Canvas rejected document replacement before hydration',
    )
    this.name = 'CanvasDocumentReplacementNotAdmittedError'
  }
}

export type CanvasPersistenceAcknowledgement = 'applied' | 'stale'

export interface CanvasPersistenceCapture {
  readonly content: CanopiFile
  isCurrent(): boolean
  acknowledgeSaved(): CanvasPersistenceAcknowledgement
}

export class CanvasAuthorityBusyError extends Error {
  constructor(
    readonly activeType: string,
    message = `Canvas authority ${activeType} is busy`,
  ) {
    super(message)
    this.name = 'CanvasAuthorityBusyError'
  }
}

const canvasDocumentReplacementTokenBrand = Symbol('canvas-document-replacement-token')

export interface CanvasDocumentReplacementToken {
  readonly [canvasDocumentReplacementTokenBrand]: true
}

export function createCanvasDocumentReplacementToken(): CanvasDocumentReplacementToken {
  return Object.freeze({
    [canvasDocumentReplacementTokenBrand]: true as const,
  })
}

export interface CanvasDocumentSurface {
  attachInspectionTo(element: HTMLElement): CanvasInspectionHandle
  initializeViewport(): void
  attachRulersTo(element: HTMLElement): void
  showCanvasChrome(): void
  hideCanvasChrome(): void
  zoomToFit(): void
  loadDocument(file: CanopiFile): void
  replaceDocument(
    file: CanopiFile,
    token: CanvasDocumentReplacementToken,
    finalizeReplacement: () => void,
  ): CanvasDocumentReplacementReceipt
  hasLoadedDocument(): boolean
  captureForPersistence(
    metadata: CanvasRuntimeDocumentMetadata,
    doc: CanopiFile,
  ): CanvasPersistenceCapture
  resize(width: number, height: number): void
  destroy(): void
}

export interface CanvasRuntimeSurfaces {
  readonly commands: CanvasCommandSurface
  readonly queries: CanvasQuerySurface
  readonly documents: CanvasDocumentSurface
}
