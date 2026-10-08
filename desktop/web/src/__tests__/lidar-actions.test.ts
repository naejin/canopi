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
const presentation = vi.hoisted(() => ({ value: [] as Array<{
  id: string
  order: number
  parentId: string | null
  itemType?: { kind: 'Raster'; quantity: RasterQuantity } | null
  units?: string
}> }))

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

vi.mock('../app/design-edit/lidar', async (importOriginal) => ({
  sameColourRange: (await importOriginal<typeof import('../app/design-edit/lidar')>()).sameColourRange,
  setLidarEntryOrders: moveMock,
  patchLidarEntryById: patchMock,
  removeLidarEntries: removeMock,
  upsertLidarEntry: upsertMock,
}))

vi.mock('../app/lidar/library-store', async () => {
  const { signal: makeSignal } = await import('@preact/signals')
  return {
    ensureLidarPolling: ensurePollingMock,
    libraryItemName: (item: { id: string; name: string | null }) => item.name ?? `${item.id} name`,
    lidarLibrary: makeSignal(null),
    lidarStatusMessage: makeSignal<string | null>(null),
    readCurrentLidarPresentation: () => presentation.value,
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
import type { AnalysisRequest, LibraryItemSummary, RasterQuantity } from '../generated/contracts'
import {
  addToDesign,
  cancelAnalysisJob,
  chooseImportFiles,
  deleteLibraryItem,
  dismissLibraryImport,
  fetchProcessingHistory,
  importLibraryItem,
  moveReference,
  moveReferenceTo,
  removeFromDesign,
  renameLibraryItem,
  rerunAnalysis,
  retryLibraryImport,
  runAnalysis,
  setLidarEntryDisplay,
  setLidarEntryVisibility,
  attachmentFailure,
  dismissAttachmentFailure,
  pendingAttachments,
  settleResultAttachments,
} from '../app/lidar/actions'
import { lidarStatusMessage } from '../app/lidar/library-store'
import { librarySnapshot, slopeItem, sourceItem } from './support/library-fixtures'

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
    await expect(chooseImportFiles('Choose', 'GeoTIFF')).resolves.toBeNull()
    expect(importItemMock).not.toHaveBeenCalled()
  })

  it('offers GeoTIFF files in the chooser', async () => {
    vi.mocked(open).mockResolvedValue(['/a.tif'])
    await expect(chooseImportFiles('Choose', 'GeoTIFF rasters')).resolves.toEqual(['/a.tif'])
    expect(open).toHaveBeenCalledWith(expect.objectContaining({
      multiple: true,
      filters: [{ name: 'GeoTIFF rasters', extensions: ['tif', 'tiff'] }],
    }))
  })

  it('adds an import started from Layers to the asking Design once it is published', async () => {
    importItemMock.mockResolvedValue({ layer_id: 'layer-9', job_id: 'job-9' })
    await importLibraryItem(['/a.tif'], 'Ground', 'GroundElevation', { label: null, unknown: false }, true)
    const importing = librarySnapshot([sourceItem('layer-9', 'Ground', {
      state: 'Preparing', generation_id: null,
      import_job: { job_id: 'job-9', layer_id: 'layer-9', state: 'Staging', message: null, progress: null },
    })])
    settleResultAttachments(importing)
    expect(upsertMock).not.toHaveBeenCalled()

    settleResultAttachments(librarySnapshot([sourceItem('layer-9', 'Ground')]))
    expect(upsertMock).toHaveBeenCalledWith('Source', 'layer-9', 'Ground')
  })

  it('reports an import from Layers that failed and never adds it', async () => {
    dismissAttachmentFailure()
    importItemMock.mockResolvedValue({ layer_id: 'layer-8', job_id: 'job-8' })
    await importLibraryItem(['/a.tif'], 'Ground', 'GroundElevation', { label: null, unknown: false }, true)
    settleResultAttachments(librarySnapshot([sourceItem('layer-8', 'Ground', {
      state: 'Failed', generation_id: null,
      import_job: { job_id: 'job-8', layer_id: 'layer-8', state: 'Failed', message: 'not a raster', progress: null },
    })]))
    expect(attachmentFailure.value).toEqual({ itemId: 'layer-8', message: 'not a raster' })
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('drops an import from Layers whose item left the library before it was published', async () => {
    dismissAttachmentFailure()
    importItemMock.mockResolvedValue({ layer_id: 'layer-7', job_id: 'job-7' })
    await importLibraryItem(['/a.tif'], 'Ground', 'GroundElevation', { label: null, unknown: false }, true)
    expect(pendingAttachments.value.map((entry) => entry.itemIds)).toContainEqual(['layer-7'])

    // Cancelled, then dismissed: the library no longer lists the item at all.
    settleResultAttachments(librarySnapshot([]))
    expect(pendingAttachments.value.map((entry) => entry.itemIds)).not.toContainEqual(['layer-7'])
    expect(attachmentFailure.value).toBeNull()
    expect(upsertMock).not.toHaveBeenCalled()
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

  it('refreshes the library after a refused Retry, so the row shows the refusal written onto its job', async () => {
    retryImportMock.mockRejectedValueOnce(new Error('delft.tif cannot be found; choose the files again'))
    await expect(retryLibraryImport('layer-2')).rejects.toThrow('delft.tif cannot be found')
    expect(refreshMock).toHaveBeenCalledTimes(1)
    expect(ensurePollingMock).not.toHaveBeenCalled()
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

    expect(upsertMock).toHaveBeenCalledWith('Derived', 'analysis-1', 'analysis-1')
    expect(removeMock).toHaveBeenCalledWith(['analysis-1'])
  })

  it('ends inspection in the same interaction that hides a reference', () => {
    setLidarEntryVisibility('layer-1', false)
    expect(patchMock).toHaveBeenCalledWith('layer-1', { visible: false })
    expect(reconcileInspectionMock).toHaveBeenCalled()
  })

  it("stores a kind's default range and ramp as null, so the default has one encoding", () => {
    const entry = (id: string, quantity: RasterQuantity, units: string) =>
      ({ id, order: 0, parentId: null, itemType: { kind: 'Raster' as const, quantity }, units })
    presentation.value = [
      entry('ground', 'GroundElevation', 'm'),
      entry('surface', 'SurfaceElevation', 'm'),
      entry('canopy', 'AboveGroundHeight', 'm'),
      entry('other', 'OtherContinuous', 'kg'),
      entry('slope', 'Slope', '°'),
      entry('slope-percent', 'Slope', '%'),
    ]
    const stored = (id: string) => patchMock.mock.calls.find(([called]) => called === id)?.[1]

    for (const id of ['ground', 'surface', 'canopy', 'other']) {
      setLidarEntryDisplay(id, { range: { mode: 'Data' } })
      expect(stored(id)).toEqual({ range: null })
    }
    setLidarEntryDisplay('slope', { range: { mode: 'Custom', min: 0, max: 30 } })
    setLidarEntryDisplay('slope-percent', { range: { mode: 'Custom', min: 0, max: 57.7 } })
    expect(stored('slope')).toEqual({ range: null })
    expect(stored('slope-percent')).toEqual({ range: null })

    // Anything else is the user's choice, kept as written.
    patchMock.mockClear()
    setLidarEntryDisplay('slope', { range: { mode: 'Data' } })
    setLidarEntryDisplay('ground', { range: { mode: 'Custom', min: 0, max: 30 }, ramp: 'Gray', reversed: true, opacity: 0.4 })
    expect(stored('slope')).toEqual({ range: { mode: 'Data' } })
    expect(stored('ground')).toEqual({ range: { mode: 'Custom', min: 0, max: 30 }, ramp: 'Gray', reversed: true, opacity: 0.4 })

    // The kind's first ramp is its default.
    patchMock.mockClear()
    setLidarEntryDisplay('ground', { ramp: 'Terrain' })
    setLidarEntryDisplay('canopy', { ramp: 'Greens' })
    setLidarEntryDisplay('slope', { ramp: 'YellowRed' })
    setLidarEntryDisplay('other', { ramp: 'Magma' })
    for (const id of ['ground', 'canopy', 'slope', 'other']) expect(stored(id)).toEqual({ ramp: null })
  })

  it('moves a reference among its siblings and saves every order in one edit', () => {
    presentation.value = [
      { id: 'ground', order: 0, parentId: null },
      { id: 'slope', order: 1, parentId: 'ground' },
      { id: 'canopy', order: 2, parentId: null },
    ]
    moveReference('ground', 'front')
    expect(moveMock).toHaveBeenCalledTimes(1)
    expect([...moveMock.mock.calls[0]![0] as Map<string, number>]).toEqual([['canopy', 0], ['ground', 1], ['slope', 2]])

    moveMock.mockClear()
    moveReference('canopy', 'front')
    moveReference('slope', 'back')
    expect(moveMock).not.toHaveBeenCalled()
  })

  it('a drop moves a reference to a sibling\'s place in one order write, and a refused target writes nothing', () => {
    presentation.value = [
      { id: 'ground', order: 0, parentId: null },
      { id: 'slope', order: 1, parentId: 'ground' },
      { id: 'canopy', order: 2, parentId: null },
    ]
    moveReferenceTo('ground', 'canopy')
    expect(moveMock).toHaveBeenCalledTimes(1)
    expect([...moveMock.mock.calls[0]![0] as Map<string, number>]).toEqual([['canopy', 0], ['ground', 1], ['slope', 2]])

    moveMock.mockClear()
    moveReferenceTo('slope', 'canopy')
    expect(moveMock).not.toHaveBeenCalled()
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
    expect(upsertMock).toHaveBeenCalledWith('Derived', id, `${id} name`)
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
    expect(upsertMock.mock.calls).toEqual([['Derived', 'first', 'first name'], ['Derived', 'second', 'second name']])
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

  it('lists work waiting to join the Design and reports a failure, never a cancel', async () => {
    dismissAttachmentFailure()
    const { item_ids: [failed] } = await runAnalysis(SLOPE_REQUEST, true)
    expect(pendingAttachments.value.map((entry) => entry.itemIds)).toContainEqual([failed])
    settleResultAttachments(snapshotWith({ id: failed!, state: 'Failed', run: { job_id: 'j', state: 'Failed', message: 'engine stopped' } }))
    expect(pendingAttachments.value).toEqual([])
    expect(attachmentFailure.value).toEqual({ itemId: failed, message: 'engine stopped' })

    dismissAttachmentFailure()
    const { item_ids: [cancelled] } = await runAnalysis(SLOPE_REQUEST, true)
    settleResultAttachments(snapshotWith({ id: cancelled!, state: 'Failed', run: { job_id: 'j', state: 'Cancelled', message: null } }))
    expect(attachmentFailure.value).toBeNull()
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
