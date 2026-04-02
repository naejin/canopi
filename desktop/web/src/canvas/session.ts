import { signal } from '@preact/signals'
import type { CanopiFile } from '../types/design'
import type { ColorByAttribute, PlantSizeMode } from '../state/canvas'
import type { SelectedPlantColorContext } from './plant-color-context'
import {
  canvasHasSelectionState,
  canvasReadyState,
  canvasSelectionState,
  canvasToolState,
  getCanvasTool,
  isCanvasReady,
  setCanvasReadyState,
  setCanvasTool,
} from './session-state'
import type { CanvasRuntime, CanvasRuntimeDocumentMetadata } from './runtime/runtime'

export class CanvasSession {
  constructor(private readonly _runtime: CanvasRuntime) {}

  isReady(): boolean {
    return isCanvasReady()
  }

  initializeViewport(): void {
    this._runtime.initializeViewport()
  }

  attachRulersTo(element: HTMLElement): void {
    this._runtime.attachRulersTo(element)
  }

  showCanvasChrome(): void {
    this._runtime.showCanvasChrome()
  }

  hideCanvasChrome(): void {
    this._runtime.hideCanvasChrome()
  }

  setTool(name: string): void {
    setCanvasTool(name)
    this._runtime.setTool(name)
  }

  getTool(): string {
    return getCanvasTool()
  }

  getSelection(): Set<string> {
    return this._runtime.getSelection()
  }

  setSelection(ids: Iterable<string>): void {
    this._runtime.setSelection(ids)
  }

  clearSelection(): void {
    this._runtime.clearSelection()
  }

  zoomIn(): void {
    this._runtime.zoomIn()
  }

  zoomOut(): void {
    this._runtime.zoomOut()
  }

  zoomToFit(): void {
    this._runtime.zoomToFit()
  }

  undo(): void {
    this._runtime.undo()
  }

  redo(): void {
    this._runtime.redo()
  }

  copy(): void {
    this._runtime.copy()
  }

  paste(): void {
    this._runtime.paste()
  }

  duplicateSelected(): void {
    this._runtime.duplicateSelected()
  }

  deleteSelected(): void {
    this._runtime.deleteSelected()
  }

  selectAll(): void {
    this._runtime.selectAll()
  }

  bringToFront(): void {
    this._runtime.bringToFront()
  }

  sendToBack(): void {
    this._runtime.sendToBack()
  }

  lockSelected(): void {
    this._runtime.lockSelected()
  }

  unlockSelected(): void {
    this._runtime.unlockSelected()
  }

  groupSelected(): void {
    this._runtime.groupSelected()
  }

  ungroupSelected(): void {
    this._runtime.ungroupSelected()
  }

  toggleGrid(): void {
    this._runtime.toggleGrid()
  }

  toggleSnapToGrid(): void {
    this._runtime.toggleSnapToGrid()
  }

  toggleRulers(): void {
    this._runtime.toggleRulers()
  }

  getPlantSizeMode(): PlantSizeMode {
    return this._runtime.getPlantSizeMode()
  }

  setPlantSizeMode(mode: PlantSizeMode): void {
    this._runtime.setPlantSizeMode(mode)
  }

  getPlantColorByAttr(): ColorByAttribute | null {
    return this._runtime.getPlantColorByAttr()
  }

  setPlantColorByAttr(attr: ColorByAttribute | null): void {
    this._runtime.setPlantColorByAttr(attr)
  }

  getSelectedPlantColorContext(): SelectedPlantColorContext {
    return this._runtime.getSelectedPlantColorContext()
  }

  getPlacedPlants() {
    return this._runtime.getPlacedPlants()
  }

  ensureSpeciesCacheEntries(canonicalNames: string[], activeLocale: string): Promise<boolean> {
    return this._runtime.ensureSpeciesCacheEntries(canonicalNames, activeLocale)
  }

  setSelectedPlantColor(color: string | null): number {
    return this._runtime.setSelectedPlantColor(color)
  }

  setPlantColorForSpecies(canonicalName: string, color: string | null): number {
    return this._runtime.setPlantColorForSpecies(canonicalName, color)
  }

  clearPlantSpeciesColor(canonicalName: string): boolean {
    return this._runtime.clearPlantSpeciesColor(canonicalName)
  }

  loadDocument(file: CanopiFile): void {
    this._runtime.loadDocument(file)
  }

  replaceDocument(file: CanopiFile): void {
    this._runtime.replaceDocument(file)
  }

  serializeDocument(
    metadata: CanvasRuntimeDocumentMetadata,
    doc: CanopiFile | null,
  ): CanopiFile {
    return this._runtime.serializeDocument(metadata, doc)
  }

  markSaved(): void {
    this._runtime.markSaved()
  }

  clearHistory(): void {
    this._runtime.clearHistory()
  }

  destroy(): void {
    this._runtime.destroy()
  }
}

export const currentCanvasSession = signal<CanvasSession | null>(null)
export const currentCanvasTool = canvasToolState
export const currentCanvasSelection = canvasSelectionState
export const currentCanvasHasSelection = canvasHasSelectionState
export const currentCanvasReady = canvasReadyState

export function getCurrentCanvasSession(): CanvasSession | null {
  return currentCanvasSession.value
}

export function setCurrentCanvasSession(session: CanvasSession | null): void {
  currentCanvasSession.value = session
  setCanvasReadyState(session !== null)
}

export function setCurrentCanvasTool(name: string): void {
  const session = currentCanvasSession.value
  if (session) {
    session.setTool(name)
    return
  }
  setCanvasTool(name)
}

export function getCurrentCanvasTool(): string {
  return getCanvasTool()
}
