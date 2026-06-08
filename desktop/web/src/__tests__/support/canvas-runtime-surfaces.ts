import { signal } from '@preact/signals'
import type {
  CanvasCommandSurface,
  CanvasDocumentSurface,
  CanvasQuerySurface,
  CanvasRuntimeSurfaces,
} from '../../canvas/runtime/runtime'
import { createTestCanvasQuerySurface } from './canvas-query-surface'

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K]
}

interface TestCanvasRuntimeSurfaceOptions {
  readonly commands?: CanvasCommandSurface
  readonly queries?: CanvasQuerySurface
  readonly documents?: CanvasDocumentSurface
}

export function createTestCanvasRuntimeSurfaces({
  commands = createTestCanvasCommandSurface(),
  queries = createTestCanvasQuerySurface(),
  documents = createTestCanvasDocumentSurface(),
}: TestCanvasRuntimeSurfaceOptions = {}): CanvasRuntimeSurfaces {
  return { commands, queries, documents }
}

export function createTestCanvasCommandSurface(
  overrides: DeepPartial<CanvasCommandSurface> = {},
): CanvasCommandSurface {
  const surface: CanvasCommandSurface = {
    tools: {
      setTool: () => {},
    },
    viewport: {
      zoomIn: () => {},
      zoomOut: () => {},
      zoomToFit: () => {},
    },
    history: {
      canUndo: signal(false),
      canRedo: signal(false),
      undo: () => {},
      redo: () => {},
    },
    sceneEdits: {
      copy: () => {},
      paste: () => {},
      duplicateSelected: () => {},
      deleteSelected: () => {},
      selectAll: () => {},
      bringToFront: () => {},
      sendToBack: () => {},
      lockSelected: () => {},
      unlockSelected: () => {},
      groupSelected: () => {},
      ungroupSelected: () => {},
    },
    chrome: {
      toggleGrid: () => {},
      toggleSnapToGrid: () => {},
      toggleRulers: () => {},
    },
    layers: {
      setSceneLayerVisibility: () => false,
      setSceneLayerOpacity: () => false,
      setSceneLayerLocked: () => false,
    },
    plantPresentation: {
      setPlantSizeMode: () => {},
      setPlantColorByAttr: () => {},
      ensureSpeciesCacheEntries: async () => true,
      setSelectedPlantColor: () => 0,
      setPlantColorForSpecies: () => 0,
      clearPlantSpeciesColor: () => false,
    },
  }

  return {
    tools: { ...surface.tools, ...overrides.tools },
    viewport: { ...surface.viewport, ...overrides.viewport },
    history: { ...surface.history, ...overrides.history },
    sceneEdits: { ...surface.sceneEdits, ...overrides.sceneEdits },
    chrome: { ...surface.chrome, ...overrides.chrome },
    layers: { ...surface.layers, ...overrides.layers },
    plantPresentation: { ...surface.plantPresentation, ...overrides.plantPresentation },
  }
}

export function createTestCanvasDocumentSurface(
  overrides: Partial<CanvasDocumentSurface> = {},
): CanvasDocumentSurface {
  const surface: CanvasDocumentSurface = {
    initializeViewport: () => {},
    attachRulersTo: () => {},
    showCanvasChrome: () => {},
    hideCanvasChrome: () => {},
    zoomToFit: () => {},
    loadDocument: () => {},
    replaceDocument: () => {},
    hasLoadedDocument: () => false,
    serializeDocument: (metadata, doc) => ({ ...doc, name: metadata.name }),
    markSaved: () => {},
    clearHistory: () => {},
    resize: () => {},
    destroy: () => {},
  }

  return { ...surface, ...overrides }
}
