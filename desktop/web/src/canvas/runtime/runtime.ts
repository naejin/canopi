import type { ReadonlySignal } from '@preact/signals'
import type { CanopiFile, PlacedPlant } from '../../types/design'
import type { ColorByAttribute, PlantSizeMode } from '../plant-display-state'
import type { SelectedPlantColorContext } from '../plant-color-context'
import type { SelectedPlantSymbolContext } from '../plant-symbol-context'
import type { PlantSymbolId } from './scene'
import type { SceneBounds } from './camera'
import type { ScenePersistedState, SceneViewportState } from './scene'

export interface CanvasRuntimeDocumentMetadata {
  name: string
  description?: string | null
  location?: { lat: number; lon: number; altitude_m?: number | null } | null
  northBearingDeg?: number | null
}

export type CanvasDesignObjectSelectionTarget =
  | { kind: 'plant'; id: string }
  | { kind: 'zone'; id: string }
  | { kind: 'annotation'; id: string }
  | { kind: 'group'; id: string }

export type CanvasDesignObjectSelectionMissingTarget = { kind: 'missing'; id: string }

export type CanvasDesignObjectSelectionBlockReason =
  | 'grouped-member'
  | 'hidden-layer'
  | 'locked-layer'
  | 'locked-design-object'
  | 'missing-design-object'

export interface CanvasDesignObjectSelectionBlockedTarget {
  readonly target: CanvasDesignObjectSelectionTarget | CanvasDesignObjectSelectionMissingTarget
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
}

export interface CanvasQueryRevision {
  readonly scene: ReadonlySignal<number>
  readonly plantNames: ReadonlySignal<number>
  readonly viewport: ReadonlySignal<number>
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
  copy(): void
  paste(): void
  duplicateSelected(): void
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
  setPlantSizeMode(mode: PlantSizeMode): void
  setPlantColorByAttr(attr: ColorByAttribute | null): void
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
  getSceneSnapshot(): ScenePersistedState
  getViewport(): SceneViewportState
  getViewportScreenSize(): { width: number; height: number }
  readonly viewportRevision: ReadonlySignal<number>
  getSelection(): Set<string>
  getDesignObjectSelection(): CanvasDesignObjectSelectionModel
  getPlantSizeMode(): PlantSizeMode
  getPlantColorByAttr(): ColorByAttribute | null
  getSelectedPlantColorContext(): SelectedPlantColorContext
  getSelectedPlantSymbolContext(): SelectedPlantSymbolContext
  getPlacedPlants(): PlacedPlant[]
  getLocalizedCommonNames(): ReadonlyMap<string, string | null>
}

export interface CanvasDocumentSurface {
  initializeViewport(): void
  attachRulersTo(element: HTMLElement): void
  showCanvasChrome(): void
  hideCanvasChrome(): void
  zoomToFit(): void
  loadDocument(file: CanopiFile): void
  replaceDocument(file: CanopiFile): void
  hasLoadedDocument(): boolean
  serializeDocument(metadata: CanvasRuntimeDocumentMetadata, doc: CanopiFile): CanopiFile
  markSaved(): void
  clearHistory(): void
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
