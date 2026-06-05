import { signal } from '@preact/signals'
import type {
  CanvasCommandSurface,
  CanvasDocumentSurface,
  CanvasQuerySurface,
  CanvasRuntimeSurfaces,
} from '../../canvas/runtime/runtime'
import { createTestCanvasQuerySurface } from './canvas-query-surface'

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
  overrides: Partial<CanvasCommandSurface> = {},
): CanvasCommandSurface {
  const surface: CanvasCommandSurface = {
    setTool: () => {},
    zoomIn: () => {},
    zoomOut: () => {},
    zoomToFit: () => {},
    canUndo: signal(false),
    canRedo: signal(false),
    undo: () => {},
    redo: () => {},
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
    toggleGrid: () => {},
    toggleSnapToGrid: () => {},
    toggleRulers: () => {},
    setSceneLayerVisibility: () => false,
    setSceneLayerOpacity: () => false,
    setSceneLayerLocked: () => false,
    setPlantSizeMode: () => {},
    setPlantColorByAttr: () => {},
    ensureSpeciesCacheEntries: async () => true,
    setSelectedPlantColor: () => 0,
    setPlantColorForSpecies: () => 0,
    clearPlantSpeciesColor: () => false,
  }

  return { ...surface, ...overrides }
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
