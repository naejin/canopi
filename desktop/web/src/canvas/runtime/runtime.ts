import type { ReadonlySignal } from '@preact/signals'
import type { CanopiFile, PlacedPlant } from '../../types/design'
import type { ColorByAttribute, PlantSizeMode } from '../plant-display-state'
import type { SelectedPlantColorContext } from '../plant-color-context'
import type { SceneStore } from './scene'
import type { SceneViewportState } from './scene'

export interface CanvasRuntimeDocumentMetadata {
  name: string
  description?: string | null
  location?: { lat: number; lon: number; altitude_m?: number | null } | null
  northBearingDeg?: number | null
}

export interface CanvasRuntime {
  getSceneStore(): SceneStore
  getViewport(): SceneViewportState
  getViewportScreenSize(): { width: number; height: number }
  readonly viewportRevision: ReadonlySignal<number>
  getSelection(): Set<string>
  setSelection(ids: Iterable<string>): void
  clearSelection(): void
  initializeViewport(): void
  attachRulersTo(element: HTMLElement): void
  showCanvasChrome(): void
  hideCanvasChrome(): void
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
  getPlantSizeMode(): PlantSizeMode
  setPlantSizeMode(mode: PlantSizeMode): void
  getPlantColorByAttr(): ColorByAttribute | null
  setPlantColorByAttr(attr: ColorByAttribute | null): void
  getSelectedPlantColorContext(): SelectedPlantColorContext
  getPlacedPlants(): PlacedPlant[]
  getLocalizedCommonNames(): ReadonlyMap<string, string | null>
  ensureSpeciesCacheEntries(canonicalNames: string[], activeLocale: string): Promise<boolean>
  setSelectedPlantColor(color: string | null): number
  setPlantColorForSpecies(canonicalName: string, color: string | null): number
  clearPlantSpeciesColor(canonicalName: string): boolean
  loadDocument(file: CanopiFile): void
  replaceDocument(file: CanopiFile): void
  serializeDocument(metadata: CanvasRuntimeDocumentMetadata, doc: CanopiFile): CanopiFile
  markSaved(): void
  clearHistory(): void
  destroy(): void
}
