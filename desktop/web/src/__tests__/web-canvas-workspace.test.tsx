import { signal } from '@preact/signals'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryDesignSessionStore } from '../app/document-session/store'
import { currentCanvasSession } from '../canvas/session'
import type {
  CanvasCommandSurface,
  CanvasDocumentSurface,
  CanvasQuerySurface,
  CanvasRuntimeHost,
  CanvasRuntimeSurfaces,
} from '../canvas/runtime/runtime'
import { createDefaultScenePersistedState } from '../canvas/runtime/scene'
import { createBrowserAppDataStore, type BrowserStorageAdapter } from '../web/browser-app-data'
import { createBrowserDesignSessionController } from '../web/browser-design-session'
import { WebCanvasWorkspace } from '../web/WebCanvasWorkspace'

describe('Web Edition canvas workspace', () => {
  let container: HTMLDivElement

  afterEach(() => {
    render(null, container)
    container?.remove()
    currentCanvasSession.value = null
  })

  it('mounts the shared canvas runtime surface without deferred desktop panels', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    const store = createMemoryDesignSessionStore()
    const controller = createBrowserDesignSessionController({
      store,
      appDataStore: createBrowserAppDataStore({ storage: memoryStorage() }),
      now: () => new Date('2026-07-04T12:00:00.000Z'),
    })
    const runtime = fakeRuntimeHost()

    await controller.newDesign()
    await act(async () => {
      render(
        <WebCanvasWorkspace
          controller={controller}
          store={store}
          createRuntimeHost={() => runtime.host}
        />,
        container,
      )
    })

    expect(runtime.host.init).toHaveBeenCalledOnce()
    expect(runtime.documents.loadDocument).toHaveBeenCalledWith(expect.objectContaining({ name: 'Untitled' }))
    expect(runtime.documents.showCanvasChrome).toHaveBeenCalled()
    expect(currentCanvasSession.value).toBe(runtime.host.surfaces)
    expect(container.querySelector('[data-testid="web-canvas-workspace"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="web-canvas-runtime-host"]')).not.toBeNull()
    expect(container.textContent).not.toContain('Timeline')
    expect(container.textContent).not.toContain('Budget')
    expect(container.textContent).not.toContain('Consortium')
    expect(container.textContent).not.toContain('Display')
    expect(container.textContent).not.toContain('Color by')
    expect(container.textContent).not.toContain('Design Notebook')
    expect(container.textContent).not.toContain('Problem Report')
  })
})

interface MemoryStorage extends BrowserStorageAdapter {
  failWrites: boolean
}

function memoryStorage(): MemoryStorage {
  const values = new Map<string, string>()
  return {
    failWrites: false,
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) {
      if (this.failWrites) throw new Error('storage unavailable')
      values.set(key, value)
    },
    removeItem: (key) => {
      values.delete(key)
    },
  }
}

function fakeRuntimeHost(): {
  host: CanvasRuntimeHost
  documents: CanvasDocumentSurface
} {
  let loaded = false
  const documents: CanvasDocumentSurface = {
    initializeViewport: vi.fn(),
    attachRulersTo: vi.fn(),
    showCanvasChrome: vi.fn(),
    hideCanvasChrome: vi.fn(),
    zoomToFit: vi.fn(),
    loadDocument: vi.fn(() => {
      loaded = true
    }),
    replaceDocument: vi.fn(() => {
      loaded = true
    }),
    hasLoadedDocument: vi.fn(() => loaded),
    serializeDocument: vi.fn((metadata, doc) => ({ ...doc, name: metadata.name })),
    markSaved: vi.fn(),
    clearHistory: vi.fn(),
    resize: vi.fn(),
    destroy: vi.fn(),
  }
  const host: CanvasRuntimeHost = {
    surfaces: {
      commands: fakeCommandSurface(),
      queries: fakeQuerySurface(),
      documents,
    } satisfies CanvasRuntimeSurfaces,
    init: vi.fn(async () => undefined),
    destroy: vi.fn(),
  }
  return { host, documents }
}

function fakeCommandSurface(): CanvasCommandSurface {
  return {
    tools: { setTool: vi.fn() },
    viewport: {
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      zoomToFit: vi.fn(),
    },
    history: {
      canUndo: signal(false),
      canRedo: signal(false),
      undo: vi.fn(),
      redo: vi.fn(),
    },
    sceneEdits: {
      copy: vi.fn(),
      paste: vi.fn(),
      pasteAt: vi.fn(),
      canPaste: vi.fn(() => false),
      duplicateSelected: vi.fn(),
      toggleSelectedPlantNamePins: vi.fn(),
      deleteSelected: vi.fn(),
      selectAll: vi.fn(),
      selectSameSpecies: vi.fn(),
      bringToFront: vi.fn(),
      sendToBack: vi.fn(),
      lockSelected: vi.fn(),
      unlockSelected: vi.fn(),
      groupSelected: vi.fn(),
      ungroupSelected: vi.fn(),
    },
    chrome: {
      toggleGrid: vi.fn(),
      toggleSnapToGrid: vi.fn(),
      toggleRulers: vi.fn(),
    },
    layers: {
      setSceneLayerVisibility: vi.fn(() => true),
      setSceneLayerOpacity: vi.fn(() => true),
      setSceneLayerLocked: vi.fn(() => true),
    },
    plantPresentation: {
      ensureSpeciesCacheEntries: vi.fn(async () => false),
      setSelectedPlantColor: vi.fn(() => 0),
      setSelectedPlantSymbol: vi.fn(() => 0),
      setPlantColorForSpecies: vi.fn(() => 0),
      setPlantSymbolForSpecies: vi.fn(() => 0),
      clearPlantSpeciesColor: vi.fn(() => false),
      clearPlantSpeciesSymbol: vi.fn(() => false),
    },
  }
}

function fakeQuerySurface(): CanvasQuerySurface {
  return {
    revision: {
      scene: signal(0),
      plantNames: signal(0),
      viewport: signal(0),
    },
    getSceneSnapshot: vi.fn(() => createDefaultScenePersistedState()),
    getViewport: vi.fn(() => ({ x: 0, y: 0, scale: 1 })),
    getViewportScreenSize: vi.fn(() => ({ width: 800, height: 600 })),
    viewportRevision: signal(0),
    getSelection: vi.fn(() => new Set<string>()),
    getDesignObjectSelection: vi.fn(() => ({
      editableTargets: [],
      lockedTargets: [],
      blockedTargets: [],
      bounds: null,
      sameSpeciesReferenceCanonicalName: null,
    })),
    getSelectedPlantColorContext: vi.fn(() => ({
      plantIds: [],
      singleSpeciesCanonicalName: null,
      singleSpeciesCommonName: null,
      sharedCurrentColor: null,
      suggestedColor: null,
      singleSpeciesDefaultColor: null,
    })),
    getSelectedPlantSymbolContext: vi.fn(() => ({
      plantIds: [],
      singleSpeciesCanonicalName: null,
      singleSpeciesCommonName: null,
      sharedCurrentSymbol: null,
      sharedEffectiveSymbol: 'round' as const,
      inheritedSymbol: null,
      singleSpeciesDefaultSymbol: null,
      canClearSelectedSymbol: false,
    })),
    getPlacedPlants: vi.fn(() => []),
    getLocalizedCommonNames: vi.fn(() => new Map()),
  }
}
