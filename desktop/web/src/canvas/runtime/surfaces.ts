import type {
  CanvasChromeCommandSurface,
  CanvasCommandSurface,
  CanvasDocumentSurface,
  CanvasHistoryCommandSurface,
  CanvasLayerCommandSurface,
  CanvasPlantPresentationCommandSurface,
  CanvasQuerySurface,
  CanvasRuntimeSurfaces,
  CanvasSceneEditCommandSurface,
  CanvasToolCommandSurface,
  CanvasViewportCommandSurface,
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
  readonly tools: CanvasToolCommandSurface
  readonly viewport: CanvasViewportCommandSurface
  readonly history: CanvasHistoryCommandSurface
  readonly sceneEdits: CanvasSceneEditCommandSurface
  readonly chrome: CanvasChromeCommandSurface
  readonly layers: CanvasLayerCommandSurface
  readonly plantPresentation: CanvasPlantPresentationCommandSurface

  constructor(runtime: SceneCanvasRuntime) {
    this.tools = {
      setTool: (name) => runtime.setTool(name),
    }
    this.viewport = {
      zoomIn: () => runtime.zoomIn(),
      zoomOut: () => runtime.zoomOut(),
      zoomToFit: () => runtime.zoomToFit(),
    }
    this.history = {
      get canUndo() { return runtime.canUndo },
      get canRedo() { return runtime.canRedo },
      undo: () => runtime.undo(),
      redo: () => runtime.redo(),
    }
    this.sceneEdits = {
      copy: () => runtime.copy(),
      paste: () => runtime.paste(),
      duplicateSelected: () => runtime.duplicateSelected(),
      deleteSelected: () => runtime.deleteSelected(),
      selectAll: () => runtime.selectAll(),
      bringToFront: () => runtime.bringToFront(),
      sendToBack: () => runtime.sendToBack(),
      lockSelected: () => runtime.lockSelected(),
      unlockSelected: () => runtime.unlockSelected(),
      groupSelected: () => runtime.groupSelected(),
      ungroupSelected: () => runtime.ungroupSelected(),
    }
    this.chrome = {
      toggleGrid: () => runtime.toggleGrid(),
      toggleSnapToGrid: () => runtime.toggleSnapToGrid(),
      toggleRulers: () => runtime.toggleRulers(),
    }
    this.layers = {
      setSceneLayerVisibility: (name, visible) => runtime.setSceneLayerVisibility(name, visible),
      setSceneLayerOpacity: (name, opacity) => runtime.setSceneLayerOpacity(name, opacity),
      setSceneLayerLocked: (name, locked) => runtime.setSceneLayerLocked(name, locked),
    }
    this.plantPresentation = {
      setPlantSizeMode: (mode) => runtime.setPlantSizeMode(mode),
      setPlantColorByAttr: (attr) => runtime.setPlantColorByAttr(attr),
      ensureSpeciesCacheEntries: (canonicalNames, activeLocale) =>
        runtime.ensureSpeciesCacheEntries(canonicalNames, activeLocale),
      setSelectedPlantColor: (color) => runtime.setSelectedPlantColor(color),
      setPlantColorForSpecies: (canonicalName, color) =>
        runtime.setPlantColorForSpecies(canonicalName, color),
      clearPlantSpeciesColor: (canonicalName) => runtime.clearPlantSpeciesColor(canonicalName),
    }
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
