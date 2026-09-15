import { beforeEach, describe, expect, it, vi } from 'vitest'

const createLayerMock = vi.hoisted(() => vi.fn())
const createAnalysisMock = vi.hoisted(() => vi.fn())
const deleteLayerMock = vi.hoisted(() => vi.fn())
const upsertMock = vi.hoisted(() => vi.fn())
const removeMock = vi.hoisted(() => vi.fn())
const refreshMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const ensurePollingMock = vi.hoisted(() => vi.fn())
const sessionIdentity = vi.hoisted(() => ({ value: 'design-a' as string | null }))

vi.mock('../ipc/lidar', () => ({
  lidarApplyImport: vi.fn(),
  lidarCancelImport: vi.fn(),
  lidarCreateAnalysis: createAnalysisMock,
  lidarCreateLayer: createLayerMock,
  lidarDeleteAnalysis: vi.fn(),
  lidarDeleteLayer: deleteLayerMock,
  lidarDeleteLayerImpact: vi.fn(),
  lidarRenameLayer: vi.fn(),
  lidarLayerHistory: vi.fn(),
  lidarStageImport: vi.fn(),
  lidarUndoImport: vi.fn(),
}))

vi.mock('../app/design-edit/lidar', () => ({
  patchLidarEntryById: vi.fn(),
  removeLidarEntries: removeMock,
  upsertLidarEntry: upsertMock,
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
  designSessionStore: { sessionIdentity },
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

import {
  analyseLayerAsSlope,
  createLidarLayer,
  deleteLidarLayer,
} from '../app/lidar/actions'

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(next => { resolve = next })
  return { promise, resolve }
}

describe('LiDAR action session isolation', () => {
  beforeEach(() => {
    sessionIdentity.value = 'design-a'
    createLayerMock.mockReset()
    createAnalysisMock.mockReset()
    deleteLayerMock.mockReset()
    upsertMock.mockReset()
    removeMock.mockReset()
    refreshMock.mockClear()
    ensurePollingMock.mockClear()
  })

  it('does not present a newly created library layer in a Design opened mid-command', async () => {
    const pending = deferred<string>()
    createLayerMock.mockReturnValue(pending.promise)
    const creation = createLidarLayer('Ground', 'GroundElevation')

    sessionIdentity.value = 'design-b'
    pending.resolve('layer-1')
    await creation

    expect(refreshMock).toHaveBeenCalled()
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('does not present an analysis result in a Design opened while analysis starts', async () => {
    const pending = deferred<{ definition_id: string; job_id: string }>()
    createAnalysisMock.mockReturnValue(pending.promise)
    const analysis = analyseLayerAsSlope('layer-1')

    sessionIdentity.value = 'design-b'
    pending.resolve({ definition_id: 'analysis-1', job_id: 'job-1' })
    await analysis

    expect(refreshMock).toHaveBeenCalled()
    expect(upsertMock).not.toHaveBeenCalled()
    expect(ensurePollingMock).toHaveBeenCalled()
  })

  it('does not remove presentation entries from a Design opened during deletion', async () => {
    const pending = deferred<void>()
    deleteLayerMock.mockReturnValue(pending.promise)
    const deletion = deleteLidarLayer('layer-1', ['analysis-1'])

    sessionIdentity.value = 'design-b'
    pending.resolve()
    await deletion

    expect(refreshMock).toHaveBeenCalled()
    expect(removeMock).not.toHaveBeenCalled()
  })
})
