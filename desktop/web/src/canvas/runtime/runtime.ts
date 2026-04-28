import type { ReadonlySignal } from '@preact/signals'
import type { CanopiFile, PlacedPlant } from '../../types/design'
import type { ColorByAttribute, PlantSizeMode } from '../plant-display-state'
import type { SelectedPlantColorContext } from '../plant-color-context'
import type { ScenePersistedState, SceneViewportState } from './scene'

export interface CanvasRuntimeDocumentMetadata {
  name: string
  description?: string | null
  location?: { lat: number; lon: number; altitude_m?: number | null } | null
  northBearingDeg?: number | null
}

export interface CanvasCommandSurface {
  setTool(name: string): void
  zoomIn(): void
  zoomOut(): void
  zoomToFit(): void
  readonly canUndo: ReadonlySignal<boolean>
  readonly canRedo: ReadonlySignal<boolean>
  undo(): void
  redo(): void
  copy(): void
  paste(): void
  duplicateSelected(): void
  deleteSelected(): void
  selectAll(): void
  bringToFront(): void
  sendToBack(): void
  lockSelected(): void
  unlockSelected(): void
  groupSelected(): void
  ungroupSelected(): void
  toggleGrid(): void
  toggleSnapToGrid(): void
  toggleRulers(): void
  setPlantSizeMode(mode: PlantSizeMode): void
  setPlantColorByAttr(attr: ColorByAttribute | null): void
  ensureSpeciesCacheEntries(canonicalNames: string[], activeLocale: string): Promise<boolean>
  setSelectedPlantColor(color: string | null): number
  setPlantColorForSpecies(canonicalName: string, color: string | null): number
  clearPlantSpeciesColor(canonicalName: string): boolean
}

export interface CanvasQuerySurface {
  getSceneSnapshot(): ScenePersistedState
  getViewport(): SceneViewportState
  getViewportScreenSize(): { width: number; height: number }
  readonly viewportRevision: ReadonlySignal<number>
  getSelection(): Set<string>
  getPlantSizeMode(): PlantSizeMode
  getPlantColorByAttr(): ColorByAttribute | null
  getSelectedPlantColorContext(): SelectedPlantColorContext
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

export type MountedCanvasRuntime = CanvasCommandSurface & CanvasQuerySurface & CanvasDocumentSurface

export interface CanvasRuntimeSurfaces {
  readonly commands: CanvasCommandSurface
  readonly queries: CanvasQuerySurface
  readonly documents: CanvasDocumentSurface
}

export type CanvasRuntime = MountedCanvasRuntime
