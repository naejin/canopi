import { effect } from '@preact/signals'
import { describe, expect, it, vi } from 'vitest'
import {
  designEditAuthorityCapability,
  disposeDesignEditAuthority,
} from '../app/design-edit/authority-capability'
import { createDesignSessionPersistence } from '../app/document-session/persistence'
import { captureDesignSessionPersistenceState } from '../app/document-session/persistence-capability'
import {
  createDesignSessionStoreTestFixture,
  createMemoryDesignSessionStore,
} from '../app/document-session/store'
import { prepareDesignWriteDestination } from '../app/document-session/write-admission'
import type { CanopiFile } from '../types/design'
import { reconcileDesignSessionForTest } from './support/design-session-edit'

describe('Design Edit authority', () => {
  it('resets one store lifetime without reviving predecessor previews or captures', () => {
    const predecessor = design('Predecessor')
    const successor = design('Successor')
    const store = createMemoryDesignSessionStore({
      file: predecessor,
      path: '/predecessor.canopi',
      name: predecessor.name,
    })
    const fixture = createDesignSessionStoreTestFixture(store)
    const edit = designEditAuthorityCapability(store).beginPreview('Timeline move')
    edit.preview((current) => ({ ...current, description: 'preview' }))
    const capture = captureDesignSessionPersistenceState(store)
    fixture.setState({
      nonCanvasRevision: 2,
      nonCanvasSavedRevision: 1,
      persistenceDiverged: true,
      canvasClean: false,
      detachedCanvasDirty: true,
      autosaveFailed: true,
      pendingDesignPath: '/queued.canopi',
      pendingTemplateImport: {
        identity: 'template-reset',
        file: design('Template'),
        name: 'Template',
      },
    })

    fixture.reset({
      file: successor,
      path: '/successor.canopi',
      name: successor.name,
    })

    expect(edit.commit()).toEqual({ status: 'superseded' })
    expect(capture.isCurrent()).toBe(false)
    expect(capture.acknowledgeSaved()).toBe('stale')
    expect(store.readIdentity()).toEqual({
      file: successor,
      path: '/successor.canopi',
      name: 'Successor',
    })
    expect(store.isDesignDirty()).toBe(false)
    expect(store.autosaveFailed.value).toBe(false)
    expect(store.committedDesignRevision.value).toBe(0)
    expect(store.readPendingDesignPath()).toBe(null)
    expect(store.readPendingTemplateImport()).toBe(null)

    const successorEdit = designEditAuthorityCapability(store).beginPreview('Successor edit')
    successorEdit.preview((current) => ({ ...current, description: 'committed' }))
    expect(successorEdit.commit()).toEqual({ status: 'committed', changed: true })
    expect(store.readCurrentDesign()?.description).toBe('committed')
  })

  it('records one superseded outcome after Design replacement', () => {
    const predecessor = design('Predecessor')
    const successor = design('Successor')
    const store = createMemoryDesignSessionStore({
      file: predecessor,
      name: predecessor.name,
    })
    const edit = designEditAuthorityCapability(store).beginPreview('Timeline move')
    edit.preview((current) => ({ ...current, description: 'preview' }))

    store.replaceCurrentDesignState(successor, null, successor.name)

    const commitOutcome = edit.commit()
    const abortOutcome = edit.abort()

    expect(commitOutcome).toEqual({ status: 'superseded' })
    expect(abortOutcome).toBe(commitOutcome)
    expect(store.readCurrentDesign()).toBe(successor)
    expect(store.isDesignDirty()).toBe(false)
  })

  it('invalidates handles and captures across an authority lifetime rollover', async () => {
    const original = design('Original')
    const store = createMemoryDesignSessionStore({ file: original, name: original.name })
    const persistence = createDesignSessionPersistence({ store })
    const capture = captureDesignSessionPersistenceState(store)
    const guard = persistence.beginReplacementGuard().guard
    const pendingWrite = persistence.beginBrowserDownload()
    const edit = designEditAuthorityCapability(store).beginPreview('Consortium drag')
    edit.preview((current) => ({ ...current, description: 'preview-only' }))

    disposeDesignEditAuthority(store)

    expect(store.readCurrentDesign()).toBe(original)
    expect(capture.isCurrent()).toBe(false)
    expect(guard?.isCurrent()).toBe(false)

    edit.preview((current) => ({ ...current, description: 'late preview' }))
    const commitOutcome = edit.commit()
    const abortOutcome = edit.abort()
    expect(commitOutcome).toEqual({ status: 'superseded' })
    expect(abortOutcome).toBe(commitOutcome)
    expect(Object.isFrozen(commitOutcome)).toBe(true)
    expect(store.readCurrentDesign()).toBe(original)
    expect(store.isDesignDirty()).toBe(false)

    const write = vi.fn()
    await expect(pendingWrite.execute(
      prepareDesignWriteDestination({
        resource: 'browser-download:authority-disposal',
        blocksReplacement: false,
        write,
      }),
    )).resolves.toMatchObject({ status: 'stale' })
    expect(write).not.toHaveBeenCalled()

    const successorEdit = designEditAuthorityCapability(store).beginPreview('new lifetime')
    successorEdit.preview((current) => ({ ...current, description: 'committed later' }))
    expect(successorEdit.commit()).toEqual({ status: 'committed', changed: true })
    expect(store.readCurrentDesign()?.description).toBe('committed later')
  })

  it('retains the prior projector when a preview replacement fails', () => {
    const original = design('Original')
    const store = createMemoryDesignSessionStore({ file: original, name: original.name })
    const edit = designEditAuthorityCapability(store).beginPreview('Timeline move')
    edit.preview((current) => ({ ...current, description: 'stable preview' }))

    expect(() => edit.preview(() => {
      throw new Error('replacement projector failed')
    })).toThrow('replacement projector failed')

    reconcileDesignSessionForTest(store, (current) => ({
      ...current,
      name: 'Reconciled',
    }))

    expect(store.readCurrentDesign()).toMatchObject({
      name: 'Reconciled',
      description: 'stable preview',
    })
    edit.abort()
    expect(store.readCurrentDesign()).toMatchObject({
      name: 'Reconciled',
      description: null,
    })
    expect(store.isDesignDirty()).toBe(false)
  })

  it('keeps the preview abortable when its projector fails during commit', () => {
    const original = design('Original')
    const store = createMemoryDesignSessionStore({ file: original, name: original.name })
    const edit = designEditAuthorityCapability(store).beginPreview('Consortium drag')
    let projectorFails = false
    edit.preview((current) => {
      if (projectorFails) throw new Error('commit projection failed')
      return { ...current, description: 'visible preview' }
    })
    projectorFails = true

    expect(() => edit.commit()).toThrow('commit projection failed')
    expect(store.readCurrentDesign()?.description).toBe('visible preview')
    expect(store.isDesignDirty()).toBe(false)

    expect(edit.abort()).toEqual({ status: 'aborted' })
    expect(store.readCurrentDesign()).toBe(original)
    expect(store.isDesignDirty()).toBe(false)
  })

  it('installs terminal commit state before reactive publication', () => {
    const original = design('Original')
    const store = createMemoryDesignSessionStore({ file: original, name: original.name })
    const edit = designEditAuthorityCapability(store).beginPreview('Timeline move')
    edit.preview((current) => ({ ...current, description: 'committed preview' }))
    let settleDuringPublication = false
    let reentrantOutcome: ReturnType<typeof edit.abort> | null = null
    const dispose = effect(() => {
      const description = store.currentDesign.value?.description
      if (!settleDuringPublication || description !== 'committed preview') return
      reentrantOutcome = edit.abort()
    })

    try {
      settleDuringPublication = true
      const commitOutcome = edit.commit()

      expect(commitOutcome).toEqual({ status: 'committed', changed: true })
      expect(reentrantOutcome).toBe(commitOutcome)
      expect(store.readCurrentDesign()?.description).toBe('committed preview')
      expect(store.isDesignDirty()).toBe(true)
    } finally {
      dispose()
    }
  })
})

function design(name: string): CanopiFile {
  return {
    version: 5,
    name,
    description: null,
    location: null,
    north_bearing_deg: 0,
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
    created_at: '',
    updated_at: '',
    extra: {},
  }
}
