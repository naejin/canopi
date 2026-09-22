import { beforeEach, describe, expect, it, vi } from 'vitest'

const moveMock = vi.hoisted(() => vi.fn())
const removeMock = vi.hoisted(() => vi.fn())
const undoMock = vi.hoisted(() => vi.fn())
const restoreMock = vi.hoisted(() => vi.fn())
const collectionMock = vi.hoisted(() => vi.fn())
const refreshMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const historyMock = vi.hoisted(() => vi.fn())
const ensurePollingMock = vi.hoisted(() => vi.fn())

vi.mock('../ipc/lidar', () => ({
  lidarApplyImport: vi.fn(),
  lidarCancelImport: vi.fn(),
  lidarCreateAnalysis: vi.fn(),
  lidarCreateLayer: vi.fn(),
  lidarDeleteAnalysis: vi.fn(),
  lidarDeleteLayer: vi.fn(),
  lidarDeleteLayerImpact: vi.fn(),
  lidarRenameLayer: vi.fn(),
  lidarLayerHistory: historyMock,
  lidarLayerCollection: collectionMock,
  lidarMoveLayerSource: moveMock,
  lidarRemoveLayerSource: removeMock,
  lidarRestoreLayerVersion: restoreMock,
  lidarUndoLayerChange: undoMock,
  lidarStageImport: vi.fn(),
}))

vi.mock('../app/design-edit/lidar', () => ({
  patchLidarEntryById: vi.fn(),
  removeLidarEntries: vi.fn(),
  upsertLidarEntry: vi.fn(),
}))

vi.mock('../app/lidar/library-store', async () => {
  const { signal: makeSignal } = await import('@preact/signals')
  return {
    ensureLidarPolling: ensurePollingMock,
    lidarStatusMessage: makeSignal<string | null>(null),
    openImportJob: makeSignal(null),
    refreshOpenImportJob: vi.fn(),
    refreshLidarLibrary: refreshMock,
    trackImportJob: vi.fn(),
  }
})

vi.mock('../app/document-session/store', () => ({
  designSessionStore: { sessionIdentity: { value: 'design-a' } },
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

import {
  fetchLayerCollection,
  fetchLayerHistory,
  moveLayerSource,
  removeLayerSource,
  restoreLayerVersion,
  undoLayerChange,
} from '../app/lidar/actions'
import { lidarStatusMessage } from '../app/lidar/library-store'

const OUTCOME = {
  head_generation_id: 'gen-3',
  changed: true,
  message: null,
}

const PAGE_ONE = {
  layer_id: 'layer-1',
  head_generation_id: 'gen-2',
  member_count: 3,
  undo_available: true,
  undo_target: 'gen-1',
  sources: [
    {
      member_id: 'mem-top',
      kind: 'source',
      filename: 'top.tif',
      interpretation_id: 'interp-a',
      base_generation_id: null,
      width: 3,
      height: 1,
      pixel_size_m: 1,
      coverage_cells: '3',
      value_range: [0, 100],
    },
    {
      member_id: 'mem-bottom',
      kind: 'source',
      filename: 'bottom.tif',
      interpretation_id: 'interp-b',
      base_generation_id: null,
      width: 3,
      height: 1,
      pixel_size_m: 1,
      coverage_cells: '3',
      value_range: [10, 30],
    },
  ],
  next_member_cursor: 'gen-2:1',
}

const PAGE_TWO = {
  ...PAGE_ONE,
  sources: [
    {
      member_id: 'mem-oldest',
      kind: 'previous-composition',
      filename: null,
      interpretation_id: null,
      base_generation_id: 'gen-legacy',
      width: 0,
      height: 0,
      pixel_size_m: 0,
      coverage_cells: '0',
      value_range: [0, 0],
    },
  ],
  next_member_cursor: null,
}

describe('ordered layer collection actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lidarStatusMessage.value = null
  })

  it('reads one bounded page of ordered sources and reports the whole count', async () => {
    collectionMock.mockResolvedValue(PAGE_ONE)
    const collection = await fetchLayerCollection('layer-1')
    expect(collectionMock).toHaveBeenCalledWith('layer-1', null)
    expect(collection.sources.map((source) => source.member_id)).toEqual(['mem-top', 'mem-bottom'])
    expect(collection.member_count).toBe(3)
    expect(collection.next_member_cursor).toBe('gen-2:1')
  })

  it('binds a member page to the snapshot it was requested from', async () => {
    collectionMock.mockResolvedValue(PAGE_TWO)
    await fetchLayerCollection('layer-1', 'gen-2:1')
    expect(collectionMock).toHaveBeenCalledWith('layer-1', 'gen-2:1')
  })

  it('reads one bounded history page with its captured upper bound', async () => {
    historyMock.mockResolvedValue({
      layer_id: 'layer-1',
      head_generation_id: 'gen-2',
      versions: [],
      next_cursor: '9:4',
    })
    const page = await fetchLayerHistory('layer-1', '9:9')
    expect(historyMock).toHaveBeenCalledWith('layer-1', '9:9')
    expect(page.next_cursor).toBe('9:4')
  })

  it('sends the expected head with a move and returns the settled outcome', async () => {
    moveMock.mockResolvedValue(OUTCOME)
    const outcome = await moveLayerSource('layer-1', 'mem-bottom', true, 'gen-2')
    expect(moveMock).toHaveBeenCalledWith('layer-1', 'mem-bottom', true, 'gen-2')
    expect(outcome.head_generation_id).toBe('gen-3')
    expect(refreshMock).toHaveBeenCalled()
    expect(ensurePollingMock).toHaveBeenCalled()
  })

  it('removes one occurrence and still refreshes the library', async () => {
    removeMock.mockResolvedValue(OUTCOME)
    await removeLayerSource('layer-1', 'mem-top', 'gen-2')
    expect(removeMock).toHaveBeenCalledWith('layer-1', 'mem-top', 'gen-2')
    expect(refreshMock).toHaveBeenCalled()
  })

  it('undoes the last change through the snapshot action, not a job identity', async () => {
    undoMock.mockResolvedValue(OUTCOME)
    await undoLayerChange('layer-1', 'gen-2')
    expect(undoMock).toHaveBeenCalledWith('layer-1', 'gen-2')
    expect(refreshMock).toHaveBeenCalled()
  })

  it('restores one older version by identity with the expected head', async () => {
    restoreMock.mockResolvedValue(OUTCOME)
    await restoreLayerVersion('layer-1', 'gen-1', 'gen-2')
    expect(restoreMock).toHaveBeenCalledWith('layer-1', 'gen-1', 'gen-2')
    expect(refreshMock).toHaveBeenCalled()
  })

  it('keeps a no-op message visible instead of dropping it', async () => {
    undoMock.mockResolvedValue({
      head_generation_id: 'gen-2',
      changed: false,
      message: 'there is no earlier version to undo',
    })
    const outcome = await undoLayerChange('layer-1', 'gen-2')
    expect(outcome.changed).toBe(false)
    expect(lidarStatusMessage.value).toBe('there is no earlier version to undo')
  })

  it('surfaces a rejected edit, re-reads the head and reports the refusal', async () => {
    moveMock.mockRejectedValueOnce(new Error('the layer changed since this edit was prepared'))
    await expect(moveLayerSource('layer-1', 'mem-top', false, 'gen-stale')).rejects.toThrow(
      'the layer changed since this edit was prepared',
    )
    expect(lidarStatusMessage.value).toBe('the layer changed since this edit was prepared')
    // A refusal means the head moved: the library is re-read so the next edit
    // carries the snapshot the user is actually looking at.
    expect(refreshMock).toHaveBeenCalled()
  })
})
