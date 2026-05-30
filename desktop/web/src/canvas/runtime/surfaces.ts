import type {
  CanvasCommandSurface,
  CanvasDocumentSurface,
  CanvasQuerySurface,
  CanvasRuntimeSurfaces,
  MountedCanvasRuntime,
} from './runtime'

export function createCanvasRuntimeSurfaces(runtime: MountedCanvasRuntime): CanvasRuntimeSurfaces {
  const commands: CanvasCommandSurface = {
    setTool: (name) => runtime.setTool(name),
    zoomIn: () => runtime.zoomIn(),
    zoomOut: () => runtime.zoomOut(),
    zoomToFit: () => runtime.zoomToFit(),
    get canUndo() { return runtime.canUndo },
    get canRedo() { return runtime.canRedo },
    undo: () => runtime.undo(),
    redo: () => runtime.redo(),
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
    toggleGrid: () => runtime.toggleGrid(),
    toggleSnapToGrid: () => runtime.toggleSnapToGrid(),
    toggleRulers: () => runtime.toggleRulers(),
    setSceneLayerVisibility: (name, visible) => runtime.setSceneLayerVisibility(name, visible),
    setSceneLayerOpacity: (name, opacity) => runtime.setSceneLayerOpacity(name, opacity),
    setSceneLayerLocked: (name, locked) => runtime.setSceneLayerLocked(name, locked),
    setPlantSizeMode: (mode) => runtime.setPlantSizeMode(mode),
    setPlantColorByAttr: (attr) => runtime.setPlantColorByAttr(attr),
    ensureSpeciesCacheEntries: (canonicalNames, activeLocale) =>
      runtime.ensureSpeciesCacheEntries(canonicalNames, activeLocale),
    setSelectedPlantColor: (color) => runtime.setSelectedPlantColor(color),
    setPlantColorForSpecies: (canonicalName, color) => runtime.setPlantColorForSpecies(canonicalName, color),
    clearPlantSpeciesColor: (canonicalName) => runtime.clearPlantSpeciesColor(canonicalName),
  }

  const queries: CanvasQuerySurface = {
    getSceneSnapshot: () => runtime.getSceneSnapshot(),
    getViewport: () => runtime.getViewport(),
    getViewportScreenSize: () => runtime.getViewportScreenSize(),
    get viewportRevision() { return runtime.viewportRevision },
    getSelection: () => runtime.getSelection(),
    getPlantSizeMode: () => runtime.getPlantSizeMode(),
    getPlantColorByAttr: () => runtime.getPlantColorByAttr(),
    getSelectedPlantColorContext: () => runtime.getSelectedPlantColorContext(),
    getPlacedPlants: () => runtime.getPlacedPlants(),
    getLocalizedCommonNames: () => runtime.getLocalizedCommonNames(),
  }

  const documents: CanvasDocumentSurface = {
    initializeViewport: () => runtime.initializeViewport(),
    attachRulersTo: (element) => runtime.attachRulersTo(element),
    showCanvasChrome: () => runtime.showCanvasChrome(),
    hideCanvasChrome: () => runtime.hideCanvasChrome(),
    zoomToFit: () => runtime.zoomToFit(),
    loadDocument: (file) => runtime.loadDocument(file),
    replaceDocument: (file) => runtime.replaceDocument(file),
    hasLoadedDocument: () => runtime.hasLoadedDocument(),
    serializeDocument: (metadata, doc) => runtime.serializeDocument(metadata, doc),
    markSaved: () => runtime.markSaved(),
    clearHistory: () => runtime.clearHistory(),
    resize: (width, height) => runtime.resize(width, height),
    destroy: () => runtime.destroy(),
  }

  return { commands, queries, documents }
}
