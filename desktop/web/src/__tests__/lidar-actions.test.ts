import { beforeEach, describe, expect, it, vi } from 'vitest'

const importItemMock = vi.hoisted(() => vi.fn())
const retryImportMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const dismissImportMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const renameLayerMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const renameAnalysisMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const retryAnalysisMock = vi.hoisted(() => vi.fn())
const deleteLayerMock = vi.hoisted(() => vi.fn())
const deleteAnalysisMock = vi.hoisted(() => vi.fn())
const cancelAnalysisMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
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
  lidarDeleteAnalysis: deleteAnalysisMock,
  lidarDeleteLayer: deleteLayerMock,
  lidarDeleteLayerImpact: vi.fn(),
  lidarDismissImport: dismissImportMock,
  lidarImportItem: importItemMock,
  lidarLayerCollection: vi.fn(),
  lidarRenameAnalysis: renameAnalysisMock,
  lidarRenameLayer: renameLayerMock,
  lidarRetryAnalysis: retryAnalysisMock,
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
import {
  addToDesign,
  cancelAnalysisJob,
  chooseImportFiles,
  deleteLibraryItem,
  dismissLibraryImport,
  importLibraryItem,
  moveReference,
  removeFromDesign,
  renameLibraryItem,
  retryFailedCalculation,
  retryLibraryImport,
  runningAnalysisJobId,
  setLidarEntryVisibility,
} from '../app/lidar/actions'
import { lidarStatusMessage } from '../app/lidar/library-store'

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
    await renameLibraryItem('Source', 'layer-1', 'Terrain')
    await renameLibraryItem('Analysis', 'analysis-1', 'Steepness')
    await retryLibraryImport('layer-2')
    await dismissLibraryImport('layer-3')

    expect(renameLayerMock).toHaveBeenCalledWith('layer-1', 'Terrain')
    expect(renameAnalysisMock).toHaveBeenCalledWith('analysis-1', 'Steepness')
    expect(retryImportMock).toHaveBeenCalledWith('layer-2')
    expect(dismissImportMock).toHaveBeenCalledWith('layer-3')
    expect(designEdits()).toBe(0)
  })

  it('publishes and rethrows a refused library operation', async () => {
    renameLayerMock.mockRejectedValueOnce(new Error('name is empty'))
    await expect(renameLibraryItem('Source', 'layer-1', ' ')).rejects.toThrow('name is empty')
    expect(lidarStatusMessage.value).toBe('name is empty')
  })

  it('removes the deleted item from the Design that asked for the deletion', async () => {
    deleteAnalysisMock.mockResolvedValue(undefined)
    await deleteLibraryItem('Analysis', 'analysis-1')

    expect(removeMock).toHaveBeenCalledWith(['analysis-1'])
    expect(reconcileInspectionMock).toHaveBeenCalled()
  })

  it('does not remove references from a Design opened during deletion', async () => {
    const pending = deferred<void>()
    deleteLayerMock.mockReturnValue(pending.promise)
    const deletion = deleteLibraryItem('Source', 'layer-1')

    sessionIdentity.value = 'design-b'
    pending.resolve()
    await deletion

    expect(refreshMock).toHaveBeenCalled()
    expect(removeMock).not.toHaveBeenCalled()
  })

  it('keeps the Design unchanged when the library refuses a deletion', async () => {
    deleteLayerMock.mockRejectedValue(new Error('saved results depend on this data'))
    await expect(deleteLibraryItem('Source', 'layer-1')).rejects.toThrow()
    expect(removeMock).not.toHaveBeenCalled()
  })

  it('remembers the job a retried calculation started so Cancel can name it', async () => {
    retryAnalysisMock.mockResolvedValue({ definition_id: 'analysis-1', job_id: 'job-7' })
    await retryFailedCalculation('analysis-1', 'generation-1')

    expect(retryAnalysisMock).toHaveBeenCalledWith('analysis-1', 'generation-1')
    expect(runningAnalysisJobId('analysis-1')).toBe('job-7')
    await expect(cancelAnalysisJob('analysis-1')).resolves.toBe(true)
    expect(cancelAnalysisMock).toHaveBeenCalledWith('job-7')
    expect(runningAnalysisJobId('analysis-1')).toBeNull()
  })

  it('cancels only a calculation this session started', async () => {
    await expect(cancelAnalysisJob('analysis-unknown')).resolves.toBe(false)
    expect(cancelAnalysisMock).not.toHaveBeenCalled()
  })
})

describe('Design data references', () => {
  beforeEach(() => vi.clearAllMocks())

  it('adds and removes references through Design Edit', () => {
    addToDesign('Analysis', 'analysis-1')
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
