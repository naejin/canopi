import { signal } from '@preact/signals'
import { afterEach, describe, expect, it } from 'vitest'
import {
  currentCanvasCommandSurface,
  currentCanvasDocumentSurface,
  currentCanvasQuerySurface,
  setCurrentCanvasSession,
} from '../canvas/session'
import { SceneCanvasRuntime } from '../canvas/runtime/scene-runtime'
import { createDefaultScenePersistedState, serializeScenePersistedState } from '../canvas/runtime/scene'
import type {
  CanvasCommandSurface,
  CanvasDocumentSurface,
  CanvasQuerySurface,
  MountedCanvasRuntime,
} from '../canvas/runtime/runtime'

function createQuerySurface() {
  return {
    getSceneSnapshot: () => createDefaultScenePersistedState(),
    getViewport: () => ({ x: 0, y: 0, scale: 1 }),
    getViewportScreenSize: () => ({ width: 400, height: 300 }),
    viewportRevision: signal(0),
    getSelection: () => new Set<string>(),
    getPlantSizeMode: () => 'default',
    getPlantColorByAttr: () => null,
    getSelectedPlantColorContext: () => ({
      plantIds: [],
      singleSpeciesCanonicalName: null,
      singleSpeciesCommonName: null,
      sharedCurrentColor: null,
      suggestedColor: null,
      singleSpeciesDefaultColor: null,
    }),
    getPlacedPlants: () => [],
    getLocalizedCommonNames: () => new Map<string, string | null>(),
  } satisfies CanvasQuerySurface
}

function createCommandSurface() {
  return {
    setTool: (_name: string) => {},
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
    setPlantSizeMode: () => {},
    setPlantColorByAttr: () => {},
    ensureSpeciesCacheEntries: async () => true,
    setSelectedPlantColor: () => 0,
    setPlantColorForSpecies: () => 0,
    clearPlantSpeciesColor: () => false,
  } satisfies CanvasCommandSurface
}

function createDocumentSurface() {
  return {
    initializeViewport: () => {},
    attachRulersTo: () => {},
    showCanvasChrome: () => {},
    hideCanvasChrome: () => {},
    zoomToFit: () => {},
    loadDocument: (_file) => {},
    replaceDocument: (_file) => {},
    serializeDocument: (metadata, doc) => ({ ...doc, name: metadata.name }),
    markSaved: () => {},
    clearHistory: () => {},
    resize: () => {},
    destroy: () => {},
  } satisfies CanvasDocumentSurface
}

describe('canvas runtime surfaces', () => {
  afterEach(() => {
    setCurrentCanvasSession(null)
  })

  it('publishes one mounted runtime through command, query, and document surfaces', () => {
    const runtime: MountedCanvasRuntime = new SceneCanvasRuntime()

    try {
      setCurrentCanvasSession(runtime)

      expect(currentCanvasCommandSurface.value).toBe(runtime)
      expect(currentCanvasQuerySurface.value).toBe(runtime)
      expect(currentCanvasDocumentSurface.value).toBe(runtime)
    } finally {
      runtime.destroy()
    }
  })

  it('keeps read-only query consumers away from commands and document lifecycle', () => {
    const querySurface = createQuerySurface()

    expect(querySurface.getSceneSnapshot().plants).toEqual([])
    expect(querySurface.getViewportScreenSize()).toEqual({ width: 400, height: 300 })
    // @ts-expect-error query surfaces cannot issue tool commands.
    querySurface.setTool
    // @ts-expect-error query surfaces cannot replace documents.
    querySurface.replaceDocument
  })

  it('keeps command consumers away from scene queries and document serialization', () => {
    const commandSurface = createCommandSurface()

    commandSurface.setTool('hand')
    expect(commandSurface.canUndo.value).toBe(false)
    // @ts-expect-error command surfaces cannot read scene snapshots.
    commandSurface.getSceneSnapshot
    // @ts-expect-error command surfaces cannot serialize documents.
    commandSurface.serializeDocument
  })

  it('keeps document consumers away from panel queries and toolbar commands', () => {
    const documentSurface = createDocumentSurface()
    const file = serializeScenePersistedState(createDefaultScenePersistedState())

    documentSurface.replaceDocument(file)
    expect(documentSurface.serializeDocument({ name: 'Doc' }, file).name).toBe('Doc')
    // @ts-expect-error document surfaces cannot read placed plant lists.
    documentSurface.getPlacedPlants
    // @ts-expect-error document surfaces cannot issue tool commands.
    documentSurface.setTool
  })
})
