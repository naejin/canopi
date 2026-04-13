import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  return {
    canvasSession: null as any,
    extractExtra: vi.fn(() => ({ imported: true })),
    saveDesign: vi.fn(),
    saveDesignAs: vi.fn(),
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
  }
})

vi.mock('../state/document-extra', () => ({
  extractExtra: mocks.extractExtra,
}))

vi.mock('../ipc/design', () => ({
  saveDesign: mocks.saveDesign,
  saveDesignAs: mocks.saveDesignAs,
  openDesignDialog: mocks.openDesignDialog,
  loadDesign: mocks.loadDesign,
  newDesign: mocks.newDesign,
}))

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

import {
  activeTool,
  lockedObjectIds,
  selectedObjectIds,
} from '../state/canvas'
import {
  currentDesign,
  designName,
  designPath,
  detachedCanvasDirty,
  nonCanvasRevision,
  pendingDesignPath,
  pendingTemplateImport,
  resetDirtyBaselines,
} from '../state/design'
import {
  consumeQueuedDocumentLoad,
  openDesignAsTemplate,
  openDesignFromPath,
  saveCurrentDesign,
} from '../state/document-actions'
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
    created_at: '2026-03-29T00:00:00.000Z',
    updated_at: '2026-03-29T00:00:00.000Z',
    extra: {},
  }
}

function makeEngine() {
  return {
    loadDocument: vi.fn(),
    replaceDocument: vi.fn(),
    history: {
      clear: vi.fn(),
      markSaved: vi.fn(),
    },
    showCanvasChrome: vi.fn(),
  }
}

function makeSession() {
  const engine = makeEngine()
  return {
    engine,
    replaceDocument: engine.replaceDocument,
    showCanvasChrome: engine.showCanvasChrome,
    zoomToFit: vi.fn(),
    clearHistory: engine.history.clear,
    markSaved: engine.history.markSaved,
    serializeDocument: vi.fn((metadata: { name: string }) => makeFile(metadata.name)),
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
}

beforeEach(() => {
  mocks.canvasSession = makeSession()
  mocks.extractExtra.mockReset()
  mocks.extractExtra.mockReturnValue({ imported: true })
  mocks.saveDesign.mockReset()
  mocks.saveDesign.mockResolvedValue('/designs/current.canopi')
  mocks.saveDesignAs.mockReset()
  mocks.openDesignDialog.mockReset()
  mocks.loadDesign.mockReset()
  mocks.newDesign.mockReset()
  mocks.message.mockReset()

  currentDesign.value = makeFile('Current')
  designName.value = 'Current'
  designPath.value = '/designs/current.canopi'
  pendingDesignPath.value = null
  pendingTemplateImport.value = null
  resetDirtyBaselines()
  nonCanvasRevision.value = 0
  detachedCanvasDirty.value = false

  activeTool.value = 'rectangle'
  selectedObjectIds.value = new Set(['selected-1'])
  lockedObjectIds.value = new Set(['locked-1'])
  mocks.canvasSession.serializeDocument.mockClear()
})

describe('document replacement actions', () => {
  it('replaces the active document after discard', async () => {
    nonCanvasRevision.value = 1
    mocks.message.mockResolvedValue("Don't Save")
    mocks.loadDesign.mockResolvedValue(makeFile('Next'))

    await openDesignFromPath('/designs/next.canopi')

    expect(mocks.saveDesign).not.toHaveBeenCalled()
    expect(mocks.loadDesign).toHaveBeenCalledWith('/designs/next.canopi')
    expect(mocks.canvasSession.replaceDocument).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Next', extra: { imported: true } }),
    )
    expect(currentDesign.value?.name).toBe('Next')
    expect(designName.value).toBe('Next')
    expect(designPath.value).toBe('/designs/next.canopi')
    expect(mocks.canvasSession.engine.history.clear).toHaveBeenCalled()
    expect(mocks.canvasSession.showCanvasChrome).toHaveBeenCalled()
    expect(mocks.canvasSession.zoomToFit).toHaveBeenCalled()
  })

  it('cancels replacement before loading when the user cancels', async () => {
    nonCanvasRevision.value = 1
    mocks.message.mockResolvedValue('Cancel')

    await openDesignFromPath('/designs/next.canopi')

    expect(mocks.loadDesign).not.toHaveBeenCalled()
    expect(currentDesign.value?.name).toBe('Current')
    expect(designPath.value).toBe('/designs/current.canopi')
  })

  it('saves first when the user chooses save', async () => {
    nonCanvasRevision.value = 1
    mocks.message.mockResolvedValue('Save')
    mocks.loadDesign.mockResolvedValue(makeFile('Next'))

    await openDesignFromPath('/designs/next.canopi')

    expect(mocks.saveDesign).toHaveBeenCalledWith(
      '/designs/current.canopi',
      expect.objectContaining({ name: 'Current' }),
    )
    expect(mocks.canvasSession.engine.history.markSaved).toHaveBeenCalled()
    expect(currentDesign.value?.name).toBe('Next')
    expect(mocks.canvasSession.zoomToFit).toHaveBeenCalled()
  })

  it('treats save-dialog cancellation as a cancelled replacement', async () => {
    nonCanvasRevision.value = 1
    designPath.value = null
    mocks.message.mockResolvedValue('Save')
    mocks.saveDesignAs.mockRejectedValue(new Error('Dialog cancelled'))

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
    pendingDesignPath.value = '/designs/queued.canopi'
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
    pendingDesignPath.value = '/designs/broken.canopi'
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
    nonCanvasRevision.value = 1
    mocks.message.mockResolvedValue('Cancel')

    await expect(openDesignAsTemplate('/tmp/template.canopi', 'Forest Edge')).resolves.toBe('cancelled')

    expect(mocks.loadDesign).not.toHaveBeenCalled()
    expect(currentDesign.value?.name).toBe('Current')
  })

  it('queues the path without loading when engine is null', async () => {
    mocks.canvasSession = null

    await openDesignFromPath('/designs/next.canopi')

    expect(mocks.message).not.toHaveBeenCalled()
    expect(mocks.loadDesign).not.toHaveBeenCalled()
    expect(currentDesign.value?.name).toBe('Current')
    expect(pendingDesignPath.value).toBe('/designs/next.canopi')
  })

  it('does not prompt for unsaved changes when no document is open', async () => {
    currentDesign.value = null
    designPath.value = null
    nonCanvasRevision.value = 1
    detachedCanvasDirty.value = true
    mocks.loadDesign.mockResolvedValue(makeFile('Next'))

    await openDesignFromPath('/designs/next.canopi')

    expect(mocks.message).not.toHaveBeenCalled()
    expect(mocks.loadDesign).toHaveBeenCalledWith('/designs/next.canopi')
    expect(currentDesign.value).toEqual(expect.objectContaining({ name: 'Next' }))
  })

  it('queues template imports when the canvas engine is not ready, then applies them as unsaved designs', async () => {
    mocks.canvasSession = null
    mocks.loadDesign.mockResolvedValue(makeFile('Downloaded Template'))

    await expect(openDesignAsTemplate('/tmp/template.canopi', 'Forest Edge')).resolves.toBe('queued')
    expect(pendingTemplateImport.value).toEqual({ path: '/tmp/template.canopi', name: 'Forest Edge' })

    const nextSession = makeSession()
    const cancel = consumeQueuedDocumentLoad(nextSession as any)
    await flushMicrotasks()

    expect(mocks.loadDesign).toHaveBeenCalledWith('/tmp/template.canopi')
    expect(nextSession.replaceDocument).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Downloaded Template', extra: { imported: true } }),
    )
    expect(nextSession.zoomToFit).toHaveBeenCalled()
    expect(designName.value).toBe('Forest Edge')
    expect(designPath.value).toBe(null)
    expect(pendingTemplateImport.value).toBe(null)
    cancel()
  })

  it('saves the canonical document snapshot when no canvas session is mounted', async () => {
    mocks.canvasSession = null
    designName.value = 'Detached'

    await saveCurrentDesign()

    expect(mocks.saveDesign).toHaveBeenCalledWith(
      '/designs/current.canopi',
      expect.objectContaining({ name: 'Detached' }),
    )
    expect(designName.value).toBe('Detached')
  })
})
