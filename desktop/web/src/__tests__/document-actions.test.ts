import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  return {
    canvasEngine: null as any,
    toCanopi: vi.fn(),
    extractExtra: vi.fn(() => ({ imported: true })),
    saveDesign: vi.fn(),
    saveDesignAs: vi.fn(),
    openDesignDialog: vi.fn(),
    loadDesign: vi.fn(),
    newDesign: vi.fn(),
    message: vi.fn(),
  }
})

vi.mock('../canvas/engine', () => ({
  get canvasEngine() {
    return mocks.canvasEngine
  },
}))

vi.mock('../canvas/serializer', () => ({
  toCanopi: mocks.toCanopi,
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
  highlightedConsortium,
  lockedObjectIds,
  selectedObjectIds,
} from '../state/canvas'
import {
  currentDesign,
  designName,
  designPath,
  nonCanvasRevision,
  pendingDesignPath,
  pendingTemplateImport,
  resetDirtyBaselines,
} from '../state/design'
import {
  consumeQueuedDocumentLoad,
  openDesignAsTemplate,
  openDesignFromPath,
} from '../state/document-actions'
import type { CanopiFile } from '../types/design'

function makeFile(name: string): CanopiFile {
  return {
    version: 1,
    name,
    description: null,
    location: null,
    north_bearing_deg: 0,
    layers: [],
    plants: [],
    zones: [],
    consortiums: [],
    timeline: [],
    budget: [],
    created_at: '2026-03-29T00:00:00.000Z',
    updated_at: '2026-03-29T00:00:00.000Z',
  }
}

function makeEngine() {
  return {
    loadDocument: vi.fn(),
    history: {
      clear: vi.fn(),
      markSaved: vi.fn(),
    },
    showCanvasChrome: vi.fn(),
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
  mocks.canvasEngine = makeEngine()
  mocks.toCanopi.mockReset()
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

  activeTool.value = 'rectangle'
  selectedObjectIds.value = new Set(['selected-1'])
  lockedObjectIds.value = new Set(['locked-1'])
  highlightedConsortium.value = 'consortium-1'

  mocks.toCanopi.mockImplementation((_engine: unknown, metadata: { name: string }) => {
    return makeFile(metadata.name)
  })
})

describe('document replacement actions', () => {
  it('replaces the active document after discard', async () => {
    nonCanvasRevision.value = 1
    mocks.message.mockResolvedValue("Don't Save")
    mocks.loadDesign.mockResolvedValue(makeFile('Next'))

    await openDesignFromPath('/designs/next.canopi')

    expect(mocks.saveDesign).not.toHaveBeenCalled()
    expect(mocks.loadDesign).toHaveBeenCalledWith('/designs/next.canopi')
    expect(mocks.canvasEngine.loadDocument).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Next', extra: { imported: true } }),
    )
    expect(currentDesign.value?.name).toBe('Next')
    expect(designName.value).toBe('Next')
    expect(designPath.value).toBe('/designs/next.canopi')
    expect(activeTool.value).toBe('select')
    expect(selectedObjectIds.value.size).toBe(0)
    expect(lockedObjectIds.value.size).toBe(0)
    expect(highlightedConsortium.value).toBe(null)
    expect(mocks.canvasEngine.history.clear).toHaveBeenCalled()
    expect(mocks.canvasEngine.showCanvasChrome).toHaveBeenCalled()
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
    expect(mocks.canvasEngine.history.markSaved).toHaveBeenCalled()
    expect(currentDesign.value?.name).toBe('Next')
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

    expect(mocks.canvasEngine.loadDocument).not.toHaveBeenCalled()
    expect(currentDesign.value?.name).toBe('Current')
  })

  it('cancels queued loads before they apply to a fresh engine', async () => {
    const queued = deferred<CanopiFile>()
    pendingDesignPath.value = '/designs/queued.canopi'
    mocks.loadDesign.mockReturnValue(queued.promise)

    const cancel = consumeQueuedDocumentLoad(mocks.canvasEngine)
    cancel()
    queued.resolve(makeFile('Queued'))
    await flushMicrotasks()

    expect(mocks.canvasEngine.loadDocument).not.toHaveBeenCalled()
    expect(currentDesign.value?.name).toBe('Current')
  })

  it('surfaces queued-load failures and keeps the pending path for retry', async () => {
    const queued = deferred<CanopiFile>()
    pendingDesignPath.value = '/designs/broken.canopi'
    mocks.loadDesign.mockReturnValue(queued.promise)

    consumeQueuedDocumentLoad(mocks.canvasEngine)
    queued.reject(new Error('Disk read failed'))
    await flushMicrotasks()

    expect(mocks.canvasEngine.loadDocument).not.toHaveBeenCalled()
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
    mocks.canvasEngine = null

    await openDesignFromPath('/designs/next.canopi')

    expect(mocks.message).not.toHaveBeenCalled()
    expect(mocks.loadDesign).not.toHaveBeenCalled()
    expect(currentDesign.value?.name).toBe('Current')
    expect(pendingDesignPath.value).toBe('/designs/next.canopi')
  })

  it('queues template imports when the canvas engine is not ready, then applies them as unsaved designs', async () => {
    mocks.canvasEngine = null
    mocks.loadDesign.mockResolvedValue(makeFile('Downloaded Template'))

    await expect(openDesignAsTemplate('/tmp/template.canopi', 'Forest Edge')).resolves.toBe('queued')
    expect(pendingTemplateImport.value).toEqual({ path: '/tmp/template.canopi', name: 'Forest Edge' })

    const nextEngine = makeEngine()
    const cancel = consumeQueuedDocumentLoad(nextEngine as any)
    await flushMicrotasks()

    expect(mocks.loadDesign).toHaveBeenCalledWith('/tmp/template.canopi')
    expect(nextEngine.loadDocument).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Downloaded Template', extra: { imported: true } }),
    )
    expect(designName.value).toBe('Forest Edge')
    expect(designPath.value).toBe(null)
    expect(pendingTemplateImport.value).toBe(null)
    cancel()
  })
})
