import { signal } from '@preact/signals'
import { afterEach, describe, expect, it } from 'vitest'
import {
  currentCanvasCommandSurface,
  currentCanvasDocumentSurface,
  currentCanvasQuerySurface,
  setCanvasRuntimeSurfaces,
  setCurrentCanvasSession,
} from '../canvas/session'
import { SceneCanvasRuntime } from '../canvas/runtime/scene-runtime'
import { createCanvasRuntimeSurfaces } from '../canvas/runtime/surfaces'
import { createDefaultScenePersistedState, serializeScenePersistedState } from '../canvas/runtime/scene'
import type {
  CanvasCommandSurface,
  CanvasDocumentSurface,
  CanvasQuerySurface,
} from '../canvas/runtime/runtime'

function createQuerySurface() {
  return {
    revision: { scene: signal(0), plantNames: signal(0), viewport: signal(0) },
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
    setSceneLayerVisibility: () => false,
    setSceneLayerOpacity: () => false,
    setSceneLayerLocked: () => false,
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
    hasLoadedDocument: () => false,
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

  it('publishes explicit facades instead of the mounted runtime', () => {
    const runtime = new SceneCanvasRuntime()
    const surfaces = createCanvasRuntimeSurfaces(runtime)

    try {
      setCanvasRuntimeSurfaces(surfaces)

      expect(currentCanvasCommandSurface.value).toBe(surfaces.commands)
      expect(currentCanvasQuerySurface.value).toBe(surfaces.queries)
      expect(currentCanvasDocumentSurface.value).toBe(surfaces.documents)
      expect(currentCanvasCommandSurface.value).not.toBe(runtime)
      expect(currentCanvasQuerySurface.value).not.toBe(runtime)
      expect(currentCanvasDocumentSurface.value).not.toBe(runtime)
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

  it('reports whether a runtime has loaded a document without caller monkey-patching', () => {
    const runtime = new SceneCanvasRuntime()
    const file = serializeScenePersistedState(createDefaultScenePersistedState())

    try {
      expect(runtime.hasLoadedDocument()).toBe(false)
      runtime.loadDocument(file)
      expect(runtime.hasLoadedDocument()).toBe(true)
    } finally {
      runtime.destroy()
    }
  })
})
