import { describe, expect, it, vi } from 'vitest'
import { createMemoryDesignSessionStore } from '../app/document-session/store'
import type { CanvasDocumentSurface, CanvasPersistenceCapture } from '../canvas/runtime/runtime'
import { SceneHistory } from '../canvas/runtime/scene-history'
import { SceneStore } from '../canvas/runtime/scene'
import { SceneRuntimeEditCoordinator } from '../canvas/runtime/scene-runtime/transactions'
import type { SceneCommand } from '../canvas/runtime/scene-commands'
import { createBrowserAppDataStore, type BrowserStorageAdapter } from '../web/browser-app-data'
import {
  createBrowserDesignSessionController,
  type BrowserDesignFileAdapter,
} from '../web/browser-design-session'
import { encodeCanopiDesign } from '../app/contracts/canopi-design-wire'
import { CONTINUOUS_SAVE_DELAY_MS } from '../app/document-session/continuous-save'
import type { CanopiFile } from '../types/design'
import { editDesignSessionForTest } from './support/design-session-edit'

const NOW = new Date('2026-09-27T12:00:00.000Z')

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

function makeFile(name: string): CanopiFile {
  return {
    version: 9,
    name,
    description: null,
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
    views: [],
    stories: [],
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    extra: {},
  }
}

interface SceneSession extends CanvasDocumentSurface {
  readonly history: SceneHistory
}

function makeSceneSession(): SceneSession {
  const history = new SceneHistory()
  const sceneStore = new SceneStore()
  const authority = new SceneRuntimeEditCoordinator({
    sceneStore,
    history,
    setSelection: (ids) => sceneStore.setSelection(ids),
    incrementSceneRevision: () => {},
    syncCanvasSignalsFromScene: () => {},
    invalidate: () => {},
  })
  return {
    history,
    attachInspectionTo: () => { throw new Error('Inspection is not used by this fixture.') },
    attachRulersTo: vi.fn(),
    showCanvasChrome: vi.fn(),
    hideCanvasChrome: vi.fn(),
    zoomToFit: vi.fn(),
    loadDocument: vi.fn((next: CanopiFile) => authority.hydrate(next)),
    replaceDocument: vi.fn((next, token, finalizeReplacement) => ({
      callerFinalizerInvoked: authority.replaceDocument(next, {
        token,
        prepare: () => {},
        finalizeReplacement,
      }),
    })),
    hasLoadedDocument: vi.fn(() => true),
    captureForPersistence: vi.fn((metadata, document): CanvasPersistenceCapture => {
      const capture = authority.capturePersistence()
      return {
        content: { ...document, name: metadata.name },
        isCurrent: () => capture.isCurrent(),
        acknowledgeSaved: () => capture.acknowledgeSaved(),
      }
    }),
    resize: vi.fn(),
    destroy: vi.fn(() => authority.disposePersistence()),
  }
}

function fileAdapter(openedFile?: CanopiFile): BrowserDesignFileAdapter {
  return {
    openCanopiFile: vi.fn(async () => openedFile
      ? { fileName: 'opened.canopi', text: JSON.stringify(encodeCanopiDesign(openedFile)) }
      : null),
    downloadCanopiFile: vi.fn(async () => undefined),
  }
}

function setup(options: { openedFile?: CanopiFile, requestSaveDecision?: ReturnType<typeof vi.fn> } = {}) {
  const storage = memoryStorage()
  const store = createMemoryDesignSessionStore()
  const appDataStore = createBrowserAppDataStore({ storage })
  const draftIds = ['draft-first', 'draft-second', 'draft-third']
  const requestSaveDecision = options.requestSaveDecision ?? vi.fn(async () => 'cancel' as const)
  const controller = createBrowserDesignSessionController({
    store,
    appDataStore,
    fileAdapter: fileAdapter(options.openedFile),
    now: () => NOW,
    createDraftId: () => draftIds.shift() ?? 'draft-extra',
    requestSaveDecision: requestSaveDecision as never,
  })
  const session = makeSceneSession()
  const detach = controller.attachCanvasSession(session)
  return { storage, store, appDataStore, controller, session, detach, requestSaveDecision }
}

describe('Web Close Design', () => {
  it('writes the Draft, then empties the store, Scene history and continuous save', async () => {
    const { store, appDataStore, controller, session } = setup()
    await controller.newDesign()
    editDesignSessionForTest(store, (design) => ({ ...design, description: 'last edit' }))
    session.history.record({ type: 'test-edit' } as unknown as SceneCommand)

    await expect(controller.closeDesign()).resolves.toBe(true)

    expect(appDataStore.loadDraft('draft-first')?.description).toBe('last edit')
    expect(store.readCurrentDesign()).toBeNull()
    expect(controller.hasCurrentDesign()).toBe(false)
    expect(controller.readDesignIdentity()).toBeNull()
    expect(session.history.canUndo.value).toBe(false)
    expect(session.hideCanvasChrome).toHaveBeenCalled()
    expect(controller.continuousSave.revertAvailable.value).toBe(false)
    // The Draft stays on disk for the Start screen.
    expect(controller.listDrafts().map((draft) => draft.id)).toEqual(['draft-first'])
  })

  it('never writes the closed Design Draft again', async () => {
    vi.useFakeTimers()
    const { store, appDataStore, controller } = setup()
    const uninstall = controller.installContinuousSave({
      document: Object.assign(new EventTarget(), { visibilityState: 'visible' as const }),
      window: new EventTarget(),
    })
    try {
      await controller.newDesign()
      editDesignSessionForTest(store, (design) => ({ ...design, description: 'kept' }))
      await controller.closeDesign()
      const saveDraft = vi.spyOn(appDataStore, 'saveDraft')

      await vi.advanceTimersByTimeAsync(CONTINUOUS_SAVE_DELAY_MS * 4)
      await expect(controller.continuousSave.flush()).resolves.toBe(true)

      expect(saveDraft).not.toHaveBeenCalled()
      expect(appDataStore.loadDraft('draft-first')?.description).toBe('kept')
    } finally {
      uninstall()
      vi.useRealTimers()
    }
  })

  it('asks when the Draft write fails; Cancel keeps the Design and Discard closes it', async () => {
    const requestSaveDecision = vi.fn(async () => 'cancel' as const)
    const { storage, store, controller } = setup({ requestSaveDecision })
    await controller.newDesign()
    editDesignSessionForTest(store, (design) => ({ ...design, description: 'unwritable' }))
    storage.failWrites = true

    await expect(controller.closeDesign()).resolves.toBe(false)
    expect(requestSaveDecision).toHaveBeenCalledWith({
      kind: 'flush-failed',
      purpose: 'replace',
      conflict: false,
    })
    expect(store.readCurrentDesign()?.description).toBe('unwritable')

    requestSaveDecision.mockResolvedValueOnce('discard' as never)
    await expect(controller.closeDesign()).resolves.toBe(true)
    expect(store.readCurrentDesign()).toBeNull()
  })

  it('does nothing when no Design is open', async () => {
    const { controller, session, requestSaveDecision } = setup()
    vi.mocked(session.replaceDocument).mockClear()

    await expect(controller.closeDesign()).resolves.toBe(false)
    expect(session.replaceDocument).not.toHaveBeenCalled()
    expect(requestSaveDecision).not.toHaveBeenCalled()
  })

  it('creates, opens and reopens Drafts normally after a close', async () => {
    const { store, controller } = setup({ openedFile: makeFile('Opened') })
    await controller.newDesign()
    editDesignSessionForTest(store, (design) => ({ ...design, description: 'first Draft' }))
    await controller.closeDesign()

    await controller.newDesign()
    expect(store.readDesignName()).toBe('Untitled')
    await controller.closeDesign()

    await expect(controller.openCanopi()).resolves.toBe(true)
    expect(store.readDesignName()).toBe('Opened')
    await controller.closeDesign()

    await expect(controller.openDraft('draft-first')).resolves.toBe(true)
    expect(store.readCurrentDesign()?.description).toBe('first Draft')
  })

  it('does not clear a Design opened while the close was still asking', async () => {
    const answer = { resolve: (_value: 'discard') => {} }
    const requestSaveDecision = vi.fn(() => new Promise<'discard'>((resolve) => {
      answer.resolve = resolve
    }))
    const { storage, store, controller } = setup({ requestSaveDecision })
    await controller.newDesign()
    editDesignSessionForTest(store, (design) => ({ ...design, description: 'unwritable' }))
    storage.failWrites = true

    const closing = controller.closeDesign()
    await vi.waitFor(() => expect(requestSaveDecision).toHaveBeenCalled())
    storage.failWrites = false
    await controller.newDesign()
    const opened = store.readCurrentDesign()
    answer.resolve('discard')

    await expect(closing).resolves.toBe(false)
    expect(store.readCurrentDesign()).toBe(opened)
  })
})
