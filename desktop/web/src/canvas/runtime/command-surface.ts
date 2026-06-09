import type {
  CanvasChromeCommandSurface,
  CanvasCommandSurface,
  CanvasHistoryCommandSurface,
  CanvasLayerCommandSurface,
  CanvasPlantPresentationCommandSurface,
  CanvasSceneEditCommandSurface,
  CanvasToolCommandSurface,
  CanvasViewportCommandSurface,
} from './runtime'
import type { SceneCanvasRuntime } from './scene-runtime'

export function createSceneCanvasCommandSurface(runtime: SceneCanvasRuntime): CanvasCommandSurface {
  return new SceneCanvasCommandRole(runtime)
}

class SceneCanvasCommandRole implements CanvasCommandSurface {
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
