import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CONTINUOUS_SAVE_DELAY_MS,
  createContinuousSave,
  type ContinuousSave,
  type DesignHome,
  type HomeWriteOutcome,
} from '../app/document-session/continuous-save'
import {
  createDesignSessionStoreTestFixture,
  createMemoryDesignSessionStore,
  type DesignSessionStoreTestFixture,
  type PersistenceCapableDesignSessionStore,
} from '../app/document-session/store'
import { editDesignSessionForTest } from './support/design-session-edit'
import type { CanopiFile } from '../types/design'

let store: PersistenceCapableDesignSessionStore
let fixture: DesignSessionStoreTestFixture
let writes: DesignHome[]
let writeHome: ReturnType<typeof vi.fn<(home: DesignHome) => Promise<HomeWriteOutcome>>>
let save: ContinuousSave
let uninstall: () => void

function makeFile(name = 'Garden'): CanopiFile {
  return {
    version: 7,
    name,
    description: null,
    plant_species_colors: {},
    plant_species_symbols: {},
    layers: [],
    plants: [],
    zones: [],
    annotations: [],
    measurement_guides: [],
    consortiums: [],
    groups: [],
    timeline: [],
    budget: [],
    budget_currency: 'EUR',
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    extra: {},
  }
}

function openSession({
  path = null,
  draftId = 'draft-1',
  fingerprint = null,
  writePending = false,
}: {
  path?: string | null
  draftId?: string | null
  fingerprint?: string | null
  writePending?: boolean
} = {}): void {
  store.resetDirtyBaselines()
  store.replaceCurrentDesignState(makeFile(), path, 'Garden')
  save.beginSession({ draftId, fingerprint, writePending })
}

function edit(description: string): void {
  editDesignSessionForTest(store, (design) => ({ ...design, description }))
}

function acknowledgingWrite(): Promise<HomeWriteOutcome> {
  fixture.markSaved()
  return Promise.resolve({ kind: 'written' })
}

async function settle(): Promise<void> {
  for (let pass = 0; pass < 8; pass += 1) await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
  store = createMemoryDesignSessionStore()
  fixture = createDesignSessionStoreTestFixture(store)
  writes = []
  writeHome = vi.fn((home: DesignHome) => {
    writes.push(home)
    return acknowledgingWrite()
  })
  save = createContinuousSave({ store, writeHome, logError: () => {} })
  uninstall = save.install()
})

afterEach(() => {
  uninstall()
  save.dispose()
  vi.useRealTimers()
})

describe('continuous save', () => {
  it('writes to the home once, 1500 ms after the last committed change', async () => {
    openSession()
    edit('a')
    await vi.advanceTimersByTimeAsync(CONTINUOUS_SAVE_DELAY_MS - 100)
    edit('b')
    await vi.advanceTimersByTimeAsync(CONTINUOUS_SAVE_DELAY_MS - 100)
    expect(writeHome).not.toHaveBeenCalled()
    expect(save.status.value).toBe('saving')

    await vi.advanceTimersByTimeAsync(100)
    expect(writes).toEqual([{ kind: 'draft', id: 'draft-1' }])
    expect(store.designDirty.value).toBe(false)
    expect(save.status.value).toBe('saved')
  })

  it('restarts the delay on every Scene history report while the Design stays dirty', async () => {
    openSession()
    store.setCanvasClean(false)
    await vi.advanceTimersByTimeAsync(CONTINUOUS_SAVE_DELAY_MS - 1)
    store.setCanvasClean(false)
    await vi.advanceTimersByTimeAsync(CONTINUOUS_SAVE_DELAY_MS - 1)
    expect(writeHome).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(writeHome).toHaveBeenCalledTimes(1)
  })

  it('writes a file home with its current fingerprint', async () => {
    openSession({ path: '/designs/garden.canopi', draftId: null, fingerprint: 'fp-1' })
    expect(save.readHome()).toEqual({
      kind: 'file',
      path: '/designs/garden.canopi',
      fingerprint: 'fp-1',
    })
    const token = save.sessionToken()
    save.recordFileFingerprint(token, '/designs/garden.canopi', 'fp-2')
    edit('a')
    await vi.advanceTimersByTimeAsync(CONTINUOUS_SAVE_DELAY_MS)
    expect(writes).toEqual([{ kind: 'file', path: '/designs/garden.canopi', fingerprint: 'fp-2' }])
  })

  it('keeps one write in flight and writes again for a change made during it', async () => {
    openSession()
    let finishFirst!: () => void
    writeHome.mockImplementationOnce((home) => {
      writes.push(home)
      fixture.markSaved()
      return new Promise((resolve) => {
        finishFirst = () => resolve({ kind: 'written' })
      })
    })
    edit('a')
    await vi.advanceTimersByTimeAsync(CONTINUOUS_SAVE_DELAY_MS)
    expect(writeHome).toHaveBeenCalledTimes(1)

    edit('b')
    await vi.advanceTimersByTimeAsync(CONTINUOUS_SAVE_DELAY_MS)
    expect(writeHome).toHaveBeenCalledTimes(1)

    finishFirst()
    await settle()
    expect(writeHome).toHaveBeenCalledTimes(2)
    await settle()
    expect(save.status.value).toBe('saved')
  })

  it('flushes immediately and reports whether the home holds every change', async () => {
    openSession()
    await expect(save.flush()).resolves.toBe(true)
    expect(writeHome).not.toHaveBeenCalled()

    edit('a')
    await expect(save.flush()).resolves.toBe(true)
    expect(writeHome).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(CONTINUOUS_SAVE_DELAY_MS * 2)
    expect(writeHome).toHaveBeenCalledTimes(1)
  })

  it('writes a pending home without an edit', async () => {
    openSession({ writePending: true })
    expect(save.status.value).toBe('saving')
    await vi.advanceTimersByTimeAsync(CONTINUOUS_SAVE_DELAY_MS)
    expect(writeHome).toHaveBeenCalledTimes(1)
    expect(save.status.value).toBe('saved')
    await expect(save.flush()).resolves.toBe(true)
    expect(writeHome).toHaveBeenCalledTimes(1)
  })

  it('reports a failed write, keeps the change pending and recovers on retry', async () => {
    openSession()
    writeHome.mockRejectedValueOnce(new Error('disk full'))
    edit('a')
    await expect(save.flush()).resolves.toBe(false)
    expect(save.status.value).toBe('error')
    expect(store.designDirty.value).toBe(true)

    await expect(save.flush()).resolves.toBe(true)
    expect(save.status.value).toBe('saved')
  })

  it('pauses on a conflict until the user keeps their version', async () => {
    openSession({ path: '/designs/garden.canopi', draftId: null, fingerprint: 'fp-1' })
    writeHome.mockResolvedValueOnce({ kind: 'conflict', fileGone: false })
    edit('a')
    await expect(save.flush()).resolves.toBe(false)
    expect(save.status.value).toBe('conflict')
    expect(save.conflict.value).toEqual({ fileGone: false })

    edit('b')
    await vi.advanceTimersByTimeAsync(CONTINUOUS_SAVE_DELAY_MS * 2)
    await expect(save.flush()).resolves.toBe(false)
    expect(writeHome).toHaveBeenCalledTimes(1)

    await expect(save.overwriteHome()).resolves.toBe(true)
    expect(writes.at(-1)).toEqual({
      kind: 'file',
      path: '/designs/garden.canopi',
      fingerprint: null,
    })
    expect(save.conflict.value).toBeNull()
    expect(save.status.value).toBe('saved')
  })

  it('drops the previous session schedule, failure and conflict on replacement', async () => {
    openSession({ path: '/designs/a.canopi', draftId: null, fingerprint: 'fp' })
    writeHome.mockResolvedValueOnce({ kind: 'conflict', fileGone: true })
    edit('a')
    await save.flush()
    expect(save.status.value).toBe('conflict')

    openSession({ draftId: 'draft-2' })
    expect(save.conflict.value).toBeNull()
    expect(save.status.value).toBe('saved')
    expect(save.readHome()).toEqual({ kind: 'draft', id: 'draft-2' })
  })

  it('ignores the outcome of a write that belonged to a replaced session', async () => {
    openSession()
    let rejectFirst!: (error: Error) => void
    writeHome.mockImplementationOnce(() => new Promise((_resolve, reject) => {
      rejectFirst = reject
    }))
    edit('a')
    const flushed = save.flush()
    openSession({ draftId: 'draft-2' })
    rejectFirst(new Error('late failure'))
    await expect(flushed).resolves.toBe(false)
    expect(save.status.value).toBe('saved')
  })

  it('ignores a fingerprint recorded for a replaced session', () => {
    openSession({ path: '/designs/a.canopi', draftId: null, fingerprint: 'fp-1' })
    const token = save.sessionToken()
    openSession({ path: '/designs/a.canopi', draftId: null, fingerprint: 'fp-2' })
    save.recordFileFingerprint(token, '/designs/a.canopi', 'stale')
    expect(save.readHome()).toMatchObject({ fingerprint: 'fp-2' })
  })

  it('rehomes a draft to a file and forgets the draft', () => {
    openSession({ draftId: 'draft-1' })
    const token = save.sessionToken()
    save.recordFileFingerprint(token, '/designs/new.canopi', 'fp-new')
    fixture.setState({ path: '/designs/new.canopi' })
    save.rehome(token, { draftId: null })
    expect(save.readHome()).toEqual({
      kind: 'file',
      path: '/designs/new.canopi',
      fingerprint: 'fp-new',
    })
  })

  it('offers revert once the session has changed and keeps the opened snapshot', () => {
    openSession()
    expect(save.revertAvailable.value).toBe(false)
    expect(save.readSnapshot()?.description).toBeNull()
    edit('a')
    expect(save.revertAvailable.value).toBe(true)
    expect(save.readSnapshot()?.description).toBeNull()
  })

  it('treats changes to a Design without a home as unsaved', async () => {
    store.replaceCurrentDesignState(makeFile(), null, 'Garden')
    expect(save.status.value).toBe('saved')
    edit('a')
    expect(save.status.value).toBe('error')
    await expect(save.flush()).resolves.toBe(false)
    expect(writeHome).not.toHaveBeenCalled()
  })

  it('reports saved and never writes when no Design is open', async () => {
    expect(save.status.value).toBe('saved')
    await expect(save.flush()).resolves.toBe(true)
    expect(writeHome).not.toHaveBeenCalled()
  })

  it('waits for the write in flight before reporting idle', async () => {
    openSession()
    let finish!: () => void
    writeHome.mockImplementationOnce(() => {
      fixture.markSaved()
      return new Promise((resolve) => {
        finish = () => resolve({ kind: 'written' })
      })
    })
    edit('a')
    void save.flush()
    let idle = false
    void save.idle().then(() => {
      idle = true
    })
    await settle()
    expect(idle).toBe(false)
    finish()
    await settle()
    expect(idle).toBe(true)
  })
})
