import { effect } from '@preact/signals'
import { describe, expect, it, vi } from 'vitest'
import { beginTimelineActionEdit } from '../app/design-edit'
import {
  createMemoryDesignSessionStore,
  designSessionStore,
} from '../app/document-session/store'
import {
  createDesignSessionWorkflowRunner,
  type DesignSessionWorkflowRunner,
} from '../app/document-session/workflow-runner'
import {
  CanvasAuthorityBusyError,
  CanvasDocumentReplacementNotAdmittedError,
  type CanvasDocumentSurface,
  type CanvasPersistenceCapture,
  type CanvasRuntimeDocumentMetadata,
} from '../canvas/runtime/runtime'
import { createBrowserAppDataStore, type BrowserStorageAdapter } from '../web/browser-app-data'
import {
  browserDesignFileAdapter,
  createBrowserDesignSessionController,
  type BrowserOpenedCanopiFile,
  type BrowserDesignFileAdapter,
} from '../web/browser-design-session'
import type { CanopiFile } from '../types/design'
import {
  editDesignSessionForTest,
  markDesignSessionDirtyForTest,
  reconcileDesignSessionForTest,
} from './support/design-session-edit'

const NOW = new Date('2026-07-04T12:00:00.000Z')

describe('browser Design Session lifecycle', () => {
  it('creates a browser-local Design with the canonical New Design defaults', async () => {
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
      north_bearing_deg: null,
      plant_species_colors: {},
      plant_species_symbols: {},
      layers: [
        { name: 'base', visible: true, locked: false, opacity: 1 },
        { name: 'contours', visible: false, locked: false, opacity: 1 },
        { name: 'climate', visible: false, locked: false, opacity: 1 },
        { name: 'zones', visible: true, locked: false, opacity: 1 },
        { name: 'water', visible: false, locked: false, opacity: 1 },
        { name: 'plants', visible: true, locked: false, opacity: 1 },
        { name: 'measurement-guides', visible: true, locked: false, opacity: 1 },
        { name: 'annotations', visible: true, locked: false, opacity: 1 },
      ],
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

  it('rejects a malformed selected Design before replacing the active session', async () => {
    const original = makeCanopiFile({ name: 'Working Garden' })
    const store = createMemoryDesignSessionStore({
      file: original,
      path: null,
      name: original.name,
    })
    const controller = createBrowserDesignSessionController({
      store,
      fileAdapter: testFileAdapter({
        openCanopiFile: vi.fn(async () => ({
          fileName: 'malformed.canopi',
          text: JSON.stringify({ ...makeCanopiFile(), plants: 'not-an-array' }),
        })),
      }),
      now: () => NOW,
    })

    await expect(controller.openCanopi()).rejects.toThrow('$.plants: expected an array')
    expect(store.readDesignName()).toBe('Working Garden')
    expect(store.readCurrentDesign()).toEqual(original)
  })

  it('does not let an older pending Open overwrite a later New Design', async () => {
    const pendingOpen = deferred<BrowserOpenedCanopiFile | null>()
    const store = createMemoryDesignSessionStore({
      file: makeCanopiFile({ name: 'Original Garden' }),
      path: null,
      name: 'Original Garden',
    })
    let nextDraftId = 0
    const controller = createBrowserDesignSessionController({
      store,
      appDataStore: createBrowserAppDataStore({ storage: memoryStorage() }),
      fileAdapter: testFileAdapter({
        openCanopiFile: vi.fn(() => pendingOpen.promise),
      }),
      now: () => NOW,
      createDraftId: () => `draft-${++nextDraftId}`,
    })

    const opening = controller.openCanopi()
    await controller.newDesign()
    pendingOpen.resolve({
      fileName: 'older-picker.canopi',
      text: JSON.stringify(makeCanopiFile({ name: 'Older Picker Design' })),
    })

    await expect(opening).resolves.toBe(false)
    expect(store.readDesignName()).toBe('Untitled')
    expect(store.readCurrentDesign()?.name).toBe('Untitled')
  })

  it('does not let an older picker completion overwrite a newer Open request', async () => {
    const olderPicker = deferred<BrowserOpenedCanopiFile | null>()
    const newerPicker = deferred<BrowserOpenedCanopiFile | null>()
    const openCanopiFile = vi.fn()
      .mockReturnValueOnce(olderPicker.promise)
      .mockReturnValueOnce(newerPicker.promise)
    const store = createMemoryDesignSessionStore({
      file: makeCanopiFile({ name: 'Original Garden' }),
      path: null,
      name: 'Original Garden',
    })
    let nextDraftId = 0
    const controller = createBrowserDesignSessionController({
      store,
      appDataStore: createBrowserAppDataStore({ storage: memoryStorage() }),
      fileAdapter: testFileAdapter({ openCanopiFile }),
      now: () => NOW,
      createDraftId: () => `draft-${++nextDraftId}`,
    })

    const olderOpening = controller.openCanopi()
    const newerOpening = controller.openCanopi()
    newerPicker.resolve({
      fileName: 'newer-picker.canopi',
      text: JSON.stringify(makeCanopiFile({ name: 'Newer Picker Design' })),
    })
    await expect(newerOpening).resolves.toBe(true)

    olderPicker.resolve({
      fileName: 'older-picker.canopi',
      text: JSON.stringify(makeCanopiFile({ name: 'Older Picker Design' })),
    })
    await expect(olderOpening).resolves.toBe(false)

    expect(store.readDesignName()).toBe('Newer Picker Design')
    expect(store.readCurrentDesign()?.name).toBe('Newer Picker Design')
  })

  it('cancels a pending Open when the active Design changes during the picker', async () => {
    const pendingOpen = deferred<BrowserOpenedCanopiFile | null>()
    const store = createMemoryDesignSessionStore({
      file: makeCanopiFile({
        name: 'Working Garden',
        description: 'Before picker',
      }),
      path: null,
      name: 'Working Garden',
    })
    const controller = createBrowserDesignSessionController({
      store,
      appDataStore: createBrowserAppDataStore({ storage: memoryStorage() }),
      fileAdapter: testFileAdapter({
        openCanopiFile: vi.fn(() => pendingOpen.promise),
      }),
      now: () => NOW,
      createDraftId: () => 'draft-picker-guard',
    })

    const opening = controller.openCanopi()
    editDesignSessionForTest(store, (design) => ({
      ...design,
      description: 'Edited while picker was open',
    }))
    pendingOpen.resolve({
      fileName: 'picked.canopi',
      text: JSON.stringify(makeCanopiFile({ name: 'Picked Design' })),
    })

    await expect(opening).resolves.toBe(false)
    expect(store.readDesignName()).toBe('Working Garden')
    expect(store.readCurrentDesign()?.description).toBe('Edited while picker was open')
  })

  it('rechecks the Open guard immediately before applying the picked Design', async () => {
    const store = createMemoryDesignSessionStore({
      file: makeCanopiFile({
        name: 'Working Garden',
        description: 'Before picker',
      }),
      path: null,
      name: 'Working Garden',
    })
    const controller = createBrowserDesignSessionController({
      store,
      appDataStore: createBrowserAppDataStore({ storage: memoryStorage() }),
      fileAdapter: testFileAdapter({
        openCanopiFile: vi.fn(async () => ({
          fileName: 'picked.canopi',
          text: JSON.stringify(makeCanopiFile({ name: 'Picked Design' })),
        })),
      }),
      now: () => NOW,
      createDraftId: () => {
        editDesignSessionForTest(store, (design) => ({
          ...design,
          description: 'Edit published during final preparation',
        }))
        return 'draft-picked-design'
      },
    })

    await expect(controller.openCanopi()).resolves.toBe(false)
    expect(store.readDesignName()).toBe('Working Garden')
    expect(store.readCurrentDesign()?.description).toBe(
      'Edit published during final preparation',
    )
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

  it('rejects a malformed template before replacing the active session', async () => {
    const original = makeCanopiFile({ name: 'Working Garden' })
    const store = createMemoryDesignSessionStore({
      file: original,
      path: null,
      name: original.name,
    })
    const controller = createBrowserDesignSessionController({ store, now: () => NOW })

    await expect(controller.openCanopiTemplate({
      name: 'Malformed Template',
      text: JSON.stringify({ ...makeCanopiFile(), zones: [{ name: 'missing fields' }] }),
    })).rejects.toThrow('$.zones[0].points: missing required value')
    expect(store.readDesignName()).toBe('Working Garden')
    expect(store.readCurrentDesign()).toEqual(original)
  })

  it('does not let an older pending Open overwrite a later template replacement', async () => {
    const pendingOpen = deferred<BrowserOpenedCanopiFile | null>()
    const store = createMemoryDesignSessionStore({
      file: makeCanopiFile({ name: 'Original Garden' }),
      path: null,
      name: 'Original Garden',
    })
    let nextDraftId = 0
    const controller = createBrowserDesignSessionController({
      store,
      appDataStore: createBrowserAppDataStore({ storage: memoryStorage() }),
      fileAdapter: testFileAdapter({
        openCanopiFile: vi.fn(() => pendingOpen.promise),
      }),
      now: () => NOW,
      createDraftId: () => `draft-${++nextDraftId}`,
    })

    const opening = controller.openCanopi()
    await controller.openCanopiTemplate({
      name: 'Later Template',
      text: JSON.stringify(makeCanopiFile({ name: 'Later Template Design' })),
    })
    pendingOpen.resolve({
      fileName: 'older-picker.canopi',
      text: JSON.stringify(makeCanopiFile({ name: 'Older Picker Design' })),
    })

    await expect(opening).resolves.toBe(false)
    expect(store.readDesignName()).toBe('Later Template')
    expect(store.readCurrentDesign()?.name).toBe('Later Template Design')
  })

  it('downloads the current Design as .canopi JSON after browser edits', async () => {
    const adapter = testFileAdapter()
    const store = createMemoryDesignSessionStore()
    const controller = createBrowserDesignSessionController({ store, fileAdapter: adapter, now: () => NOW })

    await controller.newDesign()
    controller.renameDesign('Balcony Guild')
    editDesignSessionForTest(store, (design) => ({
      ...design,
      description: 'Small browser edit',
      extra: {
        future_top_level: { keep: true },
      },
    }))
    await controller.downloadCanopi()

    expect(adapter.downloadCanopiFile).toHaveBeenCalledOnce()
    const [download] = vi.mocked(adapter.downloadCanopiFile).mock.calls[0]!
    const parsed = JSON.parse(download.text) as Record<string, unknown>
    expect(download.fileName).toBe('Balcony Guild.canopi')
    expect(parsed.name).toBe('Balcony Guild')
    expect(parsed.description).toBe('Small browser edit')
    expect(parsed.timeline).toEqual([])
    expect(parsed.budget).toEqual([])
    expect(parsed.consortiums).toEqual([])
    expect(parsed.future_top_level).toEqual({ keep: true })
    expect(parsed).not.toHaveProperty('extra')
    expect(store.isDesignDirty()).toBe(false)
    expect(store.readDesignPath()).toBeNull()
  })

  it('keeps edits and a rename made while a browser download is pending', async () => {
    const pending = deferred<void>()
    const adapter = testFileAdapter({
      downloadCanopiFile: vi.fn(() => pending.promise),
    })
    const store = createMemoryDesignSessionStore()
    const controller = createBrowserDesignSessionController({
      store,
      fileAdapter: adapter,
      now: () => NOW,
    })

    await controller.newDesign()
    editDesignSessionForTest(store, (design) => ({
      ...design,
      description: 'Captured download content',
    }))
    const downloading = controller.downloadCanopi()
    editDesignSessionForTest(store, (design) => ({
      ...design,
      description: 'Edited after download capture',
    }))
    controller.renameDesign('Later Browser Name')

    pending.resolve(undefined)
    await downloading

    const [download] = vi.mocked(adapter.downloadCanopiFile).mock.calls[0]!
    expect(JSON.parse(download.text)).toMatchObject({
      name: 'Untitled',
      description: 'Captured download content',
    })
    expect(store.readCurrentDesign()).toMatchObject({
      name: 'Later Browser Name',
      description: 'Edited after download capture',
    })
    expect(store.readDesignName()).toBe('Later Browser Name')
    expect(store.readDesignPath()).toBeNull()
  })

  it('retries download settlement without downloading the exact snapshot twice', async () => {
    const adapter = testFileAdapter()
    const store = createMemoryDesignSessionStore({
      file: makeCanopiFile({ name: 'Retry Garden' }),
      path: null,
      name: 'Retry Garden',
    })
    const controller = createBrowserDesignSessionController({
      store,
      fileAdapter: adapter,
      appDataStore: createBrowserAppDataStore({ storage: memoryStorage() }),
      now: () => NOW,
      createDraftId: () => 'draft-retry-garden',
    })
    const acknowledgeSaved = vi.fn()
      .mockImplementationOnce(() => {
        throw new Error('clean publication failed')
      })
      .mockReturnValue('applied' as const)
    const canvas = testCanvasDocumentSurface({
      captureForPersistence: vi.fn((_metadata, document) => ({
        content: document,
        isCurrent: () => true,
        acknowledgeSaved,
      })),
    })
    const detach = controller.attachCanvasSession(canvas)
    markDesignSessionDirtyForTest(store)

    await expect(controller.downloadCanopi()).resolves.toBeUndefined()

    expect(adapter.downloadCanopiFile).toHaveBeenCalledOnce()
    expect(acknowledgeSaved).toHaveBeenCalledTimes(3)
    expect(store.isDesignDirty()).toBe(false)
    detach()
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
      controller.renameDesign('Browser Patio')
      editDesignSessionForTest(store, (design) => ({
        ...design,
        description: 'Autosaved locally',
      }))
      await Promise.resolve()

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

  it('autosaves a Design that is already dirty when autosave installs', async () => {
    const initial = makeCanopiFile({
      name: 'Already Dirty Garden',
      description: 'unsaved before installation',
    })
    const store = createMemoryDesignSessionStore({
      file: initial,
      path: null,
      name: initial.name,
    })
    markDesignSessionDirtyForTest(store)
    const appDataStore = createBrowserAppDataStore({ storage: memoryStorage() })
    const controller = createBrowserDesignSessionController({
      store,
      appDataStore,
      fileAdapter: testFileAdapter(),
      now: () => NOW,
      createDraftId: () => 'draft-already-dirty',
    })
    const onDraftSaved = vi.fn()
    const disposeAutosave = controller.installAutosave({ onDraftSaved })

    try {
      await Promise.resolve()

      expect(onDraftSaved).toHaveBeenCalledOnce()
      expect(appDataStore.loadDraft('draft-already-dirty')?.description)
        .toBe('unsaved before installation')
      expect(store.isDesignDirty()).toBe(false)
    } finally {
      disposeAutosave()
    }
  })

  it('does not autosave visible Timeline previews until they commit', async () => {
    const initial = makeCanopiFile({
      name: 'Preview Garden',
      timeline: [{
        id: 'timeline-preview',
        action_type: 'planting',
        description: 'Plant canopy',
        start_date: '2026-04-01',
        end_date: '2026-04-03',
        recurrence: null,
        targets: [],
        depends_on: null,
        completed: false,
        order: 0,
      }],
    })
    designSessionStore.replaceCurrentDesignState(initial, null, initial.name)
    designSessionStore.resetDirtyBaselines()
    const appDataStore = createBrowserAppDataStore({ storage: memoryStorage() })
    const controller = createBrowserDesignSessionController({
      store: designSessionStore,
      appDataStore,
      fileAdapter: testFileAdapter(),
      now: () => NOW,
      createDraftId: () => 'draft-timeline-preview',
    })
    const onDraftSaved = vi.fn()
    const disposeAutosave = controller.installAutosave({ onDraftSaved })
    const edit = beginTimelineActionEdit({
      type: 'move',
      actionId: 'timeline-preview',
      originalStartMs: new Date('2026-04-01T00:00:00.000Z').getTime(),
      durationMs: 2 * 86400000,
      pxPerDaySnapshot: 10,
    })

    try {
      edit.applyPixelDelta(10)
      await Promise.resolve()

      expect(designSessionStore.readCurrentDesign()?.timeline[0]).toMatchObject({
        start_date: '2026-04-02',
        end_date: '2026-04-04',
      })
      expect(onDraftSaved).not.toHaveBeenCalled()
      expect(controller.listDrafts()).toEqual([])

      edit.applyPixelDelta(20)
      await Promise.resolve()

      expect(onDraftSaved).not.toHaveBeenCalled()
      expect(controller.listDrafts()).toEqual([])

      edit.commit()
      await Promise.resolve()

      expect(onDraftSaved).toHaveBeenCalledOnce()
      expect(appDataStore.loadDraft('draft-timeline-preview')?.timeline[0]).toMatchObject({
        start_date: '2026-04-03',
        end_date: '2026-04-05',
      })
    } finally {
      edit.abort()
      disposeAutosave()
    }
  })

  it('autosaves every committed change while Canvas keeps the Design dirty', async () => {
    const initial = makeCanopiFile({ name: 'Continuously Dirty Garden' })
    const store = createMemoryDesignSessionStore({
      file: initial,
      path: null,
      name: initial.name,
    })
    const appDataStore = createBrowserAppDataStore({ storage: memoryStorage() })
    const saveDraft = vi.spyOn(appDataStore, 'saveDraft')
    const controller = createBrowserDesignSessionController({
      store,
      appDataStore,
      fileAdapter: testFileAdapter(),
      now: () => NOW,
      createDraftId: () => 'draft-continuously-dirty',
    })
    const detach = controller.attachCanvasSession(testCanvasDocumentSurface())
    const disposeAutosave = controller.installAutosave()

    try {
      store.setCanvasClean(false)
      await Promise.resolve()
      expect(store.isDesignDirty()).toBe(true)
      saveDraft.mockClear()

      editDesignSessionForTest(store, (design) => ({
        ...design,
        description: 'first committed change',
      }))
      await Promise.resolve()

      expect(saveDraft).toHaveBeenCalledOnce()
      expect(store.isDesignDirty()).toBe(true)

      editDesignSessionForTest(store, (design) => ({
        ...design,
        description: 'second committed change',
      }))
      await Promise.resolve()

      expect(saveDraft).toHaveBeenCalledTimes(2)
      expect(appDataStore.loadDraft('draft-continuously-dirty')?.description)
        .toBe('second committed change')
      expect(store.isDesignDirty()).toBe(true)
    } finally {
      disposeAutosave()
      detach()
    }
  })

  it('reschedules clean reconciliation after an explicit Draft supersedes a queued write', async () => {
    const initial = makeCanopiFile({ name: 'Reconciled Garden' })
    const store = createMemoryDesignSessionStore({
      file: initial,
      path: null,
      name: initial.name,
    })
    const appDataStore = createBrowserAppDataStore({ storage: memoryStorage() })
    const controller = createBrowserDesignSessionController({
      store,
      appDataStore,
      fileAdapter: testFileAdapter(),
      now: () => NOW,
      createDraftId: () => 'draft-reconciled-garden',
    })
    const onDraftSaved = vi.fn()
    const disposeAutosave = controller.installAutosave({ onDraftSaved })

    try {
      reconcileDesignSessionForTest(store, (design) => ({
        ...design,
        description: 'first reconciliation',
      }))
      expect(controller.saveCurrentDraft()).toMatchObject({ ok: true })
      expect(appDataStore.loadDraft('draft-reconciled-garden')?.description)
        .toBe('first reconciliation')

      reconcileDesignSessionForTest(store, (design) => ({
        ...design,
        description: 'second reconciliation',
      }))
      await Promise.resolve()
      await Promise.resolve()

      expect(onDraftSaved).toHaveBeenCalledOnce()
      expect(appDataStore.loadDraft('draft-reconciled-garden')?.description)
        .toBe('second reconciliation')
      expect(store.isDesignDirty()).toBe(false)
    } finally {
      disposeAutosave()
    }
  })

  it('does not let an older pending Open overwrite a later Draft replacement', async () => {
    const pendingOpen = deferred<BrowserOpenedCanopiFile | null>()
    const store = createMemoryDesignSessionStore({
      file: makeCanopiFile({ name: 'Original Garden' }),
      path: null,
      name: 'Original Garden',
    })
    const appDataStore = createBrowserAppDataStore({ storage: memoryStorage() })
    appDataStore.saveDraft({
      id: 'later-draft',
      file: makeCanopiFile({ name: 'Later Draft Design' }),
      now: NOW.toISOString(),
    })
    let nextDraftId = 0
    const controller = createBrowserDesignSessionController({
      store,
      appDataStore,
      fileAdapter: testFileAdapter({
        openCanopiFile: vi.fn(() => pendingOpen.promise),
      }),
      now: () => NOW,
      createDraftId: () => `draft-${++nextDraftId}`,
    })

    const opening = controller.openCanopi()
    expect(controller.openDraft('later-draft')).toBe(true)
    pendingOpen.resolve({
      fileName: 'older-picker.canopi',
      text: JSON.stringify(makeCanopiFile({ name: 'Older Picker Design' })),
    })

    await expect(opening).resolves.toBe(false)
    expect(store.readDesignName()).toBe('Later Draft Design')
    expect(store.readCurrentDesign()?.name).toBe('Later Draft Design')
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
    controller.renameDesign('Renamed Patio')
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
    const acknowledgeSaved = vi.fn(() => 'applied' as const)
    const captureForPersistence = vi.fn((
      _metadata: CanvasRuntimeDocumentMetadata,
      doc: CanopiFile,
    ) => ({
      content: {
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
      },
      isCurrent: () => true,
      acknowledgeSaved,
    }))
    const canvas = testCanvasDocumentSurface({ captureForPersistence })
    controller.attachCanvasSession(canvas)

    const saved = controller.saveCurrentDraft()

    expect(saved?.ok).toBe(true)
    expect(captureForPersistence).toHaveBeenCalledOnce()
    expect(appDataStore.loadDraft('draft-canvas-draft')?.plants).toEqual([
      {
        id: 'plant-from-canvas',
        locked: false,
        canonical_name: 'Malus domestica',
        common_name: null,
        color: null,
        symbol: null,
        pinned_name: false,
        position: { x: 12, y: 24 },
        rotation: null,
        scale: 1,
        notes: null,
        planted_date: null,
        quantity: null,
      },
    ])
    expect(acknowledgeSaved).toHaveBeenCalledOnce()
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
    expect(canvas.showCanvasChrome).toHaveBeenCalledTimes(4)
    expect(canvas.zoomToFit).toHaveBeenCalledTimes(4)
    expect(workflowRunner.install).toHaveBeenCalledTimes(5)

    detach()
    expect(workflowRunner.dispose).toHaveBeenCalledOnce()
  })

  it('defers Browser Draft autosave until attached replacement releases Scene authority', async () => {
    const initial = makeCanopiFile({ name: 'Existing Garden' })
    const store = createMemoryDesignSessionStore({
      file: initial,
      path: null,
      name: initial.name,
    })
    const appDataStore = createBrowserAppDataStore({ storage: memoryStorage() })
    const controller = createBrowserDesignSessionController({
      store,
      appDataStore,
      fileAdapter: testFileAdapter(),
      now: () => NOW,
      createDraftId: () => 'draft-replacement-autosave',
    })
    let replacementFinalizerActive = false
    const captureForPersistence = vi.fn((
      _metadata: CanvasRuntimeDocumentMetadata,
      document: CanopiFile,
    ) => {
      if (replacementFinalizerActive) throw new Error('capture reentered replacement')
      return persistenceCapture(document)
    })
    const canvas = testCanvasDocumentSurface({
      captureForPersistence,
      replaceDocument: vi.fn((_file, _token, finalizeReplacement) => {
        replacementFinalizerActive = true
        try {
          finalizeReplacement()
        } finally {
          replacementFinalizerActive = false
        }
        return { callerFinalizerInvoked: true }
      }),
    })
    const detach = controller.attachCanvasSession(canvas)
    const disposeAutosave = controller.installAutosave()
    captureForPersistence.mockClear()

    await expect(controller.newDesign()).resolves.toBeUndefined()
    await Promise.resolve()

    expect(captureForPersistence).toHaveBeenCalledTimes(2)
    expect(appDataStore.loadDraft('draft-replacement-autosave')?.name).toBe('Untitled')
    disposeAutosave()
    detach()
  })

  it('contains a queued autosave capture failure and retries the still-dirty Design', async () => {
    const initial = makeCanopiFile({ name: 'Autosave Retry Garden' })
    const store = createMemoryDesignSessionStore({
      file: initial,
      path: null,
      name: initial.name,
    })
    const appDataStore = createBrowserAppDataStore({ storage: memoryStorage() })
    const controller = createBrowserDesignSessionController({
      store,
      appDataStore,
      fileAdapter: testFileAdapter(),
      now: () => NOW,
      createDraftId: () => 'draft-autosave-retry',
    })
    const captureFailure = new CanvasAuthorityBusyError('document-settlement')
    let captureIsBusy = true
    const canvas = testCanvasDocumentSurface({
      captureForPersistence: vi.fn((_metadata, document) => {
        if (captureIsBusy) throw captureFailure
        return persistenceCapture(document)
      }),
    })
    const detach = controller.attachCanvasSession(canvas)
    const onDraftSaved = vi.fn()
    const disposeAutosave = controller.installAutosave({ onDraftSaved })
    const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      editDesignSessionForTest(store, (design) => ({
        ...design,
        description: 'First autosave attempt',
      }))
      await Promise.resolve()

      expect(logError).toHaveBeenCalledWith(
        'Browser Design Session command failed:',
        captureFailure,
      )
      expect(onDraftSaved).not.toHaveBeenCalled()
      expect(store.isDesignDirty()).toBe(true)
      expect(store.autosaveFailed.value).toBe(true)
      expect(controller.listDrafts()).toEqual([])

      captureIsBusy = false
      editDesignSessionForTest(store, (design) => ({
        ...design,
        description: 'Retried after Canvas settled',
      }))
      await Promise.resolve()
      await Promise.resolve()

      expect(onDraftSaved).toHaveBeenCalledOnce()
      expect(store.isDesignDirty()).toBe(false)
      expect(store.autosaveFailed.value).toBe(false)
      expect(appDataStore.loadDraft('draft-autosave-retry')?.description).toBe(
        'Retried after Canvas settled',
      )
    } finally {
      captureIsBusy = false
      disposeAutosave()
      logError.mockRestore()
      detach()
    }
  })

  it('contains autosave-failure publication errors inside the queued task', async () => {
    const initial = makeCanopiFile({ name: 'Autosave Publication Garden' })
    const store = createMemoryDesignSessionStore({
      file: initial,
      path: null,
      name: initial.name,
    })
    const controller = createBrowserDesignSessionController({
      store,
      appDataStore: createBrowserAppDataStore({ storage: memoryStorage() }),
      fileAdapter: testFileAdapter(),
      now: () => NOW,
      createDraftId: () => 'draft-autosave-publication',
    })
    const captureFailure = new CanvasAuthorityBusyError('document-settlement')
    const publicationFailure = new Error('autosave failure publication failed')
    let captureIsBusy = true
    const canvas = testCanvasDocumentSurface({
      captureForPersistence: vi.fn(() => {
        if (captureIsBusy) throw captureFailure
        return persistenceCapture(initial)
      }),
    })
    const detach = controller.attachCanvasSession(canvas)
    const disposeAutosave = controller.installAutosave()
    const disposeFailureEffect = effect(() => {
      if (store.autosaveFailed.value) throw publicationFailure
    })
    const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      editDesignSessionForTest(store, (design) => ({
        ...design,
        description: 'Trigger contained failure',
      }))
      await Promise.resolve()

      expect(logError).toHaveBeenCalledWith(
        'Browser Design Session command failed:',
        captureFailure,
      )
      expect(logError).toHaveBeenCalledWith(
        'Browser Design Session command failed:',
        publicationFailure,
      )
    } finally {
      captureIsBusy = false
      disposeFailureEffect()
      disposeAutosave()
      logError.mockRestore()
      detach()
    }
  })

  it('rejects overlapping browser Canvas attachments before hydrating stale store state', () => {
    const initial = makeCanopiFile({ name: 'Leased Garden' })
    const store = createMemoryDesignSessionStore({
      file: initial,
      path: null,
      name: initial.name,
    })
    const controller = createBrowserDesignSessionController({
      store,
      appDataStore: createBrowserAppDataStore({ storage: memoryStorage() }),
      fileAdapter: testFileAdapter(),
      now: () => NOW,
    })
    const firstCanvas = testCanvasDocumentSurface()
    const secondCanvas = testCanvasDocumentSurface()
    const detachFirst = controller.attachCanvasSession(firstCanvas)

    expect(() => controller.attachCanvasSession(secondCanvas)).toThrow(
      'Canvas persistence lease',
    )
    expect(secondCanvas.loadDocument).not.toHaveBeenCalled()

    detachFirst()
  })

  it('rejects duplicate attachment of the same Canvas without rehydrating or releasing it', () => {
    const initial = makeCanopiFile({ name: 'Leased Garden' })
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
    const canvas = testCanvasDocumentSurface()
    const detach = controller.attachCanvasSession(canvas)

    expect(() => controller.attachCanvasSession(canvas)).toThrow('already attached')
    expect(canvas.loadDocument).toHaveBeenCalledOnce()

    expect(detach).not.toThrow()
    expect(canvas.captureForPersistence).toHaveBeenCalledOnce()
    expect(workflowRunner.dispose).toHaveBeenCalledOnce()
  })

  it('reschedules autosave when an intervening draft acknowledgement publishes a newer edit', async () => {
    const initial = makeCanopiFile({ name: 'Autosave Garden' })
    const store = createMemoryDesignSessionStore({
      file: initial,
      path: null,
      name: initial.name,
    })
    const appDataStore = createBrowserAppDataStore({ storage: memoryStorage() })
    const controller = createBrowserDesignSessionController({
      store,
      appDataStore,
      fileAdapter: testFileAdapter(),
      createDraftId: () => 'draft-reentrant-edit',
      now: () => NOW,
    })
    const acknowledgeSaved = vi.fn()
      .mockImplementationOnce(() => {
        editDesignSessionForTest(store, (design) => ({
          ...design,
          description: 'Edit published during acknowledgement',
        }))
        return 'applied' as const
      })
      .mockReturnValue('applied' as const)
    const canvas = testCanvasDocumentSurface({
      captureForPersistence: vi.fn((_metadata, document) => ({
        content: document,
        isCurrent: () => true,
        acknowledgeSaved,
      })),
    })
    const detach = controller.attachCanvasSession(canvas)
    const disposeAutosave = controller.installAutosave()

    editDesignSessionForTest(store, (design) => ({
      ...design,
      description: 'First queued edit',
    }))
    controller.saveCurrentDraft()
    await Promise.resolve()
    await Promise.resolve()

    expect(appDataStore.loadDraft('draft-reentrant-edit')?.description).toBe(
      'Edit published during acknowledgement',
    )
    expect(store.isDesignDirty()).toBe(false)
    expect(acknowledgeSaved).toHaveBeenCalledTimes(2)

    disposeAutosave()
    detach()
  })

  it('reschedules autosave when an intervening acknowledgement commits a Canvas-only edit', async () => {
    const initial = makeCanopiFile({ name: 'Canvas Autosave Garden' })
    const store = createMemoryDesignSessionStore({
      file: initial,
      path: null,
      name: initial.name,
    })
    const appDataStore = createBrowserAppDataStore({ storage: memoryStorage() })
    const controller = createBrowserDesignSessionController({
      store,
      appDataStore,
      fileAdapter: testFileAdapter(),
      createDraftId: () => 'draft-canvas-reentrant-edit',
      now: () => NOW,
    })
    const acknowledgeSaved = vi.fn()
      .mockImplementationOnce(() => {
        store.setCanvasClean(true)
        store.setCanvasClean(false)
        return 'applied' as const
      })
      .mockImplementation(() => {
        store.setCanvasClean(true)
        return 'applied' as const
      })
    let captureNumber = 0
    const canvas = testCanvasDocumentSurface({
      captureForPersistence: vi.fn((_metadata, document) => {
        captureNumber += 1
        return {
          content: {
            ...document,
            plants: [{
              id: `scene-${captureNumber}`,
              locked: false,
              canonical_name: 'Malus domestica',
              common_name: null,
              color: null,
              symbol: null,
              pinned_name: false,
              position: { x: captureNumber, y: 0 },
              rotation: null,
              scale: null,
              notes: null,
              planted_date: null,
              quantity: null,
            }],
          },
          isCurrent: () => true,
          acknowledgeSaved,
        }
      }),
    })
    const detach = controller.attachCanvasSession(canvas)
    const disposeAutosave = controller.installAutosave()

    store.setCanvasClean(false)
    controller.saveCurrentDraft()
    await Promise.resolve()
    await Promise.resolve()

    expect(appDataStore.loadDraft('draft-canvas-reentrant-edit')?.plants).toEqual([
      expect.objectContaining({ id: 'scene-2' }),
    ])
    expect(store.isDesignDirty()).toBe(false)
    expect(acknowledgeSaved).toHaveBeenCalledTimes(2)

    disposeAutosave()
    detach()
  })

  it('preserves draft ownership when an attached draft replacement fails', async () => {
    const store = createMemoryDesignSessionStore()
    const appDataStore = createBrowserAppDataStore({ storage: memoryStorage() })
    const controller = createBrowserDesignSessionController({
      store,
      appDataStore,
      fileAdapter: testFileAdapter(),
      createDraftId: () => 'active-draft',
      now: () => NOW,
    })
    await controller.newDesign()
    const target = makeCanopiFile({ name: 'Target Draft' })
    expect(appDataStore.saveDraft({
      id: 'target-draft',
      file: target,
      now: NOW.toISOString(),
    }).ok).toBe(true)
    const canvas = testCanvasDocumentSurface({
      replaceDocument: vi.fn()
        .mockImplementationOnce(() => {
          throw new Error('canvas replacement failed')
        })
        .mockImplementation((_file, _token, finalizeReplacement) => {
          finalizeReplacement()
          return { callerFinalizerInvoked: true }
        }),
    })
    const detach = controller.attachCanvasSession(canvas)

    expect(() => controller.openDraft('target-draft')).toThrow('canvas replacement failed')
    editDesignSessionForTest(store, (design) => ({
      ...design,
      description: 'Old Design remains active',
    }))
    controller.saveCurrentDraft()

    expect(appDataStore.loadDraft('active-draft')?.description).toBe(
      'Old Design remains active',
    )
    expect(appDataStore.loadDraft('target-draft')?.name).toBe('Target Draft')
    expect(appDataStore.loadDraft('target-draft')?.description).toBeNull()
    detach()
  })

  it('commits draft ownership with Design finalization before a later stage fails', async () => {
    const store = createMemoryDesignSessionStore()
    const appDataStore = createBrowserAppDataStore({ storage: memoryStorage() })
    const controller = createBrowserDesignSessionController({
      store,
      appDataStore,
      fileAdapter: testFileAdapter(),
      createDraftId: () => 'active-draft',
      now: () => NOW,
    })
    await controller.newDesign()
    const target = makeCanopiFile({ name: 'Finalized Target Draft' })
    expect(appDataStore.saveDraft({
      id: 'target-draft',
      file: target,
      now: NOW.toISOString(),
    }).ok).toBe(true)
    const canvas = testCanvasDocumentSurface()
    const detach = controller.attachCanvasSession(canvas)
    const disposeAutosave = controller.installAutosave()
    vi.mocked(canvas.showCanvasChrome).mockImplementationOnce(() => {
      throw new Error('chrome publication failed')
    })

    expect(() => controller.openDraft('target-draft')).toThrow('chrome publication failed')
    await Promise.resolve()
    await Promise.resolve()

    expect(store.readDesignName()).toBe('Finalized Target Draft')
    expect(appDataStore.loadDraft('target-draft')?.name).toBe('Finalized Target Draft')
    expect(appDataStore.loadDraft('active-draft')?.name).toBe('Untitled')

    disposeAutosave()
    detach()
  })

  it('keeps the browser Canvas lease when handoff capture fails', () => {
    const initial = makeCanopiFile({ name: 'Handoff Garden' })
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
    const captureForPersistence = vi.fn((
      _metadata: CanvasRuntimeDocumentMetadata,
      _document: CanopiFile,
    ): CanvasPersistenceCapture => {
      throw new Error('handoff capture failed')
    })
    const canvas = testCanvasDocumentSurface({ captureForPersistence })
    const detach = controller.attachCanvasSession(canvas)

    expect(detach).toThrow('exact persistence settlement failed')
    expect(workflowRunner.dispose).not.toHaveBeenCalled()

    captureForPersistence.mockImplementation((_metadata, document) =>
      persistenceCapture(document))
    expect(detach).not.toThrow()
    expect(workflowRunner.dispose).toHaveBeenCalledOnce()
  })

  it('retains the browser Canvas lease until workflow cleanup succeeds on retry', () => {
    const initial = makeCanopiFile({ name: 'Workflow Cleanup Garden' })
    const store = createMemoryDesignSessionStore({
      file: initial,
      path: null,
      name: initial.name,
    })
    const cleanupFailure = new Error('workflow cleanup failed')
    const workflowRunner: DesignSessionWorkflowRunner = {
      install: vi.fn(),
      dispose: vi.fn()
        .mockImplementationOnce(() => {
          throw cleanupFailure
        })
        .mockImplementation(() => undefined),
    }
    const controller = createBrowserDesignSessionController({
      store,
      appDataStore: createBrowserAppDataStore({ storage: memoryStorage() }),
      fileAdapter: testFileAdapter(),
      workflowRunner,
      now: () => NOW,
    })
    let canvasDescription = 'Captured before cleanup failure'
    const captureForPersistence = vi.fn((
      _metadata: CanvasRuntimeDocumentMetadata,
      document: CanopiFile,
    ) => persistenceCapture({
      ...document,
      description: canvasDescription,
    }))
    const canvas = testCanvasDocumentSurface({ captureForPersistence })
    const replacementCanvas = testCanvasDocumentSurface()
    const detach = controller.attachCanvasSession(canvas)

    expect(detach).toThrow(cleanupFailure)
    expect(captureForPersistence).toHaveBeenCalledOnce()
    expect(() => controller.attachCanvasSession(replacementCanvas)).toThrow(
      'Canvas persistence lease',
    )

    canvasDescription = 'Edited while cleanup remained retryable'
    expect(detach).not.toThrow()
    expect(workflowRunner.dispose).toHaveBeenCalledTimes(2)
    expect(captureForPersistence).toHaveBeenCalledTimes(2)
    expect(store.readCurrentDesign()?.description).toBe(
      'Edited while cleanup remained retryable',
    )
    expect(() => controller.attachCanvasSession(replacementCanvas)).not.toThrow()
  })

  it('settles an interrupted replacement before detach without erasing a newer Design edit', async () => {
    const initial = makeCanopiFile({
      name: 'Interrupted Replacement Garden',
      description: 'Before replacement',
    })
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
      createDraftId: () => 'interrupted-replacement-draft',
    })
    let sceneFile = initial
    let replacementSettling = false
    let retainedReplacementToken: unknown
    let retainedReplacementFinalizer: (() => void) | null = null
    const replaceDocument = vi.fn((
      file: CanopiFile,
      token,
      finalizeReplacement: () => void,
    ) => {
      if (!replacementSettling) {
        replacementSettling = true
        retainedReplacementToken = token
        retainedReplacementFinalizer = finalizeReplacement
        throw new Error('replacement publication interrupted')
      }
      expect(token).toBe(retainedReplacementToken)
      sceneFile = file
      retainedReplacementFinalizer?.()
      replacementSettling = false
      return { callerFinalizerInvoked: false }
    })
    const captureForPersistence = vi.fn((
      _metadata: CanvasRuntimeDocumentMetadata,
      document: CanopiFile,
    ) => {
      if (replacementSettling) {
        throw new CanvasAuthorityBusyError('document-settlement')
      }
      return persistenceCapture({
        ...document,
        plants: sceneFile.plants,
      })
    })
    const canvas = testCanvasDocumentSurface({
      loadDocument: vi.fn((file) => {
        sceneFile = file
      }),
      replaceDocument,
      captureForPersistence,
    })
    const detach = controller.attachCanvasSession(canvas)

    await expect(controller.newDesign()).rejects.toThrow(
      'replacement publication interrupted',
    )
    editDesignSessionForTest(store, (design) => ({
      ...design,
      description: 'Edited after replacement was interrupted',
    }))

    expect(detach).not.toThrow()

    expect(replaceDocument).toHaveBeenCalledTimes(2)
    expect(sceneFile.name).toBe('Untitled')
    expect(store.readCurrentDesign()).toMatchObject({
      name: 'Interrupted Replacement Garden',
      description: 'Edited after replacement was interrupted',
    })

    const remountedCanvas = testCanvasDocumentSurface()
    const detachRemounted = controller.attachCanvasSession(remountedCanvas)
    expect(remountedCanvas.loadDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Interrupted Replacement Garden',
        description: 'Edited after replacement was interrupted',
      }),
    )
    expect(detachRemounted).not.toThrow()
  })

  it('hands off the old browser Scene after replacement preparation is rejected', async () => {
    const initial = makeCanopiFile({ name: 'Prepared Browser Garden' })
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
    const preparationError = new Error('browser replacement preparation failed')
    let sceneColor: string | undefined
    const replaceDocument = vi.fn(() => {
      throw new CanvasDocumentReplacementNotAdmittedError(preparationError)
    })
    const canvas = testCanvasDocumentSurface({
      replaceDocument,
      captureForPersistence: vi.fn((_metadata, document) => persistenceCapture({
        ...document,
        plant_species_colors: sceneColor
          ? { 'Malus domestica': sceneColor }
          : {},
      })),
    })
    const detach = controller.attachCanvasSession(canvas)

    await expect(controller.openCanopiTemplate({
      name: 'Rejected Browser Target',
      text: JSON.stringify(makeCanopiFile({ name: 'Rejected Browser Target' })),
    })).rejects.toBe(preparationError)

    sceneColor = '#335577'
    store.setCanvasClean(false)
    expect(detach).not.toThrow()

    expect(replaceDocument).toHaveBeenCalledOnce()
    expect(store.readDesignName()).toBe('Prepared Browser Garden')
    expect(store.readCurrentDesign()?.plant_species_colors)
      .toEqual({ 'Malus domestica': '#335577' })
  })

  it('settles a retained replacement before a later Open reaches the picker', async () => {
    const initial = makeCanopiFile({ name: 'Initial Browser Garden' })
    const opened = makeCanopiFile({ name: 'Picked After Recovery' })
    const openCanopiFile = vi.fn(async () => ({
      fileName: 'picked-after-recovery.canopi',
      text: JSON.stringify(opened),
    }))
    const store = createMemoryDesignSessionStore({
      file: initial,
      path: null,
      name: initial.name,
    })
    let nextDraftId = 0
    const controller = createBrowserDesignSessionController({
      store,
      appDataStore: createBrowserAppDataStore({ storage: memoryStorage() }),
      fileAdapter: testFileAdapter({ openCanopiFile }),
      workflowRunner: { install: vi.fn(), dispose: vi.fn() },
      now: () => NOW,
      createDraftId: () => `recovery-draft-${++nextDraftId}`,
    })
    let settling = false
    let retainedToken: unknown
    let retainedFinalizer: (() => void) | null = null
    let failFirstReplacement = true
    const replaceDocument = vi.fn((
      _file: CanopiFile,
      token,
      finalizeReplacement: () => void,
    ) => {
      if (settling) {
        expect(token).toBe(retainedToken)
        retainedFinalizer?.()
        settling = false
        return { callerFinalizerInvoked: false }
      }
      if (failFirstReplacement) {
        failFirstReplacement = false
        settling = true
        retainedToken = token
        retainedFinalizer = finalizeReplacement
        throw new Error('retained browser hydration publication failed')
      }
      finalizeReplacement()
      return { callerFinalizerInvoked: true }
    })
    const canvas = testCanvasDocumentSurface({
      replaceDocument,
      captureForPersistence: vi.fn((_metadata, document) => {
        if (settling) throw new CanvasAuthorityBusyError('document-settlement')
        return persistenceCapture(document)
      }),
    })
    controller.attachCanvasSession(canvas)

    await expect(controller.openCanopiTemplate({
      name: 'Interrupted Target',
      text: JSON.stringify(makeCanopiFile({ name: 'Interrupted Target' })),
    })).rejects.toThrow('retained browser hydration publication failed')

    await expect(controller.openCanopi()).resolves.toBe(false)
    expect(openCanopiFile).not.toHaveBeenCalled()
    expect(replaceDocument).toHaveBeenCalledTimes(2)

    await expect(controller.openCanopi()).resolves.toBe(true)
    expect(openCanopiFile).toHaveBeenCalledOnce()
    expect(replaceDocument).toHaveBeenCalledTimes(3)
    expect(store.readDesignName()).toBe('Picked After Recovery')
  })

  it('quarantines a competing browser replacement from a finalized pending identity', async () => {
    const initial = makeCanopiFile({ name: 'Initial Browser Garden' })
    const store = createMemoryDesignSessionStore({
      file: initial,
      path: null,
      name: initial.name,
    })
    const createDraftId = vi.fn()
      .mockReturnValueOnce('first-target-draft')
      .mockReturnValueOnce('second-target-draft')
    const controller = createBrowserDesignSessionController({
      store,
      appDataStore: createBrowserAppDataStore({ storage: memoryStorage() }),
      fileAdapter: testFileAdapter(),
      workflowRunner: { install: vi.fn(), dispose: vi.fn() },
      now: () => NOW,
      createDraftId,
    })
    let settling = false
    let acceptedToken: unknown
    let retainedFinalizer: (() => void) | null = null
    const replaceDocument = vi.fn((
      _file: CanopiFile,
      token,
      finalizeReplacement: () => void,
    ) => {
      settling = true
      if (!acceptedToken) {
        acceptedToken = token
        retainedFinalizer = finalizeReplacement
        finalizeReplacement()
        throw new Error('post-finalizer browser publication failed')
      }
      expect(token).toBe(acceptedToken)
      retainedFinalizer?.()
      settling = false
      return { callerFinalizerInvoked: false }
    })
    const canvas = testCanvasDocumentSurface({
      replaceDocument,
      captureForPersistence: vi.fn((_metadata, document) => {
        if (settling) throw new CanvasAuthorityBusyError('document-settlement')
        return persistenceCapture(document)
      }),
    })
    const detach = controller.attachCanvasSession(canvas)
    const firstTarget = makeCanopiFile({ name: 'First Browser Target' })
    const secondTarget = makeCanopiFile({ name: 'Second Browser Target' })

    await expect(controller.openCanopiTemplate({
      name: firstTarget.name,
      text: JSON.stringify(firstTarget),
    })).rejects.toThrow('post-finalizer browser publication failed')
    editDesignSessionForTest(store, (design) => ({
      ...design,
      description: 'Browser edit after First Target finalized',
    }))

    await expect(controller.openCanopiTemplate({
      name: secondTarget.name,
      text: JSON.stringify(secondTarget),
    })).rejects.toBeInstanceOf(CanvasAuthorityBusyError)
    expect(detach).not.toThrow()
    expect(store.readDesignName()).toBe('First Browser Target')
    expect(store.readCurrentDesign()?.description).toBe(
      'Browser edit after First Target finalized',
    )
    expect(replaceDocument).toHaveBeenCalledTimes(2)
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
    const captureForPersistence = vi.fn((
      _metadata: CanvasRuntimeDocumentMetadata,
      document: CanopiFile,
    ) =>
      persistenceCapture({
        ...document,
        plants: [canvasOwnedPlant],
      }))
    const firstCanvas = testCanvasDocumentSurface({ captureForPersistence })
    const detach = controller.attachCanvasSession(firstCanvas)
    store.setCanvasClean(false)

    detach()

    expect(captureForPersistence).toHaveBeenCalledOnce()
    expect(store.readCurrentDesign()?.plants).toEqual([canvasOwnedPlant])
    expect(store.isDesignDirty()).toBe(true)
    expect(workflowRunner.dispose).toHaveBeenCalledOnce()

    const remountedCanvas = testCanvasDocumentSurface()
    controller.attachCanvasSession(remountedCanvas)
    expect(remountedCanvas.loadDocument).toHaveBeenCalledWith(
      expect.objectContaining({ plants: [canvasOwnedPlant] }),
    )
  })

  it('recaptures browser handoff when snapshot publication commits a newer Scene', () => {
    const initial = makeCanopiFile({ name: 'Reactive Handoff Garden' })
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
    let sceneVersion = 0
    const captureForPersistence = vi.fn((
      _metadata: CanvasRuntimeDocumentMetadata,
      document: CanopiFile,
    ): CanvasPersistenceCapture => {
      const capturedVersion = sceneVersion
      return {
        content: {
          ...document,
          description: `Scene version ${capturedVersion}`,
        },
        isCurrent: () => capturedVersion === sceneVersion,
        acknowledgeSaved: vi.fn(() => 'applied' as const),
      }
    })
    const canvas = testCanvasDocumentSurface({ captureForPersistence })
    const detach = controller.attachCanvasSession(canvas)
    let commitDuringPublication = false
    const disposeEffect = effect(() => {
      void store.currentDesign.value
      if (!commitDuringPublication) return
      commitDuringPublication = false
      sceneVersion += 1
      store.setCanvasClean(false)
    })

    try {
      commitDuringPublication = true
      detach()

      expect(captureForPersistence).toHaveBeenCalledTimes(2)
      expect(store.readCurrentDesign()?.description).toBe('Scene version 1')
      expect(store.isDesignDirty()).toBe(true)
    } finally {
      disposeEffect()
    }
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
    expect(failedCanvas.captureForPersistence).not.toHaveBeenCalled()
    expect(store.readCurrentDesign()?.name).toBe('Untitled')
  })

  it('retries retained workflow cleanup after Canvas attachment fails during install', () => {
    const initial = makeCanopiFile({ name: 'Workflow Install Garden' })
    const store = createMemoryDesignSessionStore({
      file: initial,
      path: null,
      name: initial.name,
    })
    const installFailure = new Error('workflow install failed')
    const cleanupFailure = new Error('workflow cleanup remained pending')
    let cleanupAttempts = 0
    const retainedCleanup = vi.fn(() => {
      cleanupAttempts += 1
      if (cleanupAttempts <= 2) throw cleanupFailure
    })
    const laterCleanup = vi.fn()
    let failInstall = true
    const workflowRunner = createDesignSessionWorkflowRunner([
      {
        id: 'retained-cleanup',
        install: () => retainedCleanup,
      },
      {
        id: 'fallible-install',
        install: () => {
          if (failInstall) {
            failInstall = false
            throw installFailure
          }
          return laterCleanup
        },
      },
    ])
    const controller = createBrowserDesignSessionController({
      store,
      appDataStore: createBrowserAppDataStore({ storage: memoryStorage() }),
      fileAdapter: testFileAdapter(),
      workflowRunner,
      now: () => NOW,
    })
    const failedCanvas = testCanvasDocumentSurface()
    const replacementCanvas = testCanvasDocumentSurface()
    const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      let attachmentError: unknown
      try {
        controller.attachCanvasSession(failedCanvas)
      } catch (error) {
        attachmentError = error
      }

      expect(attachmentError).toMatchObject({
        name: 'DesignSessionWorkflowInstallError',
        installError: installFailure,
        cleanupErrors: [cleanupFailure],
      })
      expect(retainedCleanup).toHaveBeenCalledTimes(2)
      expect(logError).toHaveBeenCalledWith(
        'Failed to clean up browser Design Session workflows after Canvas attachment failure:',
        cleanupFailure,
      )

      const detach = controller.attachCanvasSession(replacementCanvas)

      expect(retainedCleanup).toHaveBeenCalledTimes(3)
      expect(failedCanvas.captureForPersistence).not.toHaveBeenCalled()
      expect(detach).not.toThrow()
      expect(retainedCleanup).toHaveBeenCalledTimes(4)
      expect(laterCleanup).toHaveBeenCalledOnce()
    } finally {
      logError.mockRestore()
    }
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
    replaceDocument: vi.fn((_file, _token, finalizeReplacement) => {
      finalizeReplacement()
      return { callerFinalizerInvoked: true }
    }),
    hasLoadedDocument: vi.fn(() => true),
    captureForPersistence: vi.fn((_metadata, doc) => persistenceCapture(doc)),
    resize: vi.fn(),
    destroy: vi.fn(),
    ...overrides,
  }
}

function persistenceCapture(content: CanopiFile): CanvasPersistenceCapture {
  return {
    content,
    isCurrent: () => true,
    acknowledgeSaved: vi.fn(() => 'applied' as const),
  }
}

function deferred<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
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
