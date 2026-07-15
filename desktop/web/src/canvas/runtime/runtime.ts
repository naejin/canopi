import type { ReadonlySignal } from '@preact/signals'
import type { CanopiFile, PlacedPlant } from '../../types/design'
import type { SelectedPlantColorContext } from '../plant-color-context'
import type { SelectedPlantSymbolContext } from '../plant-symbol-context'
import type { PlantSymbolId, SceneDesignObjectTarget, ScenePoint } from './scene'
import type { CameraViewportSnapshot, SceneBounds } from './camera'
import type { ScenePersistedState } from './scene'

export interface CanvasRuntimeDocumentMetadata {
  name: string
  description?: string | null
  location?: { lat: number; lon: number; altitude_m?: number | null } | null
  northBearingDeg?: number | null
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
  zoomToFit(): void
}

export interface CanvasHistoryCommandSurface {
  readonly canUndo: ReadonlySignal<boolean>
  readonly canRedo: ReadonlySignal<boolean>
  undo(): void
  redo(): void
}

export interface CanvasSceneEditCommandSurface {
  saveSelectionAsObjectStamp(): void
  copy(): void
  paste(): void
  pasteAt(point: ScenePoint): void
  canPaste(): boolean
  duplicateSelected(): void
  toggleSelectedPlantNamePins(): void
  deleteSelected(): void
  selectAll(): void
  selectSameSpecies(canonicalName?: string, options?: { additive?: boolean }): void
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
  readonly tools: CanvasToolCommandSurface
  readonly viewport: CanvasViewportCommandSurface
  readonly history: CanvasHistoryCommandSurface
  readonly sceneEdits: CanvasSceneEditCommandSurface
  readonly chrome: CanvasChromeCommandSurface
  readonly layers: CanvasLayerCommandSurface
  readonly plantPresentation: CanvasPlantPresentationCommandSurface
}

export interface CanvasQuerySurface {
  readonly revision: CanvasQueryRevision
  readonly viewport: ReadonlySignal<CameraViewportSnapshot>
  getSceneSnapshot(): ScenePersistedState
  getSelection(): SceneDesignObjectTarget[]
  getDesignObjectSelection(): CanvasDesignObjectSelectionModel
  getSelectedPlantColorContext(): SelectedPlantColorContext
  getSelectedPlantSymbolContext(): SelectedPlantSymbolContext
  getPlacedPlants(): PlacedPlant[]
  getSettledPlacedPlants(): PlacedPlant[] | null
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

export interface CanvasRuntimeHost {
  readonly surfaces: CanvasRuntimeSurfaces
  init(container: HTMLElement): Promise<void>
  destroy(): void
}
