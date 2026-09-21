import { beforeEach, describe, expect, it, vi } from 'vitest'

const moveMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const removeMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const undoMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const restoreMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const collectionMock = vi.hoisted(() => vi.fn())
const refreshMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
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
  lidarLayerHistory: vi.fn(),
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
  moveLayerSource,
  removeLayerSource,
  restoreLayerVersion,
  undoLayerChange,
} from '../app/lidar/actions'
import { lidarStatusMessage } from '../app/lidar/library-store'

const COLLECTION = {
  layer_id: 'layer-1',
  head_generation_id: 'gen-2',
  can_undo: true,
  sources: [
    {
      member_id: 'mem-top',
      kind: 'source',
      filename: 'top',
      interpretation_id: 'interp-a',
      base_generation_id: null,
      width: 3,
      height: 1,
      pixel_size_m: 1,
      coverage_cells: 3n as unknown as string,
      value_range: [0, 100],
    },
    {
      member_id: 'mem-bottom',
      kind: 'source',
      filename: 'bottom',
      interpretation_id: 'interp-b',
      base_generation_id: null,
      width: 3,
      height: 1,
      pixel_size_m: 1,
      coverage_cells: 3n as unknown as string,
      value_range: [10, 30],
    },
  ],
  versions: [],
}

describe('ordered layer collection actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lidarStatusMessage.value = null
  })

  it('reads the ordered sources and versions of one layer', async () => {
    collectionMock.mockResolvedValue(COLLECTION)
    const collection = await fetchLayerCollection('layer-1')
    expect(collectionMock).toHaveBeenCalledWith('layer-1')
    expect(collection.sources.map((source) => source.member_id)).toEqual(['mem-top', 'mem-bottom'])
    expect(collection.head_generation_id).toBe('gen-2')
  })

  it('sends the expected head with a move so a stale edit fails by name', async () => {
    await moveLayerSource('layer-1', 'mem-bottom', true, 'gen-2')
    expect(moveMock).toHaveBeenCalledWith('layer-1', 'mem-bottom', true, 'gen-2')
    expect(refreshMock).toHaveBeenCalled()
    expect(ensurePollingMock).toHaveBeenCalled()
  })

  it('removes one occurrence and still refreshes the library', async () => {
    await removeLayerSource('layer-1', 'mem-top', 'gen-2')
    expect(removeMock).toHaveBeenCalledWith('layer-1', 'mem-top', 'gen-2')
    expect(refreshMock).toHaveBeenCalled()
  })

  it('undoes the last change through the snapshot action, not a job identity', async () => {
    await undoLayerChange('layer-1', 'gen-2')
    expect(undoMock).toHaveBeenCalledWith('layer-1', 'gen-2')
    expect(refreshMock).toHaveBeenCalled()
  })

  it('restores one older version by identity with the expected head', async () => {
    await restoreLayerVersion('layer-1', 'gen-1', 'gen-2')
    expect(restoreMock).toHaveBeenCalledWith('layer-1', 'gen-1', 'gen-2')
    expect(refreshMock).toHaveBeenCalled()
  })

  it('surfaces a rejected edit and leaves the library refresh to settlement', async () => {
    moveMock.mockRejectedValueOnce(new Error('the layer changed since this edit was prepared'))
    await moveLayerSource('layer-1', 'mem-top', false, 'gen-stale')
    expect(lidarStatusMessage.value).toBe('the layer changed since this edit was prepared')
    expect(refreshMock).not.toHaveBeenCalled()
  })
})
