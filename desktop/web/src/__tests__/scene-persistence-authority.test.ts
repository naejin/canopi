import { describe, expect, it, vi } from 'vitest'

import { SceneHistory } from '../canvas/runtime/scene-history'
import { SceneStore } from '../canvas/runtime/scene'
import { CanvasAuthorityBusyError } from '../canvas/runtime/runtime'
import { SceneRuntimeEditCoordinator } from '../canvas/runtime/scene-runtime/transactions'
import type { CanopiFile } from '../types/design'

function createAuthority() {
  const store = new SceneStore()
  const history = new SceneHistory()
  const authority = new SceneRuntimeEditCoordinator({
    sceneStore: store,
    history,
    setSelection: (ids) => store.setSelection(ids),
    incrementSceneRevision: vi.fn(),
    syncCanvasSignalsFromScene: vi.fn(),
    invalidate: vi.fn(),
  })
  return { authority, history, store }
}

describe('Settled Scene persistence authority', () => {
  it('captures the committed before-state while a live preview remains visible', () => {
    const { authority, history, store } = createAuthority()
    const edit = authority.begin('drag')
    edit.mutate((draft) => {
      draft.plantSpeciesColors['Malus domestica'] = '#aa0000'
    })

    const capture = authority.capturePersistence()

    expect(store.persisted.plantSpeciesColors['Malus domestica']).toBe('#aa0000')
    expect(capture.scene.plantSpeciesColors['Malus domestica']).toBeUndefined()

    edit.abort()
    expect(capture.acknowledgeSaved()).toBe('applied')
    expect(history.isClean).toBe(true)
  })

  it('leaves a committed edit dirty when acknowledging its older capture', () => {
    const { authority, history } = createAuthority()
    const edit = authority.begin('drag')
    edit.mutate((draft) => {
      draft.plantSpeciesColors['Malus domestica'] = '#aa0000'
    })
    const capture = authority.capturePersistence()

    edit.commit()

    expect(capture.acknowledgeSaved()).toBe('applied')
    expect(history.isClean).toBe(false)
  })

  it('makes checkpoints stale when another document is hydrated', () => {
    const { authority } = createAuthority()
    const capture = authority.capturePersistence()

    authority.hydrate(new SceneStore().toCanopiFile())

    expect(capture.acknowledgeSaved()).toBe('stale')
  })

  it('captures the after-state once history has accepted a committing edit', () => {
    const store = new SceneStore()
    let authority!: SceneRuntimeEditCoordinator
    const reentrantCaptures: Array<
      ReturnType<SceneRuntimeEditCoordinator['capturePersistence']>
    > = []
    const history = new SceneHistory({
      reportCleanState: (clean) => {
        if (!clean && reentrantCaptures.length === 0) {
          reentrantCaptures.push(authority.capturePersistence())
        }
      },
    })
    authority = new SceneRuntimeEditCoordinator({
      sceneStore: store,
      history,
      setSelection: (ids) => store.setSelection(ids),
      incrementSceneRevision: vi.fn(),
      syncCanvasSignalsFromScene: vi.fn(),
      invalidate: vi.fn(),
    })
    const edit = authority.begin('command')
    edit.mutate((draft) => {
      draft.plantSpeciesColors['Malus domestica'] = '#aa0000'
    })

    edit.commit()

    const reentrantCapture = reentrantCaptures[0]
    expect(reentrantCapture?.scene.plantSpeciesColors['Malus domestica']).toBe('#aa0000')
    expect(reentrantCapture?.acknowledgeSaved()).toBe('applied')
    expect(history.isClean).toBe(true)
  })

  it('rejects mixed capture while document hydration is settling', () => {
    const store = new SceneStore()
    let authority!: SceneRuntimeEditCoordinator
    let captureError: unknown = null
    const history = new SceneHistory({
      reportCleanState: () => {
        try {
          authority.capturePersistence()
        } catch (error) {
          captureError = error
        }
      },
    })
    authority = new SceneRuntimeEditCoordinator({
      sceneStore: store,
      history,
      setSelection: (ids) => store.setSelection(ids),
      incrementSceneRevision: vi.fn(),
      syncCanvasSignalsFromScene: vi.fn(),
      invalidate: vi.fn(),
    })

    authority.hydrate(new SceneStore().toCanopiFile())

    expect(captureError).toMatchObject({ name: 'SceneEditBusyError' })
    expect(captureError).toBeInstanceOf(CanvasAuthorityBusyError)
    expect(() => authority.capturePersistence()).not.toThrow()
  })

  it('invalidates a capture when its runtime lifetime ends', () => {
    const { authority, history } = createAuthority()
    const capture = authority.capturePersistence()
    authority.run('later-edit', (edit) => {
      edit.mutate((draft) => {
        draft.plantSpeciesColors['Malus domestica'] = '#aa0000'
      })
    })

    authority.disposePersistence()

    expect(capture.acknowledgeSaved()).toBe('stale')
    expect(history.isClean).toBe(false)
  })

  it('rejects capture while a partially applied history replay is quarantined', () => {
    const store = new SceneStore()
    const history = new SceneHistory()
    let selectionFailures = 0
    const authority = new SceneRuntimeEditCoordinator({
      sceneStore: store,
      history,
      setSelection: (ids) => {
        if (selectionFailures > 0) {
          selectionFailures -= 1
          throw new Error('selection replay failed')
        }
        store.setSelection(ids)
      },
      incrementSceneRevision: vi.fn(),
      syncCanvasSignalsFromScene: vi.fn(),
      invalidate: vi.fn(),
    })
    authority.run('edit-and-select', (edit) => {
      edit.mutate((draft) => {
        draft.plantSpeciesColors['Malus domestica'] = '#aa0000'
      })
      edit.setSelection(['plant-1'])
    })

    selectionFailures = 1
    expect(() => authority.undo()).toThrow('selection replay failed')
    expect(store.persisted.plantSpeciesColors['Malus domestica']).toBeUndefined()
    expect(() => authority.capturePersistence()).toThrow('scene-history-undo')

    expect(authority.undo()).toBe(true)
    const capture = authority.capturePersistence()
    expect(capture.acknowledgeSaved()).toBe('applied')
    expect(history.isClean).toBe(true)
    expect(authority.redo()).toBe(true)
    expect(history.isClean).toBe(false)
  })

  it('returns stale when document replacement reenters clean-state publication', () => {
    const store = new SceneStore()
    let authority!: SceneRuntimeEditCoordinator
    let replaceOnPublish = false
    const history = new SceneHistory({
      reportCleanState: () => {
        if (!replaceOnPublish) return
        replaceOnPublish = false
        authority.hydrate(new SceneStore().toCanopiFile())
      },
    })
    authority = new SceneRuntimeEditCoordinator({
      sceneStore: store,
      history,
      setSelection: (ids) => store.setSelection(ids),
      incrementSceneRevision: vi.fn(),
      syncCanvasSignalsFromScene: vi.fn(),
      invalidate: vi.fn(),
    })
    const capture = authority.capturePersistence()

    replaceOnPublish = true

    expect(capture.acknowledgeSaved()).toBe('stale')
    expect(history.isClean).toBe(true)
  })

  it('rejects new persistence captures after the runtime lifetime ends', () => {
    const { authority } = createAuthority()

    authority.disposePersistence()

    expect(() => authority.capturePersistence()).toThrow('runtime-disposed')
  })

  it('invalidates exact persisted projection identity when presentation backfills apply', () => {
    const { authority, store } = createAuthority()
    const file = store.toCanopiFile()
    file.plants = [{
      id: 'plant-1',
      canonical_name: 'Malus domestica',
      common_name: 'Apple',
      color: null,
      position: { x: 10, y: 10 },
      rotation: null,
      scale: null,
      notes: null,
      planted_date: null,
      quantity: 1,
      locked: false,
    } as CanopiFile['plants'][number]]
    authority.hydrate(file)
    const ticket = authority.issueTicket()
    const capture = authority.capturePersistence()

    expect(authority.applyBackfills(ticket, [{
      plantId: 'plant-1',
      canonicalName: 'Malus domestica',
      stratum: 'canopy',
      canopySpreadM: 4,
      scale: 4,
    }])).toBe('applied')

    expect(capture.isCurrent()).toBe(false)
    expect(capture.acknowledgeSaved()).toBe('applied')
  })
})
