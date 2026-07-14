import { readFileSync } from 'node:fs'
import { signal } from '@preact/signals'
import { afterEach, describe, expect, it } from 'vitest'
import {
  currentCanvasCommandSurface,
  currentCanvasDocumentSurface,
  currentCanvasQuerySurface,
  getCurrentCanvasTool,
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
import { createCanvasDocumentReplacementToken } from '../canvas/runtime/runtime'

function createQuerySurface() {
  return {
    revision: { scene: signal(0), plantNames: signal(0), viewport: signal(0) },
    getSceneSnapshot: () => createDefaultScenePersistedState(),
    getViewport: () => ({ x: 0, y: 0, scale: 1 }),
    getViewportScreenSize: () => ({ width: 400, height: 300 }),
    viewportRevision: signal(0),
    getSelection: () => new Set<string>(),
    getDesignObjectSelection: () => ({
      editableTargets: [],
      lockedTargets: [],
      blockedTargets: [],
      bounds: null,
      sameSpeciesReferenceCanonicalName: null,
    }),
    getSelectedPlantColorContext: () => ({
      plantIds: [],
      singleSpeciesCanonicalName: null,
      singleSpeciesCommonName: null,
      sharedCurrentColor: null,
      suggestedColor: null,
      singleSpeciesDefaultColor: null,
    }),
    getSelectedPlantSymbolContext: () => ({
      plantIds: [],
      singleSpeciesCanonicalName: null,
      singleSpeciesCommonName: null,
      sharedCurrentSymbol: null,
      sharedEffectiveSymbol: 'round',
      inheritedSymbol: null,
      singleSpeciesDefaultSymbol: null,
      canClearSelectedSymbol: false,
    }),
    getPlacedPlants: () => [],
    getSettledPlacedPlants: () => [],
    getLocalizedCommonNames: () => new Map<string, string | null>(),
  } satisfies CanvasQuerySurface
}

function createCommandSurface() {
  return {
    tools: {
      setTool: (_name: string) => {},
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
    replaceDocument: (_file, _token, finalizeReplacement: () => void) => {
      finalizeReplacement()
      return { callerFinalizerInvoked: true }
    },
    hasLoadedDocument: () => false,
    serializeDocument: (metadata, doc) => ({ ...doc, name: metadata.name }),
    markSaved: () => {},
    resize: () => {},
    destroy: () => {},
  } satisfies CanvasDocumentSurface
}

function readPackageSource(path: string): string {
  const sourcePath = new URL(path, import.meta.url).pathname
  return readFileSync(sourcePath.startsWith('/src/') ? `.${sourcePath}` : sourcePath, 'utf8')
}

describe('canvas runtime surfaces', () => {
  afterEach(() => {
    setCurrentCanvasSession(null)
  })

  it('composes internal role modules behind the public runtime surface factory', () => {
    const surfacesSource = readPackageSource('../canvas/runtime/surfaces.ts')

    expect(surfacesSource).toContain('commands: runtime.commandSurface')
    expect(surfacesSource).toContain('queries: runtime.querySurface')
    expect(surfacesSource).toContain('documents: runtime.documentSurface')
    expect(surfacesSource).not.toContain('?? runtime')
    expect(surfacesSource).not.toContain('maybeRuntime')
    expect(surfacesSource).not.toContain('as SceneCanvasRuntime &')
    expect(surfacesSource).not.toContain('class SceneCanvasCommandAdapter')
    expect(surfacesSource).not.toContain('class SceneCanvasQueryAdapter')
    expect(surfacesSource).not.toContain('class SceneCanvasDocumentAdapter')
  })

  it('keeps document lifecycle behavior inside the document role module', () => {
    const documentSurfaceSource = readPackageSource('../canvas/runtime/document-surface.ts')
    const runtimeSource = readPackageSource('../canvas/runtime/scene-runtime.ts')
    const runtimeContractSource = readPackageSource('../canvas/runtime/runtime.ts')

    expect(documentSurfaceSource).not.toContain("from './scene-runtime'")
    expect(documentSurfaceSource).not.toContain('this.runtime.')
    expect(documentSurfaceSource).toContain('loadDocument(file')
    expect(documentSurfaceSource).toContain('replaceDocument(file')
    expect(runtimeContractSource).toContain('export interface CanvasDocumentReplacementReceipt')
    expect(runtimeContractSource).toContain('token: CanvasDocumentReplacementToken,')
    expect(runtimeContractSource).toContain('finalizeReplacement: () => void,')
    expect(runtimeContractSource).toContain('): CanvasDocumentReplacementReceipt')
    expect(documentSurfaceSource).toContain('finalizeReplacement: () => void,')
    expect(documentSurfaceSource).toContain('): CanvasDocumentReplacementReceipt {')
    expect(documentSurfaceSource).not.toContain('finalizeReplacement?:')
    expect(documentSurfaceSource).toContain('serializeDocument(')
    expect(documentSurfaceSource).not.toContain('clearHistory')
    expect(runtimeContractSource).not.toContain('clearHistory(): void')
    expect(documentSurfaceSource).toContain('resize(width')
    expect(runtimeSource).toContain('get documentSurface')
    expect(runtimeSource).not.toContain('loadDocument(file')
    expect(runtimeSource).not.toContain('replaceDocument(file')
    expect(runtimeSource).not.toContain('serializeDocument(metadata')
    expect(runtimeSource).not.toContain('markSaved():')
    expect(runtimeSource).not.toContain('clearHistory():')
    expect(runtimeSource).not.toContain('resize(width')
    expect(runtimeSource).not.toContain('this._documents.loadDocument(file)')
    expect(runtimeSource).not.toContain('this._documents.replaceDocument(file)')
    expect(runtimeSource).not.toContain('this._documents.serializeDocument(metadata, doc)')
  })

  it('keeps query read behavior inside the query role module', () => {
    const querySurfaceSource = readPackageSource('../canvas/runtime/query-surface.ts')
    const runtimeSource = readPackageSource('../canvas/runtime/scene-runtime.ts')

    expect(querySurfaceSource).not.toContain("from './scene-runtime'")
    expect(querySurfaceSource).not.toContain('this.runtime.')
    expect(querySurfaceSource).toContain('getSceneSnapshot()')
    expect(querySurfaceSource).toContain('getViewport()')
    expect(querySurfaceSource).toContain('getSelection()')
    expect(querySurfaceSource).toContain('getPlacedPlants()')
    expect(querySurfaceSource).toContain('SettledSceneReader')
    expect(querySurfaceSource).toContain('.readWhenSettled(')
    expect(querySurfaceSource).not.toContain('SceneCommandAdmission')
    expect(querySurfaceSource).not.toContain('.runWhenSettled(')
    expect(querySurfaceSource).not.toContain('resumePending')
    expect(runtimeSource).toContain('get querySurface')
    expect(runtimeSource).not.toContain('getSceneStore():')
    expect(runtimeSource).not.toContain('getSceneSnapshot():')
    expect(runtimeSource).not.toContain('getViewport()')
    expect(runtimeSource).not.toContain('getViewportScreenSize():')
    expect(runtimeSource).not.toContain('getSelection():')
    expect(runtimeSource).not.toContain('return this._sceneStore.persisted')
    expect(runtimeSource).not.toContain('return this._camera.viewport')
    expect(runtimeSource).not.toContain('return new Set(this._sceneStore.session.selectedEntityIds)')
    expect(runtimeSource).not.toContain('return this._sceneStore.toCanopiFile().plants')
  })

  it('keeps computed command availability on the observational settled-read role', () => {
    const commandSurfaceSource = readPackageSource('../canvas/runtime/command-surface.ts')
    const mutationsSource = readPackageSource('../canvas/runtime/scene-runtime/mutations.ts')
    const interactionSource = readPackageSource('../canvas/runtime/scene-interaction.ts')
    const canUndoSource = commandSurfaceSource.slice(
      commandSurfaceSource.indexOf('const canUndo = computed'),
      commandSurfaceSource.indexOf('const canRedo = computed'),
    )
    const canRedoSource = commandSurfaceSource.slice(
      commandSurfaceSource.indexOf('const canRedo = computed'),
      commandSurfaceSource.indexOf('this.tools ='),
    )

    expect(commandSurfaceSource).toContain('settledReader: SettledSceneReader')
    for (const historyAvailabilitySource of [canUndoSource, canRedoSource]) {
      expect(historyAvailabilitySource).toContain('options.settledReader.readWhenSettled(')
      expect(historyAvailabilitySource).not.toContain('commandAdmission')
      expect(historyAvailabilitySource).not.toContain('runWhenSettled')
      expect(historyAvailabilitySource).not.toContain('resumePending')
    }
    expect(mutationsSource).toContain('settledReader: SettledSceneReader')
    expect(mutationsSource).toContain('this._settledReader.readWhenSettled(')
    expect(interactionSource).toContain('settledReader: SettledSceneReader')
    expect(interactionSource).toContain('this._deps.settledReader.readWhenSettled(')
  })

  it('keeps command mutation behavior inside the command role module', () => {
    const commandSurfaceSource = readPackageSource('../canvas/runtime/command-surface.ts')
    const runtimeSource = readPackageSource('../canvas/runtime/scene-runtime.ts')

    expect(commandSurfaceSource).not.toContain("from './scene-runtime'")
    expect(commandSurfaceSource).not.toContain('runtime.')
    expect(commandSurfaceSource).toContain('setTool(name')
    expect(commandSurfaceSource).toContain('zoomIn()')
    expect(commandSurfaceSource).toContain('undo()')
    expect(commandSurfaceSource).toContain('setSceneLayerVisibility')
    expect(commandSurfaceSource).toContain('ensureSpeciesCacheEntries')
    expect(runtimeSource).toContain('get commandSurface')
    expect(runtimeSource).not.toContain('setTool(name: string)')
    expect(runtimeSource).not.toContain('zoomIn():')
    expect(runtimeSource).not.toContain('undo():')
    expect(runtimeSource).not.toContain('copy():')
    expect(runtimeSource).not.toContain('selectAll():')
    expect(runtimeSource).not.toContain('setPlantColorForSpecies(canonicalName')
    expect(runtimeSource).not.toContain('this._mutations.copy()')
    expect(runtimeSource).not.toContain('this._history.undo(this._documents.historyRuntime())')
    expect(runtimeSource).not.toContain('return this._setSceneLayerState(name, { visible })')
  })

  it('keeps runtime construction wiring behind the construction module', () => {
    const runtimeSource = readPackageSource('../canvas/runtime/scene-runtime.ts')
    const constructionSource = readPackageSource('../canvas/runtime/scene-runtime/construction.ts')

    expect(runtimeSource).toContain("from './scene-runtime/construction'")
    expect(constructionSource).toContain('createSceneRuntimeConstruction')
    expect(constructionSource).toContain('new SceneStore()')
    expect(constructionSource).toContain('new CameraController()')
    expect(constructionSource).toContain('new SceneRuntimeDocumentBridge')
    expect(constructionSource).toContain('new SceneRuntimeEditCoordinator')
    expect(constructionSource).toContain('createSceneCanvasCommandSurface')
    expect(constructionSource).toContain('createSceneCanvasQuerySurface')
    expect(constructionSource).toContain('createSceneCanvasDocumentSurface')
    expect(runtimeSource).not.toContain('createSceneCanvasCommandSurface({')
    expect(runtimeSource).not.toContain('createSceneCanvasQuerySurface({')
    expect(runtimeSource).not.toContain('createSceneCanvasDocumentSurface({')
    expect(runtimeSource).not.toContain('new SceneRuntimeDocumentBridge({')
    expect(runtimeSource).not.toContain('new SceneRuntimeEditCoordinator({')
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

  it('routes representative command, query, and document behavior through role surfaces', () => {
    const runtime = new SceneCanvasRuntime()
    const surfaces = createCanvasRuntimeSurfaces(runtime)
    const file = serializeScenePersistedState(createDefaultScenePersistedState())

    try {
      surfaces.commands.tools.setTool('hand')
      surfaces.documents.loadDocument(file)

      expect(getCurrentCanvasTool()).toBe('hand')
      expect(surfaces.documents.hasLoadedDocument()).toBe(true)
      expect(surfaces.queries.getSceneSnapshot()).toEqual(createDefaultScenePersistedState())
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

    commandSurface.tools.setTool('hand')
    expect(commandSurface.history.canUndo.value).toBe(false)
    // @ts-expect-error command surfaces do not expose flat tool commands.
    commandSurface.setTool
    // @ts-expect-error command surfaces cannot read scene snapshots.
    commandSurface.getSceneSnapshot
    // @ts-expect-error command surfaces cannot serialize documents.
    commandSurface.serializeDocument
  })

  it('keeps document consumers away from panel queries and toolbar commands', () => {
    const documentSurface = createDocumentSurface()
    const file = serializeScenePersistedState(createDefaultScenePersistedState())
    const replacementToken = createCanvasDocumentReplacementToken()

    if (false) {
      // @ts-expect-error document replacement requires a pre-release finalizer.
      documentSurface.replaceDocument(file, replacementToken)
    }
    documentSurface.replaceDocument(file, replacementToken, () => {})
    expect(documentSurface.serializeDocument({ name: 'Doc' }, file).name).toBe('Doc')
    // @ts-expect-error document surfaces cannot read placed plant lists.
    documentSurface.getPlacedPlants
    // @ts-expect-error document surfaces cannot issue tool commands.
    documentSurface.setTool
  })

  it('reports whether a runtime has loaded a document without caller monkey-patching', () => {
    const runtime = new SceneCanvasRuntime()
    const surfaces = createCanvasRuntimeSurfaces(runtime)
    const file = serializeScenePersistedState(createDefaultScenePersistedState())

    try {
      expect(surfaces.documents.hasLoadedDocument()).toBe(false)
      surfaces.documents.loadDocument(file)
      expect(surfaces.documents.hasLoadedDocument()).toBe(true)
    } finally {
      runtime.destroy()
    }
  })
})
