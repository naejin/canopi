import { describe, expect, it, vi } from 'vitest'
import { createMemoryDesignSessionStore } from '../app/document-session/store'
import type { DesignSessionWorkflowRunner } from '../app/document-session/workflow-runner'
import type { CanvasDocumentSurface } from '../canvas/runtime/runtime'
import { createBrowserAppDataStore, type BrowserStorageAdapter } from '../web/browser-app-data'
import {
  browserDesignFileAdapter,
  createBrowserDesignSessionController,
  type BrowserDesignFileAdapter,
} from '../web/browser-design-session'
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

  it('opens fetched static templates as detached browser Designs with the template display name', async () => {
    const templateFile = makeCanopiFile({
      name: 'Downloaded Template',
      description: 'Bundled example',
      location: { lat: 45.5, lon: -73.6, altitude_m: null },
    })
    const store = createMemoryDesignSessionStore()
    const controller = createBrowserDesignSessionController({
      store,
      fileAdapter: testFileAdapter(),
      now: () => NOW,
    })

    await expect(controller.openCanopiTemplate({
      name: 'Forest Edge',
      text: JSON.stringify(templateFile),
    })).resolves.toBe('opened')

    expect(store.readCurrentDesign()?.name).toBe('Downloaded Template')
    expect(store.readCurrentDesign()?.description).toBe('Bundled example')
    expect(store.readDesignName()).toBe('Forest Edge')
    expect(store.readDesignPath()).toBeNull()
    expect(store.isDesignDirty()).toBe(false)
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

  it('resolves browser Open .canopi as a no-op when the picker is cancelled', async () => {
    const pending = browserDesignFileAdapter.openCanopiFile()
    const input = document.body.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).not.toBeNull()

    try {
      input!.dispatchEvent(new Event('cancel'))
      const result = await Promise.race([
        pending,
        new Promise((resolve) => setTimeout(() => resolve('still-pending'), 0)),
      ])

      expect(result).toBeNull()
      expect(document.body.contains(input)).toBe(false)
    } finally {
      input?.remove()
    }
  })

  it('autosaves Browser Drafts and reopens them as detached Designs', async () => {
    const store = createMemoryDesignSessionStore()
    const appDataStore = createBrowserAppDataStore({ storage: memoryStorage() })
    const draftIds = ['draft-browser-patio', 'draft-new-untitled']
    const controller = createBrowserDesignSessionController({
      store,
      appDataStore,
      fileAdapter: testFileAdapter(),
      now: () => NOW,
      createDraftId: () => draftIds.shift() ?? 'draft-extra',
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

  it('keeps separate Browser Drafts for different Designs with the same name', async () => {
    const store = createMemoryDesignSessionStore()
    const appDataStore = createBrowserAppDataStore({ storage: memoryStorage() })
    const draftIds = ['draft-first-untitled', 'draft-second-untitled']
    const controller = createBrowserDesignSessionController({
      store,
      appDataStore,
      fileAdapter: testFileAdapter(),
      now: () => NOW,
      createDraftId: () => draftIds.shift() ?? 'draft-extra',
    })

    await controller.newDesign()
    await controller.newDesign()

    expect(controller.listDrafts()).toEqual([
      {
        id: 'draft-second-untitled',
        name: 'Untitled',
        updatedAt: NOW.toISOString(),
      },
      {
        id: 'draft-first-untitled',
        name: 'Untitled',
        updatedAt: NOW.toISOString(),
      },
    ])
  })

  it('renames the active Browser Draft without leaving a stale draft row', async () => {
    const store = createMemoryDesignSessionStore()
    const appDataStore = createBrowserAppDataStore({ storage: memoryStorage() })
    const controller = createBrowserDesignSessionController({
      store,
      appDataStore,
      fileAdapter: testFileAdapter(),
      now: () => NOW,
      createDraftId: () => 'draft-active-session',
    })

    await controller.newDesign()
    store.mutateCurrentDesign((design) => ({
      ...design,
      name: 'Renamed Patio',
    }))
    controller.saveCurrentDraft()

    expect(controller.listDrafts()).toEqual([
      {
        id: 'draft-active-session',
        name: 'Renamed Patio',
        updatedAt: NOW.toISOString(),
      },
    ])
    expect(appDataStore.loadDraft('draft-active-session')?.name).toBe('Renamed Patio')
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
      createDraftId: () => 'draft-canvas-draft',
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

  it('applies every browser replacement through the attached canvas lifecycle', async () => {
    const appDataStore = createBrowserAppDataStore({ storage: memoryStorage() })
    appDataStore.saveDraft({
      id: 'draft-replacement',
      file: makeCanopiFile({ name: 'Draft Replacement' }),
      now: NOW.toISOString(),
    })
    const adapter = testFileAdapter({
      openCanopiFile: vi.fn(async () => ({
        fileName: 'opened-replacement.canopi',
        text: JSON.stringify(makeCanopiFile({ name: 'Opened Replacement' })),
      })),
    })
    const store = createMemoryDesignSessionStore()
    const workflowRunner: DesignSessionWorkflowRunner = {
      install: vi.fn(),
      dispose: vi.fn(),
    }
    const controller = createBrowserDesignSessionController({
      store,
      appDataStore,
      fileAdapter: adapter,
      workflowRunner,
      now: () => NOW,
      createDraftId: () => `draft-${store.readDesignName().toLowerCase().replace(/ /g, '-')}`,
    })
    const canvas = testCanvasDocumentSurface()
    const detach = controller.attachCanvasSession(canvas)
    vi.mocked(canvas.replaceDocument).mockClear()

    await controller.newDesign()
    await controller.openCanopi()
    await controller.openCanopiTemplate({
      name: 'Template Display',
      text: JSON.stringify(makeCanopiFile({ name: 'Template Replacement' })),
    })
    expect(controller.openDraft('draft-replacement')).toBe(true)

    expect(vi.mocked(canvas.replaceDocument).mock.calls.map(([file]) => file.name)).toEqual([
      'Untitled',
      'Opened Replacement',
      'Template Replacement',
      'Draft Replacement',
    ])
    expect(canvas.clearHistory).toHaveBeenCalledTimes(4)
    expect(canvas.showCanvasChrome).toHaveBeenCalledTimes(4)
    expect(canvas.zoomToFit).toHaveBeenCalledTimes(4)
    expect(workflowRunner.install).toHaveBeenCalledTimes(5)

    detach()
    expect(workflowRunner.dispose).toHaveBeenCalledOnce()
  })

  it('snapshots canvas-owned state and dirty status before detaching', () => {
    const initial = makeCanopiFile({ name: 'Remount Garden' })
    const store = createMemoryDesignSessionStore({
      file: initial,
      path: null,
      name: initial.name,
    })
    const workflowRunner: DesignSessionWorkflowRunner = {
      install: vi.fn(),
      dispose: vi.fn(),
    }
    const controller = createBrowserDesignSessionController({
      store,
      appDataStore: createBrowserAppDataStore({ storage: memoryStorage() }),
      fileAdapter: testFileAdapter(),
      workflowRunner,
      now: () => NOW,
    })
    const canvasOwnedPlant = {
      id: 'canvas-owned-plant',
      locked: false,
      canonical_name: 'Malus domestica',
      common_name: null,
      color: null,
      position: { x: 10, y: 20 },
      rotation: null,
      scale: 1,
      notes: null,
      planted_date: null,
      quantity: null,
    }
    const firstCanvas = testCanvasDocumentSurface({
      serializeDocument: vi.fn((_metadata, document) => ({
        ...document,
        plants: [canvasOwnedPlant],
      })),
    })
    const detach = controller.attachCanvasSession(firstCanvas)
    store.setCanvasClean(false)

    detach()

    expect(firstCanvas.serializeDocument).toHaveBeenCalledOnce()
    expect(store.readCurrentDesign()?.plants).toEqual([canvasOwnedPlant])
    expect(store.isDesignDirty()).toBe(true)
    expect(workflowRunner.dispose).toHaveBeenCalledOnce()

    const remountedCanvas = testCanvasDocumentSurface()
    controller.attachCanvasSession(remountedCanvas)
    expect(remountedCanvas.loadDocument).toHaveBeenCalledWith(
      expect.objectContaining({ plants: [canvasOwnedPlant] }),
    )
  })

  it('does not retain a canvas when attachment fails', async () => {
    const initial = makeCanopiFile({ name: 'Existing Garden' })
    const store = createMemoryDesignSessionStore({
      file: initial,
      path: null,
      name: initial.name,
    })
    const controller = createBrowserDesignSessionController({
      store,
      appDataStore: createBrowserAppDataStore({ storage: memoryStorage() }),
      fileAdapter: testFileAdapter(),
      workflowRunner: { install: vi.fn(), dispose: vi.fn() },
      now: () => NOW,
    })
    const failedCanvas = testCanvasDocumentSurface({
      loadDocument: vi.fn(() => {
        throw new Error('canvas hydration failed')
      }),
    })

    expect(() => controller.attachCanvasSession(failedCanvas)).toThrow('canvas hydration failed')
    await controller.newDesign()

    expect(failedCanvas.replaceDocument).not.toHaveBeenCalled()
    expect(failedCanvas.serializeDocument).not.toHaveBeenCalled()
    expect(store.readCurrentDesign()?.name).toBe('Untitled')
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
