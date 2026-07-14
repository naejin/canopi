import { signal } from '@preact/signals'
import { setCanvasTool } from '../../canvas/session-state'
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
      saveSelectionAsObjectStamp: () => {},
      copy: () => {},
      paste: () => {},
      pasteAt: () => {},
      canPaste: () => false,
      duplicateSelected: () => {},
      toggleSelectedPlantNamePins: () => {},
      deleteSelected: () => {},
      selectAll: () => {},
      selectSameSpecies: () => {},
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
      ensureSpeciesCacheEntries: async () => true,
      setSelectedPlantColor: () => 0,
      setSelectedPlantSymbol: () => 0,
      setPlantColorForSpecies: () => 0,
      setPlantSymbolForSpecies: () => 0,
      clearPlantSpeciesColor: () => false,
      clearPlantSpeciesSymbol: () => false,
    },
  }

  const setTool = overrides.tools?.setTool ?? surface.tools.setTool
  return {
    tools: {
      ...surface.tools,
      ...overrides.tools,
      setTool: (name) => {
        setTool(name)
        setCanvasTool(name)
      },
    },
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
    replaceDocument: (_file, _token, finalizeReplacement) => {
      finalizeReplacement()
      return { callerFinalizerInvoked: true }
    },
    hasLoadedDocument: () => false,
    serializeDocument: (metadata, doc) => ({ ...doc, name: metadata.name }),
    markSaved: () => {},
    resize: () => {},
    destroy: () => {},
  }

  return { ...surface, ...overrides }
}
