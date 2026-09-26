import { beforeEach, describe, expect, it, vi } from 'vitest'

const importItemMock = vi.hoisted(() => vi.fn())
const retryImportMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const dismissImportMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const renameItemMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const rerunAnalysisMock = vi.hoisted(() => vi.fn())
const deleteItemMock = vi.hoisted(() => vi.fn())
const historyMock = vi.hoisted(() => vi.fn())
const cancelAnalysisMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const createAnalysisMock = vi.hoisted(() => vi.fn())
const upsertMock = vi.hoisted(() => vi.fn())
const removeMock = vi.hoisted(() => vi.fn())
const moveMock = vi.hoisted(() => vi.fn())
const patchMock = vi.hoisted(() => vi.fn())
const refreshMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const ensurePollingMock = vi.hoisted(() => vi.fn())
const reconcileInspectionMock = vi.hoisted(() => vi.fn())
const sessionIdentity = vi.hoisted(() => ({ value: 'design-a' as string | null }))

vi.mock('../ipc/lidar', () => ({
  lidarCancelAnalysisJob: cancelAnalysisMock,
  lidarCancelImport: vi.fn().mockResolvedValue(undefined),
  lidarCreateAnalysis: createAnalysisMock,
  lidarDeleteImpact: vi.fn(),
  lidarDeleteItem: deleteItemMock,
  lidarDismissImport: dismissImportMock,
  lidarImportItem: importItemMock,
  lidarLayerCollection: vi.fn(),
  lidarProcessingHistory: historyMock,
  lidarRenameItem: renameItemMock,
  lidarRerunAnalysis: rerunAnalysisMock,
  lidarRetryImport: retryImportMock,
}))

vi.mock('../app/design-edit/lidar', () => ({
  moveLidarEntry: moveMock,
  patchLidarEntryById: patchMock,
  removeLidarEntries: removeMock,
  upsertLidarEntry: upsertMock,
}))

vi.mock('../app/lidar/library-store', async () => {
  const { signal: makeSignal } = await import('@preact/signals')
  return {
    ensureLidarPolling: ensurePollingMock,
    lidarStatusMessage: makeSignal<string | null>(null),
    presentationEntryKind: (role: string) => (role === 'Derived' ? 'Analysis' : 'Source'),
    refreshLidarLibrary: refreshMock,
  }
})

vi.mock('../app/lidar/inspection', () => ({
  reconcileInspectionWithPresentation: reconcileInspectionMock,
}))

vi.mock('../app/document-session/store', () => ({
  designSessionStore: { sessionIdentity },
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

import { open } from '@tauri-apps/plugin-dialog'
import type { AnalysisRequest, LibraryItemSummary } from '../generated/contracts'
import {
  addToDesign,
  cancelAnalysisJob,
  chooseImportFiles,
  deleteLibraryItem,
  dismissLibraryImport,
  fetchProcessingHistory,
  importLibraryItem,
  moveReference,
  removeFromDesign,
  renameLibraryItem,
  rerunAnalysis,
  retryLibraryImport,
  runAnalysis,
  setLidarEntryVisibility,
  settleResultAttachments,
} from '../app/lidar/actions'
import { lidarStatusMessage } from '../app/lidar/library-store'
import { librarySnapshot, slopeItem } from './support/library-fixtures'

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(next => { resolve = next })
  return { promise, resolve }
}

const designEdits = () => [upsertMock, removeMock, moveMock, patchMock]
  .reduce((total, mock) => total + mock.mock.calls.length, 0)

describe('Data Library actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionIdentity.value = 'design-a'
    lidarStatusMessage.value = null
  })

  it('creates nothing when the file chooser is cancelled', async () => {
    vi.mocked(open).mockResolvedValue(null)
    await expect(chooseImportFiles('Choose')).resolves.toBeNull()
    expect(importItemMock).not.toHaveBeenCalled()
  })

  it('imports into the library only, in the listed priority order', async () => {
    importItemMock.mockResolvedValue({ layer_id: 'layer-1', job_id: 'job-1' })
    await importLibraryItem(['/b.tif', '/a.tif'], 'Ground', 'GroundElevation', { label: 'm', unknown: false })

    expect(importItemMock).toHaveBeenCalledWith('Ground', 'GroundElevation', { label: 'm', unknown: false }, ['/b.tif', '/a.tif'])
    expect(ensurePollingMock).toHaveBeenCalled()
    expect(designEdits()).toBe(0)
  })

  it('never edits the Design for rename, retry or dismiss', async () => {
    await renameLibraryItem('layer-1', 'Terrain')
    await renameLibraryItem('analysis-1', 'Steepness')
    await retryLibraryImport('layer-2')
    await dismissLibraryImport('layer-3')

    expect(renameItemMock).toHaveBeenCalledWith('layer-1', 'Terrain')
    expect(renameItemMock).toHaveBeenCalledWith('analysis-1', 'Steepness')
    expect(retryImportMock).toHaveBeenCalledWith('layer-2')
    expect(dismissImportMock).toHaveBeenCalledWith('layer-3')
    expect(designEdits()).toBe(0)
  })

  it('publishes and rethrows a refused library operation', async () => {
    renameItemMock.mockRejectedValueOnce(new Error('name is empty'))
    await expect(renameLibraryItem('layer-1', ' ')).rejects.toThrow('name is empty')
    expect(lidarStatusMessage.value).toBe('name is empty')
  })

  it('removes the deleted item from the Design that asked for the deletion', async () => {
    deleteItemMock.mockResolvedValue(undefined)
    await deleteLibraryItem('analysis-1')

    expect(removeMock).toHaveBeenCalledWith(['analysis-1'])
    expect(reconcileInspectionMock).toHaveBeenCalled()
  })

  it('does not remove references from a Design opened during deletion', async () => {
    const pending = deferred<void>()
    deleteItemMock.mockReturnValue(pending.promise)
    const deletion = deleteLibraryItem('layer-1')

    sessionIdentity.value = 'design-b'
    pending.resolve()
    await deletion

    expect(refreshMock).toHaveBeenCalled()
    expect(removeMock).not.toHaveBeenCalled()
  })

  it('keeps the Design unchanged when the library refuses a deletion', async () => {
    deleteItemMock.mockRejectedValue(new Error('saved results depend on this data'))
    await expect(deleteLibraryItem('layer-1')).rejects.toThrow()
    expect(removeMock).not.toHaveBeenCalled()
  })

  it('cancels the running job the snapshot reports, and nothing when none runs', async () => {
    await expect(cancelAnalysisJob({ run: { job_id: 'job-7', state: 'Preparing', message: null } })).resolves.toBe(true)
    expect(cancelAnalysisMock).toHaveBeenCalledWith('job-7')

    await expect(cancelAnalysisJob({ run: { job_id: 'job-8', state: 'Complete', message: null } })).resolves.toBe(false)
    await expect(cancelAnalysisJob({ run: null })).resolves.toBe(false)
    expect(cancelAnalysisMock).toHaveBeenCalledTimes(1)
  })

  it('reads one page of processing history', async () => {
    historyMock.mockResolvedValue({ definition_id: 'd', runs: [], next_cursor: null })
    await fetchProcessingHistory('d', 'cursor-2')
    expect(historyMock).toHaveBeenCalledWith('d', 'cursor-2')
  })
})

describe('Design data references', () => {
  beforeEach(() => vi.clearAllMocks())

  it('adds and removes references through Design Edit', () => {
    addToDesign('Derived', 'analysis-1')
    removeFromDesign('analysis-1')

    expect(upsertMock).toHaveBeenCalledWith('Analysis', 'analysis-1')
    expect(removeMock).toHaveBeenCalledWith(['analysis-1'])
  })

  it('ends inspection in the same interaction that hides a reference', () => {
    setLidarEntryVisibility('layer-1', false)
    expect(patchMock).toHaveBeenCalledWith('layer-1', { visible: false })
    expect(reconcileInspectionMock).toHaveBeenCalled()
  })

  it('maps front and back onto the saved back-to-front order', () => {
    moveReference('layer-1', 'front')
    moveReference('layer-1', 'back')
    expect(moveMock.mock.calls).toEqual([['layer-1', 'down'], ['layer-1', 'up']])
  })
})

const SLOPE_REQUEST: AnalysisRequest = {
  analysis_id: 'terrain.slope',
  inputs: [{ key: 'dem', item_id: 'layer-1' }],
  parameters: [{ key: 'unit', value: { Choice: 'percent' } }],
  outputs: ['slope'],
  name: 'North slope',
}

function snapshotWith(...items: Array<Partial<LibraryItemSummary> & { id: string }>) {
  return librarySnapshot(items.map((item) => slopeItem(item.id, 'layer-1', {
    generation_id: null, state: 'Preparing', run: { job_id: 'job', state: 'Preparing', message: null }, ...item,
  })))
}

describe('analysis runs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionIdentity.value = 'design-a'
    let sequence = 0
    createAnalysisMock.mockImplementation(async () => {
      sequence += 1
      return { definition_id: `adef-${sequence}`, job_id: `job-${sequence}`, item_ids: [`item-${sequence}`] }
    })
  })

  it('creates a separate definition each time, saved to the library only', async () => {
    const first = await runAnalysis(SLOPE_REQUEST, false)
    const second = await runAnalysis(SLOPE_REQUEST, false)

    expect(first.definition_id).not.toBe(second.definition_id)
    expect(createAnalysisMock).toHaveBeenCalledWith(SLOPE_REQUEST)
    expect(ensurePollingMock).toHaveBeenCalled()
    settleResultAttachments(snapshotWith({ id: 'item-1', state: 'Ready', generation_id: 'g' }))
    expect(designEdits()).toBe(0)
  })

  it('adds a Layers-initiated result to the asking Design once it is published', async () => {
    const receipt = await runAnalysis(SLOPE_REQUEST, true)
    const id = receipt.item_ids[0]!
    settleResultAttachments(snapshotWith({ id }))
    expect(upsertMock).not.toHaveBeenCalled()

    settleResultAttachments(snapshotWith({ id, state: 'Ready', generation_id: 'agen-1' }))
    settleResultAttachments(snapshotWith({ id, state: 'Ready', generation_id: 'agen-1' }))
    expect(upsertMock).toHaveBeenCalledTimes(1)
    expect(upsertMock).toHaveBeenCalledWith('Analysis', id)
  })

  it('attaches every presentable output in order once all are published, never provenance-only ones', async () => {
    createAnalysisMock.mockResolvedValueOnce({ definition_id: 'multi', job_id: 'job', item_ids: ['first', 'hidden', 'second'] })
    await runAnalysis(SLOPE_REQUEST, true)
    const hidden = { id: 'hidden', provenance: { ...slopeItem('hidden', 'layer-1').provenance!, output_key: 'not-presentable' } }

    settleResultAttachments(snapshotWith({ id: 'first', state: 'Ready', generation_id: 'g1' }, hidden, { id: 'second' }))
    expect(upsertMock).not.toHaveBeenCalled()

    settleResultAttachments(snapshotWith(
      { id: 'first', state: 'Ready', generation_id: 'g1' },
      { ...hidden, state: 'Ready', generation_id: 'g2' },
      { id: 'second', state: 'Ready', generation_id: 'g3' },
    ))
    expect(upsertMock.mock.calls).toEqual([['Analysis', 'first'], ['Analysis', 'second']])
  })

  it('never adds the result to a Design opened while it was calculating', async () => {
    const { item_ids: [id] } = await runAnalysis(SLOPE_REQUEST, true)
    sessionIdentity.value = 'design-b'
    settleResultAttachments(snapshotWith({ id: id!, state: 'Ready', generation_id: 'agen-1' }))
    sessionIdentity.value = 'design-a'
    settleResultAttachments(snapshotWith({ id: id!, state: 'Ready', generation_id: 'agen-1' }))
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('drops the request when the run fails or is cancelled', async () => {
    const { item_ids: [failed] } = await runAnalysis(SLOPE_REQUEST, true)
    settleResultAttachments(snapshotWith({ id: failed!, state: 'Failed', run: { job_id: 'j', state: 'Failed', message: 'engine stopped' } }))
    settleResultAttachments(snapshotWith({ id: failed!, state: 'Ready', generation_id: 'agen-9' }))

    const { item_ids: [cancelled] } = await runAnalysis(SLOPE_REQUEST, true)
    settleResultAttachments(snapshotWith({ id: cancelled!, state: 'Failed', run: { job_id: 'j', state: 'Cancelled', message: null } }))
    settleResultAttachments(snapshotWith({ id: cancelled!, state: 'Ready', generation_id: 'agen-9' }))
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('refreshes or retries a definition in place, without editing the Design', async () => {
    rerunAnalysisMock.mockResolvedValue({ definition_id: 'adef-1', job_id: 'job-9', item_ids: ['item-1'] })
    await expect(rerunAnalysis('adef-1')).resolves.toMatchObject({ job_id: 'job-9' })
    expect(rerunAnalysisMock).toHaveBeenCalledWith('adef-1')
    expect(ensurePollingMock).toHaveBeenCalled()
    settleResultAttachments(snapshotWith({ id: 'item-1', state: 'Ready', generation_id: 'g' }))
    expect(designEdits()).toBe(0)
  })

  it('publishes a refused run through the shared status', async () => {
    createAnalysisMock.mockRejectedValueOnce(new Error('unit is required'))
    await expect(runAnalysis(SLOPE_REQUEST, true)).rejects.toThrow('unit is required')
    expect(lidarStatusMessage.value).toBe('unit is required')
  })
})
