import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  return {
    canvasSession: null as any,
    saveDesign: vi.fn(),
    autosaveDesign: vi.fn(),
    selectDesignSavePath: vi.fn(),
    openDesignDialog: vi.fn(),
    loadDesign: vi.fn(),
    newDesign: vi.fn(),
    message: vi.fn(),
  }
})

vi.mock('../canvas/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../canvas/session')>()
  return {
    ...actual,
    getCurrentCanvasSession() {
      return mocks.canvasSession
    },
    getCurrentCanvasDocumentSurface() {
      return mocks.canvasSession
    },
  }
})

vi.mock('../ipc/design', async () => {
  const { prepareDesignWriteDestination } = await import(
    '../app/document-session/write-admission'
  )
  return {
    saveDesign: mocks.saveDesign,
    autosaveDesign: mocks.autosaveDesign,
    selectDesignSavePath: mocks.selectDesignSavePath,
    prepareDesignWrite: (path: string) => prepareDesignWriteDestination({
      resource: `native-design:${path}`,
      destinationPath: path,
      write: (content) => mocks.saveDesign(path, content).then(() => undefined),
    }),
    prepareRecoveryWrite: (destinationHint: string | null) =>
      prepareDesignWriteDestination({
        resource: 'native-recovery-store',
        write: (content) => mocks.autosaveDesign(content, destinationHint),
      }),
    openDesignDialog: mocks.openDesignDialog,
    loadDesign: mocks.loadDesign,
    newDesign: mocks.newDesign,
  }
})

vi.mock('@tauri-apps/plugin-dialog', () => ({
  message: mocks.message,
}))

vi.mock('../i18n', () => ({
  t: (key: string) => {
    switch (key) {
      case 'canvas.file.save':
        return 'Save'
      case 'canvas.file.dontSave':
        return "Don't Save"
      case 'canvas.file.cancel':
        return 'Cancel'
      case 'canvas.file.unsavedChanges':
        return 'Unsaved changes'
      default:
        return key
    }
  },
}))

import { activeTool, selectedObjectIds } from '../canvas/session-state'
import {
  designSessionFixture,
  currentDesign,
  designName,
  designPath,
  pendingDesignPath,
  pendingTemplateImport,
  resetDirtyBaselines,
} from './support/design-session-state'
import {
  consumeQueuedDocumentLoad,
  newDesignAction,
  openDesign,
  openDesignAsTemplate,
  openDesignFromPath,
  saveCurrentDesign,
} from '../app/document-session/actions'
import { resetDesignSessionStateForTests } from '../app/document-session/transition'
import type { CanopiFile } from '../types/design'

function makeFile(name: string): CanopiFile {
  return {
    version: 1,
    name,
    description: null,
    location: null,
    north_bearing_deg: null,
    plant_species_colors: {},
    layers: [],
    plants: [],
    zones: [],
    annotations: [],
    consortiums: [],
    groups: [],
    timeline: [],
    budget: [],
    budget_currency: 'EUR',
    created_at: '2026-03-29T00:00:00.000Z',
    updated_at: '2026-03-29T00:00:00.000Z',
    extra: {},
  }
}

function makeEngine() {
  return {
    loadDocument: vi.fn(),
    replaceDocument: vi.fn(),
    showCanvasChrome: vi.fn(),
  }
}

function makeSession() {
  let loaded = false
  const engine = makeEngine()
  const acknowledgeSaved = vi.fn(() => 'applied' as const)
  engine.loadDocument.mockImplementation(() => {
    loaded = true
  })
  engine.replaceDocument.mockImplementation((
    _file: CanopiFile,
    _token: unknown,
    finalizeReplacement: () => void,
  ) => {
    loaded = true
    finalizeReplacement()
    return { callerFinalizerInvoked: true }
  })
  return {
    engine,
    loadDocument: engine.loadDocument,
    replaceDocument: engine.replaceDocument,
    showCanvasChrome: engine.showCanvasChrome,
    hideCanvasChrome: vi.fn(),
    zoomToFit: vi.fn(),
    hasLoadedDocument: vi.fn(() => loaded),
    captureForPersistence: vi.fn((metadata: { name: string }, doc: CanopiFile) => ({
      content: { ...doc, name: metadata.name },
      isCurrent: () => true,
      acknowledgeSaved,
    })),
    acknowledgeSaved,
    initializeViewport: vi.fn(),
    attachRulersTo: vi.fn(),
    resize: vi.fn(),
    destroy: vi.fn(),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  resetDesignSessionStateForTests()
  mocks.canvasSession = makeSession()
  mocks.saveDesign.mockReset()
  mocks.saveDesign.mockResolvedValue('/designs/current.canopi')
  mocks.autosaveDesign.mockReset()
  mocks.autosaveDesign.mockResolvedValue(undefined)
  mocks.selectDesignSavePath.mockReset()
  mocks.selectDesignSavePath.mockResolvedValue('/designs/current.canopi')
  mocks.openDesignDialog.mockReset()
  mocks.loadDesign.mockReset()
  mocks.newDesign.mockReset()
  mocks.message.mockReset()

  designSessionFixture.file = makeFile('Current')
  designSessionFixture.name = 'Current'
  designSessionFixture.path = '/designs/current.canopi'
  designSessionFixture.pendingDesignPath = null
  designSessionFixture.pendingTemplateImport = null
  resetDirtyBaselines()
  designSessionFixture.nonCanvasRevision = 0
  designSessionFixture.detachedCanvasDirty = false

  activeTool.value = 'rectangle'
  selectedObjectIds.value = new Set(['selected-1'])
})

describe('document replacement actions', () => {
  it('replaces the active document after discard', async () => {
    designSessionFixture.nonCanvasRevision = 1
    mocks.message.mockResolvedValue("Don't Save")
    mocks.loadDesign.mockResolvedValue(makeFile('Next'))

    await openDesignFromPath('/designs/next.canopi')

    expect(mocks.saveDesign).not.toHaveBeenCalled()
    expect(mocks.loadDesign).toHaveBeenCalledWith('/designs/next.canopi')
    expect(mocks.canvasSession.replaceDocument).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Next', extra: {} }),
      expect.any(Object),
      expect.any(Function),
    )
    expect(currentDesign.value?.name).toBe('Next')
    expect(designName.value).toBe('Next')
    expect(designPath.value).toBe('/designs/next.canopi')
    expect(mocks.canvasSession.showCanvasChrome).toHaveBeenCalled()
    expect(mocks.canvasSession.zoomToFit).toHaveBeenCalled()
  })

  it('cancels replacement before loading when the user cancels', async () => {
    designSessionFixture.nonCanvasRevision = 1
    mocks.message.mockResolvedValue('Cancel')

    await openDesignFromPath('/designs/next.canopi')

    expect(mocks.loadDesign).not.toHaveBeenCalled()
    expect(currentDesign.value?.name).toBe('Current')
    expect(designPath.value).toBe('/designs/current.canopi')
  })

  it('saves first when the user chooses save', async () => {
    mocks.canvasSession.loadDocument(makeFile('Current'))
    designSessionFixture.nonCanvasRevision = 1
    mocks.message.mockResolvedValue('Save')
    mocks.loadDesign.mockResolvedValue(makeFile('Next'))

    await openDesignFromPath('/designs/next.canopi')

    expect(mocks.saveDesign).toHaveBeenCalledWith(
      '/designs/current.canopi',
      expect.objectContaining({ name: 'Current' }),
    )
    expect(mocks.canvasSession.acknowledgeSaved).toHaveBeenCalled()
    expect(currentDesign.value?.name).toBe('Next')
    expect(mocks.canvasSession.zoomToFit).toHaveBeenCalled()
  })

  it('treats save-dialog cancellation as a cancelled replacement', async () => {
    designSessionFixture.nonCanvasRevision = 1
    designSessionFixture.path = null
    mocks.message.mockResolvedValue('Save')
    mocks.selectDesignSavePath.mockRejectedValue(new Error('Dialog cancelled'))

    await openDesignFromPath('/designs/next.canopi')

    expect(mocks.loadDesign).not.toHaveBeenCalled()
    expect(currentDesign.value?.name).toBe('Current')
    expect(designPath.value).toBe(null)
  })

  it('propagates load failures without replacing the document', async () => {
    mocks.loadDesign.mockRejectedValue(new Error('Disk read failed'))

    await expect(openDesignFromPath('/designs/bad.canopi')).rejects.toThrow('Disk read failed')

    expect(mocks.canvasSession.replaceDocument).not.toHaveBeenCalled()
    expect(currentDesign.value?.name).toBe('Current')
  })

  it('cancels queued loads before they apply to a fresh engine', async () => {
    const queued = deferred<CanopiFile>()
    designSessionFixture.pendingDesignPath = '/designs/queued.canopi'
    mocks.loadDesign.mockReturnValue(queued.promise)

    const cancel = consumeQueuedDocumentLoad(mocks.canvasSession)
    cancel()
    queued.resolve(makeFile('Queued'))
    await flushMicrotasks()

    expect(mocks.canvasSession.replaceDocument).not.toHaveBeenCalled()
    expect(currentDesign.value?.name).toBe('Current')
  })

  it('surfaces queued-load failures and keeps the pending path for retry', async () => {
    const queued = deferred<CanopiFile>()
    designSessionFixture.pendingDesignPath = '/designs/broken.canopi'
    mocks.loadDesign.mockReturnValue(queued.promise)

    consumeQueuedDocumentLoad(mocks.canvasSession)
    queued.reject(new Error('Disk read failed'))
    await flushMicrotasks()

    expect(mocks.canvasSession.replaceDocument).not.toHaveBeenCalled()
    expect(pendingDesignPath.value).toBe('/designs/broken.canopi')
    expect(mocks.message).toHaveBeenCalledWith(
      expect.stringContaining('Failed to open broken'),
      expect.objectContaining({ title: 'Open failed', kind: 'error' }),
    )
  })

  it('returns cancelled for template import when the user cancels replacement', async () => {
    designSessionFixture.nonCanvasRevision = 1
    mocks.message.mockResolvedValue('Cancel')

    await expect(openDesignAsTemplate('/tmp/template.canopi', 'Forest Edge')).resolves.toBe('cancelled')

    expect(mocks.loadDesign).not.toHaveBeenCalled()
    expect(currentDesign.value?.name).toBe('Current')
  })

  it('applies a known path while the canvas session is detached', async () => {
    mocks.canvasSession = null
    mocks.loadDesign.mockResolvedValue(makeFile('Next'))

    await openDesignFromPath('/designs/next.canopi')

    expect(mocks.message).not.toHaveBeenCalled()
    expect(mocks.loadDesign).toHaveBeenCalledWith('/designs/next.canopi')
    expect(currentDesign.value?.name).toBe('Next')
    expect(designName.value).toBe('Next')
    expect(designPath.value).toBe('/designs/next.canopi')
    expect(pendingDesignPath.value).toBe(null)
  })

  it('saves before detached replacement when requested by the dirty guard', async () => {
    mocks.canvasSession = null
    designSessionFixture.nonCanvasRevision = 1
    mocks.message.mockResolvedValue('Save')
    mocks.loadDesign.mockResolvedValue(makeFile('Next'))

    await openDesignFromPath('/designs/next.canopi')

    expect(mocks.saveDesign).toHaveBeenCalledWith(
      '/designs/current.canopi',
      expect.objectContaining({ name: 'Current' }),
    )
    expect(mocks.loadDesign).toHaveBeenCalledWith('/designs/next.canopi')
    expect(currentDesign.value?.name).toBe('Next')
  })

  it('queues a known path when neither document state nor canvas session is ready', async () => {
    mocks.canvasSession = null
    designSessionFixture.file = null
    designSessionFixture.path = null

    await openDesignFromPath('/designs/next.canopi')

    expect(mocks.message).not.toHaveBeenCalled()
    expect(mocks.loadDesign).not.toHaveBeenCalled()
    expect(pendingDesignPath.value).toBe('/designs/next.canopi')
  })

  it('does not prompt for unsaved changes when no document is open', async () => {
    designSessionFixture.file = null
    designSessionFixture.path = null
    designSessionFixture.nonCanvasRevision = 1
    designSessionFixture.detachedCanvasDirty = true
    mocks.loadDesign.mockResolvedValue(makeFile('Next'))

    await openDesignFromPath('/designs/next.canopi')

    expect(mocks.message).not.toHaveBeenCalled()
    expect(mocks.loadDesign).toHaveBeenCalledWith('/designs/next.canopi')
    expect(currentDesign.value).toEqual(expect.objectContaining({ name: 'Next' }))
  })

  it('opens template imports while the canvas session is detached', async () => {
    mocks.canvasSession = null
    mocks.loadDesign.mockResolvedValue(makeFile('Downloaded Template'))

    await expect(openDesignAsTemplate('/tmp/template.canopi', 'Forest Edge')).resolves.toBe('opened')
    expect(mocks.loadDesign).toHaveBeenCalledWith('/tmp/template.canopi')
    expect(currentDesign.value?.name).toBe('Downloaded Template')
    expect(designName.value).toBe('Forest Edge')
    expect(designPath.value).toBe(null)
    expect(pendingTemplateImport.value).toBe(null)
  })

  it('queues template imports when neither document state nor canvas session is ready', async () => {
    mocks.canvasSession = null
    designSessionFixture.file = null
    designSessionFixture.path = null
    mocks.loadDesign.mockResolvedValue(makeFile('Downloaded Template'))

    await expect(openDesignAsTemplate('/tmp/template.canopi', 'Forest Edge')).resolves.toBe('queued')
    expect(pendingTemplateImport.value).toEqual({ path: '/tmp/template.canopi', name: 'Forest Edge' })

    const nextSession = makeSession()
    const cancel = consumeQueuedDocumentLoad(nextSession as any)
    await flushMicrotasks()

    expect(mocks.loadDesign).toHaveBeenCalledWith('/tmp/template.canopi')
    expect(nextSession.replaceDocument).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Downloaded Template', extra: {} }),
      expect.any(Object),
      expect.any(Function),
    )
    expect(nextSession.zoomToFit).toHaveBeenCalled()
    expect(designName.value).toBe('Forest Edge')
    expect(designPath.value).toBe(null)
    expect(pendingTemplateImport.value).toBe(null)
    cancel()
  })

  it('opens from the file dialog while the canvas session is detached', async () => {
    mocks.canvasSession = null
    mocks.openDesignDialog.mockResolvedValue({
      file: makeFile('Dialog Pick'),
      path: '/designs/dialog.canopi',
    })

    await openDesign()

    expect(mocks.openDesignDialog).toHaveBeenCalledTimes(1)
    expect(currentDesign.value?.name).toBe('Dialog Pick')
    expect(designName.value).toBe('Dialog Pick')
    expect(designPath.value).toBe('/designs/dialog.canopi')
  })

  it('creates a new design while the canvas session is detached', async () => {
    mocks.canvasSession = null
    mocks.newDesign.mockResolvedValue(makeFile('Untitled'))

    await newDesignAction()

    expect(mocks.newDesign).toHaveBeenCalledTimes(1)
    expect(currentDesign.value?.name).toBe('Untitled')
    expect(designName.value).toBe('Untitled')
    expect(designPath.value).toBe(null)
  })

  it('saves the canonical document snapshot when no canvas session is mounted', async () => {
    mocks.canvasSession = null
    designSessionFixture.name = 'Detached'

    await saveCurrentDesign()

    expect(mocks.saveDesign).toHaveBeenCalledWith(
      '/designs/current.canopi',
      expect.objectContaining({ name: 'Detached' }),
    )
    expect(designName.value).toBe('Detached')
  })
})
