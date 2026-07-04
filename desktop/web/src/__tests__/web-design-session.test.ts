import { describe, expect, it, vi } from 'vitest'
import { createMemoryDesignSessionStore } from '../app/document-session/store'
import type { CanvasDocumentSurface } from '../canvas/runtime/runtime'
import { createBrowserAppDataStore, type BrowserStorageAdapter } from '../web/browser-app-data'
import { createBrowserDesignSessionController, type BrowserDesignFileAdapter } from '../web/browser-design-session'
import type { CanopiFile } from '../types/design'

const NOW = new Date('2026-07-04T12:00:00.000Z')

describe('browser Design Session lifecycle', () => {
  it('creates a browser-local Design with valid empty unsupported sections', async () => {
    const store = createMemoryDesignSessionStore()
    const controller = createBrowserDesignSessionController({
      store,
      fileAdapter: testFileAdapter(),
      now: () => NOW,
    })

    await controller.newDesign()

    const design = store.readCurrentDesign()
    expect(design).not.toBeNull()
    expect(store.readDesignPath()).toBeNull()
    expect(store.readDesignName()).toBe('Untitled')
    expect(store.isDesignDirty()).toBe(false)
    expect(design).toMatchObject({
      version: 5,
      name: 'Untitled',
      description: null,
      location: null,
      north_bearing_deg: 0,
      plant_species_colors: {},
      plant_species_symbols: {},
      layers: [],
      plants: [],
      zones: [],
      annotations: [],
      measurement_guides: [],
      groups: [],
      consortiums: [],
      timeline: [],
      budget: [],
      budget_currency: 'EUR',
      created_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
      extra: {},
    })
  })

  it('opens a .canopi file as a detached browser Design and preserves future fields', async () => {
    const openedFile = makeCanopiFile({
      name: 'Loaded Garden',
      description: 'From disk',
      timeline: [{ id: 'future-action', action_type: 'other', description: 'Keep me', start_date: null, end_date: null, recurrence: null, targets: [], depends_on: null, completed: false, order: 0 }],
      extra: { preserved: true },
    }) as CanopiFile & { future_top_level: { keep: boolean } }
    openedFile.future_top_level = { keep: true }
    const adapter = testFileAdapter({
      openCanopiFile: vi.fn(async () => ({
        fileName: 'loaded-garden.canopi',
        text: JSON.stringify(openedFile),
      })),
    })
    const store = createMemoryDesignSessionStore()
    const controller = createBrowserDesignSessionController({ store, fileAdapter: adapter, now: () => NOW })

    await controller.openCanopi()

    const design = store.readCurrentDesign()
    expect(adapter.openCanopiFile).toHaveBeenCalledOnce()
    expect(store.readDesignPath()).toBeNull()
    expect(store.readDesignName()).toBe('Loaded Garden')
    expect(store.isDesignDirty()).toBe(false)
    expect(design?.timeline).toHaveLength(1)
    expect(design?.extra).toMatchObject({
      preserved: true,
      future_top_level: { keep: true },
    })
  })

  it('downloads the current Design as .canopi JSON after browser edits', async () => {
    const adapter = testFileAdapter()
    const store = createMemoryDesignSessionStore()
    const controller = createBrowserDesignSessionController({ store, fileAdapter: adapter, now: () => NOW })

    await controller.newDesign()
    store.mutateCurrentDesign((design) => ({
      ...design,
      name: 'Balcony Guild',
      description: 'Small browser edit',
    }))
    await controller.downloadCanopi()

    expect(adapter.downloadCanopiFile).toHaveBeenCalledOnce()
    const [download] = vi.mocked(adapter.downloadCanopiFile).mock.calls[0]!
    const parsed = JSON.parse(download.text) as CanopiFile
    expect(download.fileName).toBe('Balcony Guild.canopi')
    expect(parsed.name).toBe('Balcony Guild')
    expect(parsed.description).toBe('Small browser edit')
    expect(parsed.timeline).toEqual([])
    expect(parsed.budget).toEqual([])
    expect(parsed.consortiums).toEqual([])
    expect(store.isDesignDirty()).toBe(false)
    expect(store.readDesignPath()).toBeNull()
  })

  it('autosaves Browser Drafts and reopens them as detached Designs', async () => {
    const store = createMemoryDesignSessionStore()
    const appDataStore = createBrowserAppDataStore({ storage: memoryStorage() })
    const controller = createBrowserDesignSessionController({
      store,
      appDataStore,
      fileAdapter: testFileAdapter(),
      now: () => NOW,
    })
    const disposeAutosave = controller.installAutosave()

    try {
      await controller.newDesign()
      store.mutateCurrentDesign((design) => ({
        ...design,
        name: 'Browser Patio',
        description: 'Autosaved locally',
      }))

      expect(controller.listDrafts()).toEqual([
        {
          id: 'draft-browser-patio',
          name: 'Browser Patio',
          updatedAt: NOW.toISOString(),
        },
      ])

      await controller.newDesign()
      expect(controller.openDraft('draft-browser-patio')).toBe(true)

      expect(store.readDesignPath()).toBeNull()
      expect(store.readDesignName()).toBe('Browser Patio')
      expect(store.readCurrentDesign()?.description).toBe('Autosaved locally')
      expect(store.isDesignDirty()).toBe(false)
    } finally {
      disposeAutosave()
    }
  })

  it('keeps the active Design intact when Browser Draft storage fails', async () => {
    const storage = memoryStorage()
    storage.failWrites = true
    const store = createMemoryDesignSessionStore()
    const appDataStore = createBrowserAppDataStore({ storage })
    const controller = createBrowserDesignSessionController({
      store,
      appDataStore,
      fileAdapter: testFileAdapter(),
      now: () => NOW,
    })

    await controller.newDesign()

    expect(store.readCurrentDesign()?.name).toBe('Untitled')
    expect(store.readDesignPath()).toBeNull()
    expect(store.autosaveFailed.value).toBe(true)
    expect(controller.listDrafts()).toEqual([])
  })

  it('serializes attached canvas state into Browser Drafts', async () => {
    const store = createMemoryDesignSessionStore({
      file: makeCanopiFile({ name: 'Canvas Draft' }),
      path: null,
      name: 'Canvas Draft',
    })
    const appDataStore = createBrowserAppDataStore({ storage: memoryStorage() })
    const controller = createBrowserDesignSessionController({
      store,
      appDataStore,
      fileAdapter: testFileAdapter(),
      now: () => NOW,
    })
    const canvas = testCanvasDocumentSurface({
      serializeDocument: vi.fn((_metadata, doc) => ({
        ...doc,
        plants: [
          {
            id: 'plant-from-canvas',
            locked: false,
            canonical_name: 'Malus domestica',
            common_name: null,
            color: null,
            position: { x: 12, y: 24 },
            rotation: null,
            scale: 1,
            notes: null,
            planted_date: null,
            quantity: null,
          },
        ],
      })),
    })
    controller.attachCanvasSession(canvas)

    const saved = controller.saveCurrentDraft()

    expect(saved?.ok).toBe(true)
    expect(canvas.serializeDocument).toHaveBeenCalledOnce()
    expect(appDataStore.loadDraft('draft-canvas-draft')?.plants).toEqual([
      {
        id: 'plant-from-canvas',
        locked: false,
        canonical_name: 'Malus domestica',
        common_name: null,
        color: null,
        position: { x: 12, y: 24 },
        rotation: null,
        scale: 1,
        notes: null,
        planted_date: null,
        quantity: null,
      },
    ])
    expect(canvas.markSaved).toHaveBeenCalledOnce()
  })
})

function testFileAdapter(
  overrides: Partial<BrowserDesignFileAdapter> = {},
): BrowserDesignFileAdapter {
  return {
    openCanopiFile: vi.fn(async () => null),
    downloadCanopiFile: vi.fn(async () => undefined),
    ...overrides,
  }
}

function testCanvasDocumentSurface(
  overrides: Partial<CanvasDocumentSurface> = {},
): CanvasDocumentSurface {
  return {
    initializeViewport: vi.fn(),
    attachRulersTo: vi.fn(),
    showCanvasChrome: vi.fn(),
    hideCanvasChrome: vi.fn(),
    zoomToFit: vi.fn(),
    loadDocument: vi.fn(),
    replaceDocument: vi.fn(),
    hasLoadedDocument: vi.fn(() => true),
    serializeDocument: vi.fn((_metadata, doc) => doc),
    markSaved: vi.fn(),
    clearHistory: vi.fn(),
    resize: vi.fn(),
    destroy: vi.fn(),
    ...overrides,
  }
}

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

function makeCanopiFile(overrides: Partial<CanopiFile> = {}): CanopiFile {
  return {
    version: 5,
    name: 'Test Design',
    description: null,
    location: null,
    north_bearing_deg: 0,
    plant_species_colors: {},
    plant_species_symbols: {},
    layers: [],
    plants: [],
    zones: [],
    annotations: [],
    measurement_guides: [],
    groups: [],
    consortiums: [],
    timeline: [],
    budget: [],
    budget_currency: 'EUR',
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-02T00:00:00.000Z',
    extra: {},
    ...overrides,
  }
}
