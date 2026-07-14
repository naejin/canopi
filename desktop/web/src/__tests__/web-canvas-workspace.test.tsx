import { signal } from '@preact/signals'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createDefaultLayerVisibility,
  layerVisibility,
} from '../app/canvas-settings/signals'
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
import { createBrowserDesignSessionController, type BrowserDesignFileAdapter } from '../web/browser-design-session'
import { WebCanvasWorkspace } from '../web/WebCanvasWorkspace'

describe('Web Edition canvas workspace', () => {
  let container: HTMLDivElement

  afterEach(() => {
    render(null, container)
    container?.remove()
    currentCanvasSession.value = null
    layerVisibility.value = createDefaultLayerVisibility()
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

  it('shows a desktop-style browser-safe welcome screen without recent files when no Design is active', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    const store = createMemoryDesignSessionStore()
    const fileAdapter: BrowserDesignFileAdapter = {
      openCanopiFile: vi.fn(async () => null),
      downloadCanopiFile: vi.fn(async () => undefined),
    }
    const controller = createBrowserDesignSessionController({
      store,
      fileAdapter,
      appDataStore: createBrowserAppDataStore({ storage: memoryStorage() }),
      now: () => new Date('2026-07-04T12:00:00.000Z'),
    })
    const runtime = fakeRuntimeHost()

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

    expect(runtime.documents.hideCanvasChrome).toHaveBeenCalled()
    expect(container.querySelector('[data-testid="web-welcome-screen"]')).not.toBeNull()
    expect(container.querySelector('img[alt="Canopi"]')).not.toBeNull()
    expect(container.textContent).toContain('New Design')
    expect(container.textContent).toContain('Open Design')
    expect(container.textContent).not.toContain('Recent Files')
    expect(container.textContent).not.toContain('No Design loaded')

    await act(async () => {
      buttonByText(container, 'Open Design').click()
    })
    expect(fileAdapter.openCanopiFile).toHaveBeenCalledOnce()

    await act(async () => {
      buttonByText(container, 'New Design').click()
    })
    expect(store.readCurrentDesign()?.name).toBe('Untitled')
  })

  it('does not replace live canvas-owned state after a non-canvas Design edit', async () => {
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
    vi.mocked(runtime.documents.replaceDocument).mockClear()

    await act(async () => {
      controller.renameDesign('Renamed outside the canvas')
      await Promise.resolve()
    })

    expect(store.readDesignName()).toBe('Renamed outside the canvas')
    expect(store.isDesignDirty()).toBe(true)
    expect(runtime.documents.replaceDocument).not.toHaveBeenCalled()
  })

  it('releases a runtime whose Design attachment fails', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    const store = createMemoryDesignSessionStore()
    const controller = createBrowserDesignSessionController({
      store,
      appDataStore: createBrowserAppDataStore({ storage: memoryStorage() }),
      now: () => new Date('2026-07-04T12:00:00.000Z'),
    })
    const runtime = fakeRuntimeHost()
    vi.mocked(runtime.documents.loadDocument).mockImplementation(() => {
      throw new Error('canvas hydration failed')
    })
    const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await controller.newDesign()

    try {
      await act(async () => {
        render(
          <WebCanvasWorkspace
            controller={controller}
            store={store}
            createRuntimeHost={() => runtime.host}
          />,
          container,
        )
        await Promise.resolve()
      })

      await vi.waitFor(() => {
        expect(logError).toHaveBeenCalledWith(
          'Failed to initialize browser canvas runtime:',
          expect.objectContaining({ message: 'canvas hydration failed' }),
        )
      })
      expect(runtime.host.destroy).toHaveBeenCalledOnce()
      expect(currentCanvasSession.value).toBeNull()
    } finally {
      logError.mockRestore()
    }
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
    replaceDocument: vi.fn((_file, _token, finalizeReplacement) => {
      loaded = true
      finalizeReplacement()
      return { callerFinalizerInvoked: true }
    }),
    hasLoadedDocument: vi.fn(() => loaded),
    serializeDocument: vi.fn((metadata, doc) => ({ ...doc, name: metadata.name })),
    markSaved: vi.fn(),
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
      saveSelectionAsObjectStamp: vi.fn(),
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
    getSettledPlacedPlants: vi.fn(() => []),
    getLocalizedCommonNames: vi.fn(() => new Map()),
  }
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find((candidate) => candidate.textContent?.trim() === text)
  if (!button) throw new Error(`Missing button ${text}`)
  return button
}
