import type {
  CanvasCommandSurface,
  CanvasDocumentSurface,
  CanvasQuerySurface,
  CanvasRuntimeSurfaces,
} from './runtime'
import type { SceneCanvasRuntime } from './scene-runtime'

export function createCanvasRuntimeSurfaces(runtime: SceneCanvasRuntime): CanvasRuntimeSurfaces {
  return {
    commands: new SceneCanvasCommandAdapter(runtime),
    queries: new SceneCanvasQueryAdapter(runtime),
    documents: new SceneCanvasDocumentAdapter(runtime),
  }
}

class SceneCanvasCommandAdapter implements CanvasCommandSurface {
  constructor(private readonly runtime: SceneCanvasRuntime) {}

  setTool(name: string): void { this.runtime.setTool(name) }
  zoomIn(): void { this.runtime.zoomIn() }
  zoomOut(): void { this.runtime.zoomOut() }
  zoomToFit(): void { this.runtime.zoomToFit() }
  get canUndo() { return this.runtime.canUndo }
  get canRedo() { return this.runtime.canRedo }
  undo(): void { this.runtime.undo() }
  redo(): void { this.runtime.redo() }
  copy(): void { this.runtime.copy() }
  paste(): void { this.runtime.paste() }
  duplicateSelected(): void { this.runtime.duplicateSelected() }
  deleteSelected(): void { this.runtime.deleteSelected() }
  selectAll(): void { this.runtime.selectAll() }
  bringToFront(): void { this.runtime.bringToFront() }
  sendToBack(): void { this.runtime.sendToBack() }
  lockSelected(): void { this.runtime.lockSelected() }
  unlockSelected(): void { this.runtime.unlockSelected() }
  groupSelected(): void { this.runtime.groupSelected() }
  ungroupSelected(): void { this.runtime.ungroupSelected() }
  toggleGrid(): void { this.runtime.toggleGrid() }
  toggleSnapToGrid(): void { this.runtime.toggleSnapToGrid() }
  toggleRulers(): void { this.runtime.toggleRulers() }
  setSceneLayerVisibility(name: string, visible: boolean): boolean {
    return this.runtime.setSceneLayerVisibility(name, visible)
  }
  setSceneLayerOpacity(name: string, opacity: number): boolean {
    return this.runtime.setSceneLayerOpacity(name, opacity)
  }
  setSceneLayerLocked(name: string, locked: boolean): boolean {
    return this.runtime.setSceneLayerLocked(name, locked)
  }
  setPlantSizeMode(mode: Parameters<CanvasCommandSurface['setPlantSizeMode']>[0]): void {
    this.runtime.setPlantSizeMode(mode)
  }
  setPlantColorByAttr(attr: Parameters<CanvasCommandSurface['setPlantColorByAttr']>[0]): void {
    this.runtime.setPlantColorByAttr(attr)
  }
  ensureSpeciesCacheEntries(canonicalNames: string[], activeLocale: string): Promise<boolean> {
    return this.runtime.ensureSpeciesCacheEntries(canonicalNames, activeLocale)
  }
  setSelectedPlantColor(color: string | null): number {
    return this.runtime.setSelectedPlantColor(color)
  }
  setPlantColorForSpecies(canonicalName: string, color: string | null): number {
    return this.runtime.setPlantColorForSpecies(canonicalName, color)
  }
  clearPlantSpeciesColor(canonicalName: string): boolean {
    return this.runtime.clearPlantSpeciesColor(canonicalName)
  }
}

class SceneCanvasQueryAdapter implements CanvasQuerySurface {
  constructor(private readonly runtime: SceneCanvasRuntime) {}

  get revision() { return this.runtime.revision }
  getSceneSnapshot() { return this.runtime.getSceneSnapshot() }
  getViewport() { return this.runtime.getViewport() }
  getViewportScreenSize() { return this.runtime.getViewportScreenSize() }
  get viewportRevision() { return this.runtime.viewportRevision }
  getSelection() { return this.runtime.getSelection() }
  getPlantSizeMode() { return this.runtime.getPlantSizeMode() }
  getPlantColorByAttr() { return this.runtime.getPlantColorByAttr() }
  getSelectedPlantColorContext() { return this.runtime.getSelectedPlantColorContext() }
  getPlacedPlants() { return this.runtime.getPlacedPlants() }
  getLocalizedCommonNames() { return this.runtime.getLocalizedCommonNames() }
}

class SceneCanvasDocumentAdapter implements CanvasDocumentSurface {
  constructor(private readonly runtime: SceneCanvasRuntime) {}

  initializeViewport(): void { this.runtime.initializeViewport() }
  attachRulersTo(element: HTMLElement): void { this.runtime.attachRulersTo(element) }
  showCanvasChrome(): void { this.runtime.showCanvasChrome() }
  hideCanvasChrome(): void { this.runtime.hideCanvasChrome() }
  zoomToFit(): void { this.runtime.zoomToFit() }
  loadDocument(file: Parameters<CanvasDocumentSurface['loadDocument']>[0]): void {
    this.runtime.loadDocument(file)
  }
  replaceDocument(file: Parameters<CanvasDocumentSurface['replaceDocument']>[0]): void {
    this.runtime.replaceDocument(file)
  }
  hasLoadedDocument(): boolean { return this.runtime.hasLoadedDocument() }
  serializeDocument(
    metadata: Parameters<CanvasDocumentSurface['serializeDocument']>[0],
    doc: Parameters<CanvasDocumentSurface['serializeDocument']>[1],
  ) {
    return this.runtime.serializeDocument(metadata, doc)
  }
  markSaved(): void { this.runtime.markSaved() }
  clearHistory(): void { this.runtime.clearHistory() }
  resize(width: number, height: number): void { this.runtime.resize(width, height) }
  destroy(): void { this.runtime.destroy() }
}
