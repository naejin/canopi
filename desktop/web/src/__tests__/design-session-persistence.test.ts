import { effect } from '@preact/signals'
import { describe, expect, it, vi } from 'vitest'
import type { CanvasDocumentSurface } from '../canvas/runtime/runtime'
import type { CanopiFile } from '../types/design'

import {
  createDesignSessionPersistence,
  DesignPersistenceSettlementError,
  settleWrittenDesignOperation,
} from '../app/document-session/persistence'
import {
  createMemoryDesignSessionStore,
} from '../app/document-session/store'

function makeDesign(name = 'Design'): CanopiFile {
  return {
    version: 2,
    name,
    description: null,
    location: null,
    north_bearing_deg: 0,
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
    created_at: '2026-04-13T00:00:00.000Z',
    updated_at: '2026-04-13T00:00:00.000Z',
    extra: {},
  }
}

describe('purpose-aware Design persistence operations', () => {
  function checkpointSession(
    capture: (metadata: { name: string }, doc: CanopiFile) => CanopiFile =
      (metadata, doc) => ({ ...doc, name: metadata.name }),
  ): {
    readonly session: CanvasDocumentSurface
    readonly acknowledgeSaved: ReturnType<typeof vi.fn>
  } {
    const acknowledgeSaved = vi.fn(() => 'applied' as const)
    const session: CanvasDocumentSurface = {
      initializeViewport: vi.fn(),
      attachRulersTo: vi.fn(),
      showCanvasChrome: vi.fn(),
      hideCanvasChrome: vi.fn(),
      zoomToFit: vi.fn(),
      loadDocument: vi.fn(),
      replaceDocument: vi.fn((_file, _token, finalizeReplacement) => {
        finalizeReplacement()
        return { callerFinalizerInvoked: true }
      }),
      hasLoadedDocument: vi.fn(() => true),
      captureForPersistence: vi.fn((metadata, doc) => ({
        content: capture(metadata, doc),
        isCurrent: () => true,
        acknowledgeSaved,
      })),
      resize: vi.fn(),
      destroy: vi.fn(),
    }
    return { session, acknowledgeSaved }
  }

  it('acknowledges only the captured revisions and preserves later Design edits', () => {
    const original = makeDesign('Original')
    const operationStore = createMemoryDesignSessionStore({
      file: original,
      path: '/designs/original.canopi',
      name: original.name,
    })
    const { session } = checkpointSession()
    const persistence = createDesignSessionPersistence({ store: operationStore })
    persistence.attachCanvas(session)
    operationStore.markDocumentDirty()
    const operation = persistence.beginSave()

    operationStore.mutateCurrentDesign((design) => ({
      ...design,
      description: 'edit made during I/O',
    }))
    const settlement = operation.succeed()

    expect(settlement.status).toBe('applied')
    expect(settlement.content.description).toBeNull()
    expect(operationStore.readCurrentDesign()?.description).toBe('edit made during I/O')
    expect(operationStore.isDesignDirty()).toBe(true)
  })

  it('makes a completion inert after Design replacement', () => {
    const original = makeDesign('Original')
    const operationStore = createMemoryDesignSessionStore({ file: original, name: original.name })
    const persistence = createDesignSessionPersistence({ store: operationStore })
    const operation = persistence.beginSaveAs()

    operationStore.replaceCurrentDesignState(makeDesign('Replacement'), null, 'Replacement')
    operationStore.resetDirtyBaselines()

    expect(operation.succeed('/designs/original.canopi').status).toBe('stale')
    expect(operationStore.readDesignPath()).toBeNull()
    expect(operationStore.readDesignName()).toBe('Replacement')
    expect(operationStore.isDesignDirty()).toBe(false)
  })

  it('rejects an empty Save As destination before acknowledging captured state', () => {
    const original = makeDesign('Original')
    const operationStore = createMemoryDesignSessionStore({ file: original, name: original.name })
    const capture = checkpointSession()
    const persistence = createDesignSessionPersistence({ store: operationStore })
    persistence.attachCanvas(capture.session)
    operationStore.markDocumentDirty()
    const operation = persistence.beginSaveAs()

    expect(() => operation.succeed('')).toThrow('destination path')
    expect(capture.acknowledgeSaved).not.toHaveBeenCalled()
    expect(operationStore.readDesignPath()).toBeNull()
    expect(operationStore.isDesignDirty()).toBe(true)
  })

  it('returns stale when saved-baseline publication reentrantly replaces the Design', () => {
    const original = makeDesign('Original')
    const operationStore = createMemoryDesignSessionStore({
      file: original,
      path: '/designs/original.canopi',
      name: original.name,
    })
    const persistence = createDesignSessionPersistence({ store: operationStore })
    operationStore.markDocumentDirty()
    const operation = persistence.beginSave()
    let replaceWhenClean = false
    const dispose = effect(() => {
      const dirty = operationStore.designDirty.value
      if (dirty || !replaceWhenClean) return
      replaceWhenClean = false
      operationStore.replaceCurrentDesignState(makeDesign('Replacement'), null, 'Replacement')
      operationStore.resetDirtyBaselines()
    })

    replaceWhenClean = true
    const settlement = operation.succeed()
    dispose()

    expect(settlement.status).toBe('stale')
    expect(operationStore.readDesignName()).toBe('Replacement')
    expect(operationStore.readDesignPath()).toBeNull()
  })

  it('finishes an irreversible settlement when clean publication issues a newer save', () => {
    const original = makeDesign('Original')
    const operationStore = createMemoryDesignSessionStore({ file: original, name: original.name })
    const persistence = createDesignSessionPersistence({ store: operationStore })
    operationStore.markDocumentDirty()
    const older = persistence.beginSaveAs()
    let newer: ReturnType<typeof persistence.beginSaveAs> | null = null
    let issueWhenClean = false
    const dispose = effect(() => {
      const dirty = operationStore.designDirty.value
      if (dirty || !issueWhenClean) return
      issueWhenClean = false
      newer = persistence.beginSaveAs()
    })

    issueWhenClean = true
    expect(older.succeed('/designs/older.canopi').status).toBe('applied')
    expect(operationStore.readDesignPath()).toBe('/designs/older.canopi')
    expect(newer).not.toBeNull()
    expect(newer!.succeed('/designs/newer.canopi').status).toBe('applied')
    expect(operationStore.readDesignPath()).toBe('/designs/newer.canopi')
    dispose()
  })

  it('records manual success when path publication reentrantly issues a newer save', () => {
    const original = makeDesign('Original')
    const operationStore = createMemoryDesignSessionStore({ file: original, name: original.name })
    const persistence = createDesignSessionPersistence({ store: operationStore })
    operationStore.markDocumentDirty()
    const recovery = persistence.beginRecovery()
    const manual = persistence.beginSaveAs()
    let issueDuringPath = false
    let newer: ReturnType<typeof persistence.beginBrowserDownload> | null = null
    const dispose = effect(() => {
      void operationStore.designPath.value
      if (!issueDuringPath) return
      issueDuringPath = false
      newer = persistence.beginBrowserDownload()
    })

    issueDuringPath = true
    expect(manual.succeed('/designs/manual.canopi').status).toBe('applied')
    recovery.fail(new Error('older recovery failed late'))

    expect(newer).not.toBeNull()
    expect(operationStore.readDesignPath()).toBe('/designs/manual.canopi')
    expect(operationStore.autosaveFailed.value).toBe(false)
    dispose()
  })

  it('blocks an older recovery failure before Save As publishes its path', () => {
    const original = makeDesign('Original')
    const operationStore = createMemoryDesignSessionStore({ file: original, name: original.name })
    const persistence = createDesignSessionPersistence({ store: operationStore })
    operationStore.markDocumentDirty()
    const recovery = persistence.beginRecovery()
    const manual = persistence.beginSaveAs()
    let failRecoveryDuringPath = false
    const dispose = effect(() => {
      void operationStore.designPath.value
      if (!failRecoveryDuringPath) return
      failRecoveryDuringPath = false
      recovery.fail(new Error('older recovery failed during path publication'))
    })

    failRecoveryDuringPath = true
    expect(manual.succeed('/designs/manual.canopi').status).toBe('applied')

    expect(operationStore.autosaveFailed.value).toBe(false)
    dispose()
  })

  it('orders overlapping Save As destinations by issue order, not completion order', () => {
    const original = makeDesign('Original')
    const operationStore = createMemoryDesignSessionStore({ file: original, name: original.name })
    const persistence = createDesignSessionPersistence({ store: operationStore })
    const first = persistence.beginSaveAs()
    const second = persistence.beginSaveAs()

    expect(second.succeed('/designs/second.canopi').status).toBe('applied')
    expect(first.succeed('/designs/first.canopi').status).toBe('stale')
    expect(operationStore.readDesignPath()).toBe('/designs/second.canopi')
  })

  it('does not let an old-path Save supersede a pending Save As', () => {
    const original = makeDesign('Original')
    const operationStore = createMemoryDesignSessionStore({
      file: original,
      path: '/designs/original.canopi',
      name: original.name,
    })
    const persistence = createDesignSessionPersistence({ store: operationStore })
    const oldPathSave = persistence.beginSave()
    const saveAs = persistence.beginSaveAs()

    expect(saveAs.succeed('/designs/new.canopi').status).toBe('applied')
    expect(oldPathSave.succeed().status).toBe('stale')
    expect(operationStore.readDesignPath()).toBe('/designs/new.canopi')
  })

  it('rejects a captured canvas checkpoint after detach and reattach', () => {
    const original = makeDesign('Original')
    const operationStore = createMemoryDesignSessionStore({ file: original, name: original.name })
    const persistence = createDesignSessionPersistence({ store: operationStore })
    const first = checkpointSession()
    const second = checkpointSession()
    persistence.attachCanvas(first.session)
    const operation = persistence.beginBrowserDownload()

    persistence.detachCanvas(first.session)
    persistence.attachCanvas(second.session)

    expect(operation.succeed().status).toBe('stale')
    expect(first.acknowledgeSaved).not.toHaveBeenCalled()
  })

  it('rejects a second Canvas attachment until the current lease is released', () => {
    const original = makeDesign('Original')
    const operationStore = createMemoryDesignSessionStore({ file: original, name: original.name })
    const persistence = createDesignSessionPersistence({ store: operationStore })
    const first = checkpointSession()
    const second = checkpointSession()
    persistence.attachCanvas(first.session)

    expect(() => persistence.attachCanvas(second.session)).toThrow('Canvas persistence lease')

    const operation = persistence.beginBrowserDownload()
    expect(operation.content.name).toBe('Original')
    expect(first.session.captureForPersistence).toHaveBeenCalledOnce()
    expect(second.session.captureForPersistence).not.toHaveBeenCalled()
  })

  it('rejects handoff from a stale Canvas without displacing the current lease', () => {
    const original = makeDesign('Original')
    const operationStore = createMemoryDesignSessionStore({ file: original, name: original.name })
    const persistence = createDesignSessionPersistence({ store: operationStore })
    const first = checkpointSession()
    const second = checkpointSession()
    persistence.attachCanvas(first.session)
    persistence.detachCanvas(first.session)
    persistence.attachCanvas(second.session)

    expect(() => persistence.settleCanvasHandoff(first.session)).toThrow('Canvas persistence lease')

    const operation = persistence.beginBrowserDownload()
    expect(operation.content.name).toBe('Original')
    expect(second.session.captureForPersistence).toHaveBeenCalledOnce()
  })

  it('finishes Canvas acknowledgement before a reentrantly issued save takes over', () => {
    const original = makeDesign('Original')
    const operationStore = createMemoryDesignSessionStore({ file: original, name: original.name })
    const capture = checkpointSession()
    const persistence = createDesignSessionPersistence({ store: operationStore })
    persistence.attachCanvas(capture.session)
    const older = persistence.beginSaveAs()
    let newer!: ReturnType<typeof persistence.beginSaveAs>
    capture.acknowledgeSaved.mockImplementationOnce(() => {
      newer = persistence.beginSaveAs()
      return 'applied'
    })

    expect(older.succeed('/designs/older.canopi').status).toBe('applied')
    expect(operationStore.readDesignPath()).toBe('/designs/older.canopi')
    expect(newer.succeed('/designs/newer.canopi').status).toBe('applied')
    expect(operationStore.readDesignPath()).toBe('/designs/newer.canopi')
  })

  it('retries a started settlement after acknowledgement issues a newer save and throws', () => {
    const original = makeDesign('Original')
    const operationStore = createMemoryDesignSessionStore({ file: original, name: original.name })
    const capture = checkpointSession()
    const persistence = createDesignSessionPersistence({ store: operationStore })
    persistence.attachCanvas(capture.session)
    const older = persistence.beginSaveAs()
    let newer: ReturnType<typeof persistence.beginSaveAs> | null = null
    capture.acknowledgeSaved
      .mockImplementationOnce(() => {
        newer = persistence.beginSaveAs()
        throw new Error('clean publication failed after issuing newer save')
      })
      .mockReturnValue('applied')

    const settlement = settleWrittenDesignOperation({
      succeed: () => older.succeed('/designs/older.canopi'),
    })

    expect(settlement.status).toBe('applied')
    expect(operationStore.readDesignPath()).toBe('/designs/older.canopi')
    expect(capture.acknowledgeSaved).toHaveBeenCalledTimes(2)
    expect(newer).not.toBeNull()
    expect(newer!.succeed('/designs/newer.canopi').status).toBe('applied')
    expect(operationStore.readDesignPath()).toBe('/designs/newer.canopi')
  })

  it('retries every Save As settlement phase without repeating external I/O', () => {
    const original = makeDesign('Original')
    const operationStore = createMemoryDesignSessionStore({ file: original, name: original.name })
    const capture = checkpointSession()
    capture.acknowledgeSaved
      .mockImplementationOnce(() => {
        throw new Error('Canvas clean publication failed')
      })
      .mockReturnValue('applied')
    const persistence = createDesignSessionPersistence({ store: operationStore })
    persistence.attachCanvas(capture.session)
    operationStore.markDocumentDirty()
    const operation = persistence.beginSaveAs()
    let failStorePublication = false
    let failPathPublication = false
    const disposeStoreEffect = effect(() => {
      const dirty = operationStore.designDirty.value
      if (dirty || !failStorePublication) return
      failStorePublication = false
      throw new Error('Design baseline publication failed')
    })
    const disposePathEffect = effect(() => {
      const path = operationStore.designPath.value
      if (!path || !failPathPublication) return
      failPathPublication = false
      throw new Error('Save As path publication failed')
    })

    failStorePublication = true
    failPathPublication = true
    const settlement = settleWrittenDesignOperation({
      succeed: () => operation.succeed('/designs/retried.canopi'),
    })

    expect(settlement.status).toBe('applied')
    expect(operationStore.readDesignPath()).toBe('/designs/retried.canopi')
    expect(operationStore.isDesignDirty()).toBe(false)
    expect(capture.acknowledgeSaved).toHaveBeenCalledTimes(4)
    disposeStoreEffect()
    disposePathEffect()
  })

  it('reports every bounded exact-settlement failure in attempt order', () => {
    const causes = Array.from({ length: 4 }, (_, index) =>
      new Error(`settlement failure ${index + 1}`))
    const succeed = vi.fn(() => {
      throw causes[succeed.mock.calls.length - 1]
    })

    let settlementError: unknown
    try {
      settleWrittenDesignOperation({ succeed })
    } catch (error) {
      settlementError = error
    }

    expect(succeed).toHaveBeenCalledTimes(4)
    expect(settlementError).toBeInstanceOf(DesignPersistenceSettlementError)
    expect(settlementError).toMatchObject({ errors: causes })
  })

  it('reserves save issue order before Canvas composition can reenter persistence', () => {
    const original = makeDesign('Original')
    const operationStore = createMemoryDesignSessionStore({ file: original, name: original.name })
    let nested: ReturnType<ReturnType<typeof createDesignSessionPersistence>['beginSaveAs']> | null = null
    let nestedIssued = false
    let persistence!: ReturnType<typeof createDesignSessionPersistence>
    const capture = checkpointSession((_metadata, design) => {
      if (!nestedIssued) {
        nestedIssued = true
        nested = persistence.beginSaveAs()
      }
      return design
    })
    persistence = createDesignSessionPersistence({ store: operationStore })
    persistence.attachCanvas(capture.session)

    const outer = persistence.beginSaveAs()

    expect(nested).not.toBeNull()
    expect(nested!.succeed('/designs/nested.canopi').status).toBe('applied')
    expect(outer.succeed('/designs/outer.canopi').status).toBe('stale')
    expect(operationStore.readDesignPath()).toBe('/designs/nested.canopi')
  })

  it('reports recovery failure only for the still-current Design without advancing baselines', () => {
    const original = makeDesign('Original')
    const operationStore = createMemoryDesignSessionStore({ file: original, name: original.name })
    const persistence = createDesignSessionPersistence({ store: operationStore })
    operationStore.markDocumentDirty()
    const recovery = persistence.beginRecovery()

    recovery.succeed()
    expect(operationStore.isDesignDirty()).toBe(true)
    expect(operationStore.autosaveFailed.value).toBe(false)

    const stale = persistence.beginRecovery()
    operationStore.replaceCurrentDesignState(makeDesign('Replacement'), null, 'Replacement')
    operationStore.resetDirtyBaselines()
    stale.fail(new Error('late failure'))
    expect(operationStore.autosaveFailed.value).toBe(false)
  })

  it('defensively owns the exact Canvas-composed snapshot', () => {
    const original = makeDesign('Original')
    const operationStore = createMemoryDesignSessionStore({ file: original, name: original.name })
    const capturedPlant = { id: 'captured-plant' } as CanopiFile['plants'][number]
    const capture = checkpointSession((metadata, design) => ({
      ...design,
      name: metadata.name,
      plants: [capturedPlant],
    }))
    const persistence = createDesignSessionPersistence({ store: operationStore })
    persistence.attachCanvas(capture.session)

    const operation = persistence.beginBrowserDownload()
    const callerCopy = operation.content
    callerCopy.plants.length = 0

    expect(operation.content.plants).toEqual([capturedPlant])
    expect(capture.session.captureForPersistence).toHaveBeenCalledWith(
      { name: 'Original' },
      expect.objectContaining({ name: 'Original' }),
    )
  })

  it('settles idempotently without acknowledging Canvas twice', () => {
    const original = {
      ...makeDesign('Original'),
      plants: [{ id: 'captured-plant' } as CanopiFile['plants'][number]],
    }
    const operationStore = createMemoryDesignSessionStore({ file: original, name: original.name })
    const capture = checkpointSession()
    const persistence = createDesignSessionPersistence({ store: operationStore })
    persistence.attachCanvas(capture.session)
    operationStore.markDocumentDirty()
    const operation = persistence.beginBrowserDownload()

    const first = operation.succeed()
    first.content.plants.length = 0
    const second = operation.succeed()

    expect(second).toBe(first)
    expect(second.content.plants).toHaveLength(1)
    expect(capture.acknowledgeSaved).toHaveBeenCalledTimes(1)
    expect(operationStore.isDesignDirty()).toBe(false)
  })

  it('lets only the latest recovery outcome control autosave failure', () => {
    const original = makeDesign('Original')
    const operationStore = createMemoryDesignSessionStore({ file: original, name: original.name })
    const persistence = createDesignSessionPersistence({ store: operationStore })
    const first = persistence.beginRecovery()
    const second = persistence.beginRecovery()

    second.fail(new Error('latest failure'))
    expect(operationStore.autosaveFailed.value).toBe(true)

    expect(first.succeed()).toBe(false)
    expect(operationStore.autosaveFailed.value).toBe(true)
  })

  it('prevents an older recovery failure from overriding a manual success', () => {
    const original = makeDesign('Original')
    const operationStore = createMemoryDesignSessionStore({ file: original, name: original.name })
    const persistence = createDesignSessionPersistence({ store: operationStore })
    operationStore.markDocumentDirty()
    const recovery = persistence.beginRecovery()
    const manual = persistence.beginBrowserDownload()

    expect(manual.succeed().status).toBe('applied')
    recovery.fail(new Error('late recovery failure'))

    expect(operationStore.autosaveFailed.value).toBe(false)
  })

  it('cleans a store-authoritative Canvas baseline while attachment is still hydrating', () => {
    const original = makeDesign('Original')
    const operationStore = createMemoryDesignSessionStore({ file: original, name: original.name })
    const capture = checkpointSession()
    vi.mocked(capture.session.hasLoadedDocument).mockReturnValue(false)
    const persistence = createDesignSessionPersistence({ store: operationStore })
    persistence.attachCanvas(capture.session)
    operationStore.markCanvasDetachedDirty(true)
    const operation = persistence.beginBrowserDownload()

    expect(operation.succeed().status).toBe('applied')
    expect(capture.session.captureForPersistence).not.toHaveBeenCalled()
    expect(operationStore.isDesignDirty()).toBe(false)
  })

  it('makes an unloaded Canvas capture stale when hydration admits a later Scene edit', () => {
    const original = makeDesign('Original')
    const operationStore = createMemoryDesignSessionStore({ file: original, name: original.name })
    const capture = checkpointSession()
    let loaded = false
    vi.mocked(capture.session.hasLoadedDocument).mockImplementation(() => loaded)
    const persistence = createDesignSessionPersistence({ store: operationStore })
    persistence.attachCanvas(capture.session)
    operationStore.markCanvasDetachedDirty(true)
    const operation = persistence.beginBrowserDownload()

    loaded = true
    operationStore.setCanvasClean(false)

    expect(operation.succeed().status).toBe('stale')
    expect(operationStore.isDesignDirty()).toBe(true)
  })

  it('makes a detached capture stale when a newer canvas handoff replaces its snapshot', () => {
    const original = makeDesign('Original')
    const operationStore = createMemoryDesignSessionStore({
      file: original,
      path: '/designs/original.canopi',
      name: original.name,
    })
    const persistence = createDesignSessionPersistence({ store: operationStore })
    const operation = persistence.beginSave()

    operationStore.replaceCurrentDesignSnapshot({
      ...original,
      plants: [{ id: 'newer-handoff' } as CanopiFile['plants'][number]],
    })

    expect(operation.succeed().status).toBe('stale')
  })

  it('invalidates detached captures before publishing a newer handoff snapshot', () => {
    const original = makeDesign('Original')
    const operationStore = createMemoryDesignSessionStore({
      file: original,
      path: '/designs/original.canopi',
      name: original.name,
    })
    const persistence = createDesignSessionPersistence({ store: operationStore })
    const operation = persistence.beginSave()
    let settleDuringPublication = false
    const settlement: { current: ReturnType<typeof operation.succeed> | null } = { current: null }
    const dispose = effect(() => {
      void operationStore.currentDesign.value
      if (!settleDuringPublication) return
      settleDuringPublication = false
      settlement.current = operation.succeed()
    })

    settleDuringPublication = true
    operationStore.replaceCurrentDesignSnapshot({
      ...original,
      plants: [{ id: 'newer-handoff' } as CanopiFile['plants'][number]],
    })
    dispose()

    expect(settlement.current?.status).toBe('stale')
  })

  it('marks a current Browser Draft failure without exposing acknowledgement policy', () => {
    const original = makeDesign('Original')
    const operationStore = createMemoryDesignSessionStore({ file: original, name: original.name })
    const persistence = createDesignSessionPersistence({ store: operationStore })
    const operation = persistence.beginBrowserDraft()

    operation.fail(new Error('storage unavailable'))

    expect(operationStore.autosaveFailed.value).toBe(true)
  })

  it('captures handoff and diagnostic content without advancing a baseline', () => {
    const original = makeDesign('Original')
    const operationStore = createMemoryDesignSessionStore({ file: original, name: original.name })
    const capture = checkpointSession()
    const persistence = createDesignSessionPersistence({ store: operationStore })
    persistence.attachCanvas(capture.session)
    operationStore.markDocumentDirty()

    expect(persistence.settleCanvasHandoff(capture.session)?.name).toBe('Original')
    expect(persistence.captureObservation(capture.session)?.name).toBe('Original')

    expect(operationStore.isDesignDirty()).toBe(true)
    expect(capture.acknowledgeSaved).not.toHaveBeenCalled()
  })

  it('rejects diagnostic observation through a foreign or detached Canvas identity', () => {
    const original = makeDesign('Original')
    const operationStore = createMemoryDesignSessionStore({ file: original, name: original.name })
    const attached = checkpointSession()
    const foreign = checkpointSession()
    const persistence = createDesignSessionPersistence({ store: operationStore })
    persistence.attachCanvas(attached.session)

    expect(() => persistence.captureObservation(foreign.session))
      .toThrow('Canvas persistence lease')
    expect(() => persistence.captureObservation(null))
      .toThrow('Canvas persistence lease')
    expect(foreign.session.captureForPersistence).not.toHaveBeenCalled()
  })

  it('recaptures a handoff instead of overwriting a Design edit made during Canvas composition', () => {
    const original = makeDesign('Original')
    const operationStore = createMemoryDesignSessionStore({ file: original, name: original.name })
    let editDuringFirstCapture = true
    const capture = checkpointSession((metadata, document) => {
      if (editDuringFirstCapture) {
        editDuringFirstCapture = false
        operationStore.mutateCurrentDesign((current) => ({
          ...current,
          description: 'Design edit made during Canvas composition',
        }))
      }
      return { ...document, name: metadata.name }
    })
    const persistence = createDesignSessionPersistence({ store: operationStore })
    persistence.attachCanvas(capture.session)

    persistence.settleCanvasHandoff(capture.session)

    expect(capture.session.captureForPersistence).toHaveBeenCalledTimes(2)
    expect(operationStore.readCurrentDesign()?.description).toBe(
      'Design edit made during Canvas composition',
    )
  })

  it('invalidates a replacement guard when its exact Canvas checkpoint diverges', () => {
    const original = makeDesign('Original')
    const operationStore = createMemoryDesignSessionStore({ file: original, name: original.name })
    let canvasCheckpointCurrent = true
    const capture = checkpointSession()
    vi.mocked(capture.session.captureForPersistence).mockImplementation((metadata, document) => ({
      content: { ...document, name: metadata.name },
      isCurrent: () => canvasCheckpointCurrent,
      acknowledgeSaved: () => 'applied' as const,
    }))
    const persistence = createDesignSessionPersistence({ store: operationStore })
    persistence.attachCanvas(capture.session)
    const guard = persistence.beginReplacementGuard().guard

    canvasCheckpointCurrent = false

    expect(guard?.isCurrent()).toBe(false)
  })

  it('retries Canvas acknowledgement publication before consuming success', () => {
    const original = makeDesign('Original')
    const operationStore = createMemoryDesignSessionStore({ file: original, name: original.name })
    const capture = checkpointSession()
    capture.acknowledgeSaved
      .mockImplementationOnce(() => {
        throw new Error('clean publication failed')
      })
      .mockImplementationOnce(() => 'applied')
    const persistence = createDesignSessionPersistence({ store: operationStore })
    persistence.attachCanvas(capture.session)
    const operation = persistence.beginBrowserDownload()

    expect(() => operation.succeed()).toThrow('clean publication failed')
    expect(operation.succeed().status).toBe('applied')
    expect(capture.acknowledgeSaved).toHaveBeenCalledTimes(2)
  })
})
