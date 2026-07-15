import { effect, signal } from '@preact/signals'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { canvasClean } from '../../../__tests__/support/design-session-state'
import type { CanopiFile } from '../../../types/design'
import { selectedObjectIds } from '../../session-state'
import {
  CanvasDocumentReplacementNotAdmittedError,
  createCanvasDocumentReplacementToken,
} from '../runtime'
import { SceneHistory } from '../scene-history'
import { SceneStore } from '../scene'
import {
  SceneEditBusyError,
  SceneRuntimeEditCoordinator,
  type SceneEditInvalidationKind,
  type SceneEditTransaction,
} from './transactions'

function makeFile(): CanopiFile {
  return {
    version: 1,
    name: 'Transaction demo',
    description: null,
    location: null,
    north_bearing_deg: 0,
    plant_species_colors: {},
    layers: [
      { name: 'plants', visible: true, locked: false, opacity: 1 },
      { name: 'zones', visible: true, locked: false, opacity: 1 },
    ],
    plants: [
      {
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
      },
      {
        id: 'plant-2',
        canonical_name: 'Pyrus communis',
        common_name: 'Pear',
        color: null,
        position: { x: 30, y: 30 },
        rotation: null,
        scale: null,
        notes: null,
        planted_date: null,
        quantity: 1,
        locked: false,
      },
    ],
    zones: [],
    annotations: [],
    consortiums: [],
    groups: [],
    timeline: [],
    budget: [],
    budget_currency: 'EUR',
    created_at: '2026-04-02T00:00:00.000Z',
    updated_at: '2026-04-02T00:00:00.000Z',
    extra: {},
  }
}

function createHarness() {
  const sceneStore = new SceneStore(makeFile())
  const history = new SceneHistory()
  const invalidations: SceneEditInvalidationKind[] = []
  let sceneRevision = 0
  const setSelection = (ids: Iterable<string>) => {
    const next = new Set(ids)
    sceneStore.setSelection(next)
    selectedObjectIds.value = next
  }
  const sceneEdits = new SceneRuntimeEditCoordinator({
    sceneStore,
    history,
    setSelection,
    incrementSceneRevision: () => {
      sceneRevision += 1
    },
    syncCanvasSignalsFromScene: () => {},
    invalidate: (kind) => {
      invalidations.push(kind)
    },
  })

  return {
    sceneStore,
    history,
    sceneEdits,
    invalidations,
    setSelection,
    readSceneRevision: () => sceneRevision,
  }
}

describe('scene edit transactions', () => {
  beforeEach(() => {
    canvasClean.value = true
    selectedObjectIds.value = new Set()
  })

  it('commits a command edit as one history entry and one scene revision', () => {
    const { sceneStore, history, sceneEdits, invalidations, readSceneRevision } = createHarness()

    const committed = sceneEdits.run('command-move-plant', (tx) => {
      tx.mutate((draft) => {
        draft.plants[0]!.position = { x: 42, y: 10 }
      })
    })

    expect(committed).toBe(true)
    expect(sceneStore.persisted.plants[0]?.position).toEqual({ x: 42, y: 10 })
    expect(readSceneRevision()).toBe(1)
    expect(history.canUndo.value).toBe(true)
    expect(invalidations).toEqual(['scene'])

    sceneEdits.undo()

    expect(sceneStore.persisted.plants[0]?.position).toEqual({ x: 10, y: 10 })
    expect(history.canUndo.value).toBe(false)
    expect(history.canRedo.value).toBe(true)

    sceneEdits.redo()

    expect(sceneStore.persisted.plants[0]?.position).toEqual({ x: 42, y: 10 })
    expect(history.canUndo.value).toBe(true)
    expect(history.canRedo.value).toBe(false)
  })

  it('does not dirty history, bump revision, or invalidate rendering for no-op edits', () => {
    const { sceneStore, history, sceneEdits, invalidations, readSceneRevision } = createHarness()

    const committed = sceneEdits.run('noop', (tx) => {
      tx.mutate((draft) => {
        draft.plants = draft.plants.map((plant) => ({ ...plant }))
      })
      tx.setSelection(sceneStore.session.selectedEntityIds)
    })

    expect(committed).toBe(false)
    expect(history.canUndo.value).toBe(false)
    expect(readSceneRevision()).toBe(0)
    expect(invalidations).toEqual([])
  })

  it('aborts and restores persisted scene, selection, and embedded locks', () => {
    const { sceneStore, history, sceneEdits, invalidations, setSelection, readSceneRevision } = createHarness()
    setSelection(['plant-1'])
    sceneStore.updatePersisted((draft) => {
      draft.plants[0]!.locked = true
    })

    const tx = sceneEdits.begin('interaction-drag')
    tx.mutate((draft) => {
      draft.plants[0]!.position = { x: 99, y: 99 }
      draft.plants[0]!.locked = false
      draft.plants = draft.plants.slice(0, 1)
    })
    tx.setSelection(['plant-2'])

    expect(tx.changed).toBe(true)

    tx.abort()

    expect(sceneStore.persisted.plants).toHaveLength(2)
    expect(sceneStore.persisted.plants[0]?.position).toEqual({ x: 10, y: 10 })
    expect(sceneStore.persisted.plants[0]?.locked).toBe(true)
    expect(sceneStore.session.selectedEntityIds).toEqual(new Set(['plant-1']))
    expect(selectedObjectIds.value).toEqual(new Set(['plant-1']))
    expect(history.canUndo.value).toBe(false)
    expect(readSceneRevision()).toBe(0)
    expect(invalidations).toEqual([])
  })

  it('commits long-lived interaction edits through the same lifecycle', () => {
    const { sceneStore, history, sceneEdits, invalidations, readSceneRevision } = createHarness()
    const tx = sceneEdits.begin('interaction-drag')

    tx.mutate((draft) => {
      draft.plants[1]!.position = { x: 35, y: 35 }
    })

    expect(tx.commit({ invalidate: 'viewport' })).toBe(true)
    expect(sceneStore.persisted.plants[1]?.position).toEqual({ x: 35, y: 35 })
    expect(readSceneRevision()).toBe(1)
    expect(history.canUndo.value).toBe(true)
    expect(invalidations).toEqual(['viewport'])
  })
})

function createAdmissionHarness(options: {
  readonly history?: SceneHistory
  readonly setSelection?: (ids: Iterable<string>) => void
  readonly incrementSceneRevision?: () => void
  readonly syncCanvasSignalsFromScene?: () => void
  readonly invalidate?: (kind: SceneEditInvalidationKind) => void
} = {}): {
  readonly coordinator: SceneRuntimeEditCoordinator
  readonly store: SceneStore
  readonly history: SceneHistory
} {
  const store = new SceneStore(makeFile())
  const history = options.history ?? new SceneHistory()
  const coordinator = new SceneRuntimeEditCoordinator({
    sceneStore: store,
    history,
    setSelection: options.setSelection ?? ((ids) => store.setSelection(ids)),
    incrementSceneRevision: options.incrementSceneRevision ?? (() => {}),
    syncCanvasSignalsFromScene: options.syncCanvasSignalsFromScene ?? (() => {}),
    invalidate: options.invalidate ?? vi.fn(),
  })
  return { coordinator, store, history }
}

describe('Scene Edit single-writer admission', () => {
  it('does not strand authority when admission observers throw during acquire or release', () => {
    const { coordinator } = createAdmissionHarness()
    let publicationFailure: string | null = null
    const dispose = effect(() => {
      void coordinator.revision.value
      if (!publicationFailure) return
      const message = publicationFailure
      publicationFailure = null
      throw new Error(message)
    })

    publicationFailure = 'acquire observer failed'
    const active = coordinator.begin('interaction-drag')
    publicationFailure = 'release observer failed'
    active.abort()

    const next = coordinator.begin('interaction-rotation')
    next.abort()
    dispose()
  })

  it('rejects a second long-lived edit with a typed busy error', () => {
    const { coordinator } = createAdmissionHarness()
    const active = coordinator.begin('interaction-drag')
    let busyError: unknown

    try {
      coordinator.begin('interaction-rotation')
    } catch (error) {
      busyError = error
    }

    expect(busyError).toBeInstanceOf(SceneEditBusyError)
    expect((busyError as SceneEditBusyError).activeType).toBe('interaction-drag')

    active.abort()
  })

  it('does not invoke an immediate edit while a long-lived edit owns the Scene', () => {
    const { coordinator } = createAdmissionHarness()
    const active = coordinator.begin('interaction-drag')
    const edit = vi.fn()

    expect(coordinator.run('delete-selected', edit)).toBe(false)
    expect(edit).not.toHaveBeenCalled()

    active.abort()
    expect(coordinator.run('move-after-settlement', (tx) => {
      tx.mutate((draft) => {
        draft.plants[0]!.position = { x: 11, y: 12 }
      })
    })).toBe(true)
  })

  it('retains ownership until a failed abort is retried successfully', () => {
    let failNextSelection = false
    const { coordinator, store } = createAdmissionHarness({
      setSelection: (ids) => {
        if (failNextSelection) {
          failNextSelection = false
          throw new Error('selection restore failed')
        }
        store.setSelection(ids)
      },
    })
    store.setSelection(['plant-1'])
    const active = coordinator.begin('interaction-drag')
    active.mutate((draft) => {
      draft.plants[0]!.position = { x: 99, y: 99 }
    })
    active.setSelection(['plant-2'])
    failNextSelection = true

    expect(() => active.abort()).toThrow('selection restore failed')

    expect(store.persisted.plants[0]?.position).toEqual({ x: 10, y: 10 })
    expect(store.session.selectedEntityIds).toEqual(new Set(['plant-2']))
    const blockedEdit = vi.fn()
    expect(coordinator.run('delete-selected', blockedEdit)).toBe(false)
    expect(blockedEdit).not.toHaveBeenCalled()
    expect(() => coordinator.begin('interaction-rotation'))
      .toThrowError(SceneEditBusyError)

    active.abort()

    expect(store.persisted.plants[0]?.position).toEqual({ x: 10, y: 10 })
    expect(store.session.selectedEntityIds).toEqual(new Set(['plant-1']))
    const next = coordinator.begin('interaction-rotation')
    next.abort()
  })

  it('preserves hover Session state when a Scene Edit aborts', () => {
    const { coordinator, store } = createAdmissionHarness()
    const active = coordinator.begin('interaction-drag')
    active.mutate((draft) => {
      draft.plants[0]!.position = { x: 99, y: 99 }
    })
    store.updateSession((session) => {
      session.hoveredEntityId = 'plant-2'
    })

    active.abort()

    expect(store.persisted.plants[0]?.position).toEqual({ x: 10, y: 10 })
    expect(store.session.hoveredEntityId).toBe('plant-2')
  })

  it('retries committed publication without recording history twice or permitting abort', () => {
    let failInvalidation = true
    const { coordinator, store } = createAdmissionHarness({
      invalidate: () => {
        if (!failInvalidation) return
        failInvalidation = false
        throw new Error('invalidation failed')
      },
    })
    const active = coordinator.begin('interaction-drag')
    active.mutate((draft) => {
      draft.plants[0]!.position = { x: 99, y: 99 }
    })

    expect(() => active.commit()).toThrow('invalidation failed')
    expect(coordinator.canUndo.value).toBe(false)
    expect(coordinator.run('blocked-during-finalization', vi.fn())).toBe(false)

    active.abort()

    expect(store.persisted.plants[0]?.position).toEqual({ x: 99, y: 99 })
    expect(coordinator.canUndo.value).toBe(true)
    expect(coordinator.undo()).toBe(true)
    expect(store.persisted.plants[0]?.position).toEqual({ x: 10, y: 10 })
    expect(coordinator.undo()).toBe(false)
  })

  it('returns the committed outcome when an immediate edit publication succeeds on retry', () => {
    let invalidationFailures = 1
    const { coordinator, store, history } = createAdmissionHarness({
      invalidate: () => {
        if (invalidationFailures > 0) {
          invalidationFailures -= 1
          throw new Error('invalidation failed')
        }
      },
    })

    expect(coordinator.run('immediate-move', (tx) => {
      tx.mutate((draft) => {
        draft.plants[0]!.position = { x: 44, y: 55 }
      })
    })).toBe(true)

    expect(store.persisted.plants[0]?.position).toEqual({ x: 44, y: 55 })
    expect(history.canUndo.value).toBe(true)
    expect(coordinator.undo()).toBe(true)
    expect(coordinator.undo()).toBe(false)
  })

  it('aborts an immediate edit when history rejects it before acceptance', () => {
    const history = new SceneHistory()
    const record = history.record.bind(history)
    vi.spyOn(history, 'record').mockImplementationOnce(() => {
      throw new Error('history rejected before acceptance')
    }).mockImplementation(record)
    const { coordinator, store } = createAdmissionHarness({ history })

    expect(() => coordinator.run('move', (tx) => {
      tx.mutate((draft) => {
        draft.plants[0]!.position = { x: 44, y: 55 }
      })
    })).toThrow('history rejected before acceptance')

    expect(store.persisted.plants[0]?.position).toEqual({ x: 10, y: 10 })
    expect(history.canUndo.value).toBe(false)
  })

  it('finishes an accepted immediate edit when history throws after acceptance', () => {
    const history = new SceneHistory()
    const record = history.record.bind(history)
    vi.spyOn(history, 'record').mockImplementationOnce((command, token) => {
      record(command, token)
      throw new Error('history publication failed after acceptance')
    }).mockImplementation(record)
    const { coordinator, store } = createAdmissionHarness({ history })

    expect(coordinator.run('move', (tx) => {
      tx.mutate((draft) => {
        draft.plants[0]!.position = { x: 44, y: 55 }
      })
    })).toBe(true)

    expect(store.persisted.plants[0]?.position).toEqual({ x: 44, y: 55 })
    expect(coordinator.undo()).toBe(true)
    expect(coordinator.undo()).toBe(false)
  })

  it('retries accepted history clean-state publication without duplicating the command', () => {
    let cleanStateFailures = 1
    let publishedClean = true
    let cleanStatePublications = 0
    const history = new SceneHistory({
      reportCleanState: (clean) => {
        cleanStatePublications += 1
        if (cleanStateFailures > 0) {
          cleanStateFailures -= 1
          throw new Error('history clean-state publication failed')
        }
        publishedClean = clean
      },
    })
    const { coordinator, store } = createAdmissionHarness({ history })

    expect(coordinator.run('move', (tx) => {
      tx.mutate((draft) => {
        draft.plants[0]!.position = { x: 44, y: 55 }
      })
    })).toBe(true)

    expect(store.persisted.plants[0]?.position).toEqual({ x: 44, y: 55 })
    expect(cleanStatePublications).toBe(2)
    expect(publishedClean).toBe(false)
    expect(coordinator.undo()).toBe(true)
    expect(coordinator.undo()).toBe(false)
  })

  it('keeps divergent history dirty after replacing the redo lineage', () => {
    const { coordinator, history } = createAdmissionHarness()
    expect(coordinator.run('move-a', (tx) => {
      tx.mutate((draft) => {
        draft.plants[0]!.position = { x: 44, y: 55 }
      })
    })).toBe(true)
    expect(coordinator.capturePersistence().acknowledgeSaved()).toBe('applied')
    expect(history.isClean).toBe(true)

    expect(coordinator.undo()).toBe(true)
    expect(coordinator.run('move-b', (tx) => {
      tx.mutate((draft) => {
        draft.plants[1]!.position = { x: 77, y: 88 }
      })
    })).toBe(true)

    expect(history.isClean).toBe(false)
    expect(coordinator.canRedo.value).toBe(false)
  })

  it('quarantines a distinct same-type edit while settling a retained immediate commit', () => {
    let invalidationFailures = 2
    const { coordinator, store, history } = createAdmissionHarness({
      invalidate: () => {
        if (invalidationFailures > 0) {
          invalidationFailures -= 1
          throw new Error('invalidation failed')
        }
      },
    })
    const firstEdit = vi.fn((tx: SceneEditTransaction) => {
      tx.mutate((draft) => {
        draft.plants[0]!.position = { x: 44, y: 55 }
      })
    })

    expect(() => coordinator.run('immediate-move', firstEdit)).toThrow('could not be settled')
    expect(firstEdit).toHaveBeenCalledTimes(1)
    expect(coordinator.canUndo.value).toBe(false)

    const nextEdit = vi.fn((tx: SceneEditTransaction) => {
      tx.mutate((draft) => {
        draft.plants[1]!.position = { x: 77, y: 88 }
      })
    })
    expect(coordinator.run('immediate-move', nextEdit)).toBe(false)
    expect(nextEdit).not.toHaveBeenCalled()
    expect(store.persisted.plants[0]?.position).toEqual({ x: 44, y: 55 })
    expect(history.canUndo.value).toBe(true)

    expect(coordinator.run('immediate-move', nextEdit)).toBe(true)
    expect(nextEdit).toHaveBeenCalledOnce()
    expect(store.persisted.plants[1]?.position).toEqual({ x: 77, y: 88 })
    expect(coordinator.undo()).toBe(true)
    expect(store.persisted.plants[1]?.position).toEqual({ x: 30, y: 30 })
    expect(store.persisted.plants[0]?.position).toEqual({ x: 44, y: 55 })
    expect(coordinator.undo()).toBe(true)
    expect(store.persisted.plants[0]?.position).toEqual({ x: 10, y: 10 })
    expect(coordinator.undo()).toBe(false)
  })

  it('runs the original committed continuation before releasing retained authority', () => {
    let invalidationFailures = 2
    let coordinator: SceneRuntimeEditCoordinator
    const continuationReentry = vi.fn()
    const onCommitted = vi.fn(() => {
      continuationReentry(coordinator.run('continuation-reentry', vi.fn()))
    })
    const harness = createAdmissionHarness({
      invalidate: () => {
        if (invalidationFailures > 0) {
          invalidationFailures -= 1
          throw new Error('invalidation failed')
        }
      },
    })
    coordinator = harness.coordinator

    expect(() => coordinator.run('retained-command', (tx) => {
      tx.mutate((draft) => {
        draft.plants[0]!.position = { x: 44, y: 55 }
      })
    }, { onCommitted })).toThrow('could not be settled')
    expect(onCommitted).not.toHaveBeenCalled()

    const distinctEdit = vi.fn()
    expect(coordinator.run('distinct-command', distinctEdit)).toBe(false)

    expect(onCommitted).toHaveBeenCalledOnce()
    expect(continuationReentry).toHaveBeenCalledWith(false)
    expect(distinctEdit).not.toHaveBeenCalled()
    expect(harness.store.persisted.plants[0]?.position).toEqual({ x: 44, y: 55 })
  })

  it('keeps projection synchronization inside retryable commit settlement', () => {
    let projectionFailures = 2
    let projectionCalls = 0
    const { coordinator, history } = createAdmissionHarness({
      syncCanvasSignalsFromScene: () => {
        projectionCalls += 1
        if (projectionFailures > 0) {
          projectionFailures -= 1
          throw new Error('projection sync failed')
        }
      },
    })

    expect(() => coordinator.run('projection-move', (tx) => {
      tx.mutate((draft) => {
        draft.plants[0]!.position = { x: 44, y: 55 }
      })
    })).toThrow('could not be settled')
    expect(history.canUndo.value).toBe(true)

    const duplicateEdit = vi.fn()
    expect(coordinator.run('projection-move', duplicateEdit)).toBe(false)
    expect(duplicateEdit).not.toHaveBeenCalled()
    expect(projectionCalls).toBe(3)
    expect(coordinator.undo()).toBe(true)
    expect(coordinator.undo()).toBe(false)
  })

  it('lets caller-shaped command admission settle an inaccessible immediate edit', () => {
    let projectionFailures = 2
    const { coordinator, history } = createAdmissionHarness({
      syncCanvasSignalsFromScene: () => {
        if (projectionFailures > 0) {
          projectionFailures -= 1
          throw new Error('projection sync failed')
        }
      },
    })
    expect(() => coordinator.run('projection-move', (tx) => {
      tx.mutate((draft) => {
        draft.plants[0]!.position = { x: 44, y: 55 }
      })
    })).toThrow('could not be settled')

    const read = vi.fn(() => 'read')
    expect(coordinator.runWhenSettled(read, 'busy')).toBe('busy')
    expect(read).not.toHaveBeenCalled()
    expect(coordinator.canUndo.value).toBe(false)

    const nextCommand = vi.fn(() => 'next')
    expect(coordinator.runWhenSettled(
      nextCommand,
      'busy',
      { resumePending: true },
    )).toBe('busy')
    expect(nextCommand).not.toHaveBeenCalled()
    expect(history.canUndo.value).toBe(true)
    expect(coordinator.canUndo.value).toBe(true)
  })

  it('keeps settled reads observational when an immediate edit needs recovery', () => {
    let projectionFailures = 2
    let projectionCalls = 0
    const { coordinator } = createAdmissionHarness({
      syncCanvasSignalsFromScene: () => {
        projectionCalls += 1
        if (projectionFailures > 0) {
          projectionFailures -= 1
          throw new Error('projection sync failed')
        }
      },
    })
    expect(() => coordinator.run('projection-move', (tx) => {
      tx.mutate((draft) => {
        draft.plants[0]!.position = { x: 44, y: 55 }
      })
    })).toThrow('could not be settled')
    const callsBeforeRead = projectionCalls
    const read = vi.fn(() => 'read')

    expect(coordinator.readWhenSettled(read, 'busy')).toBe('busy')

    expect(read).not.toHaveBeenCalled()
    expect(projectionCalls).toBe(callsBeforeRead)
    expect(coordinator.runWhenSettled(
      () => 'command',
      'busy',
      { resumePending: true },
    )).toBe('busy')
    expect(projectionCalls).toBeGreaterThan(callsBeforeRead)
  })

  it('keeps projection synchronization inside retryable abort settlement', () => {
    let projectionFailures = 2
    let projectionCalls = 0
    const { coordinator, store, history } = createAdmissionHarness({
      syncCanvasSignalsFromScene: () => {
        projectionCalls += 1
        if (projectionFailures > 0) {
          projectionFailures -= 1
          throw new Error('projection sync failed')
        }
      },
    })

    expect(() => coordinator.run('projection-abort', (tx) => {
      tx.mutate((draft) => {
        draft.plants[0]!.position = { x: 44, y: 55 }
      })
      throw new Error('edit failed')
    })).toThrow('could not be settled')
    expect(store.persisted.plants[0]?.position).toEqual({ x: 10, y: 10 })

    const duplicateEdit = vi.fn()
    expect(() => coordinator.run('projection-abort', duplicateEdit)).toThrow('edit failed')
    expect(duplicateEdit).not.toHaveBeenCalled()
    expect(projectionCalls).toBe(3)
    expect(history.canUndo.value).toBe(false)
  })

  it('retries a once-failed immediate abort before reporting the edit error', () => {
    let selectionRestoreFailures = 1
    const { coordinator, store } = createAdmissionHarness({
      setSelection: (ids) => {
        const next = new Set(ids)
        if (next.has('plant-1') && selectionRestoreFailures > 0) {
          selectionRestoreFailures -= 1
          throw new Error('selection restore failed')
        }
        store.setSelection(next)
      },
    })
    store.setSelection(['plant-1'])

    expect(() => coordinator.run('failing-immediate', (tx) => {
      tx.mutate((draft) => {
        draft.plants[0]!.position = { x: 44, y: 55 }
      })
      tx.setSelection(['plant-2'])
      throw new Error('edit failed')
    })).toThrow('edit failed')

    expect(store.persisted.plants[0]?.position).toEqual({ x: 10, y: 10 })
    expect(store.session.selectedEntityIds).toEqual(new Set(['plant-1']))
    expect(coordinator.run('after-abort', (tx) => {
      tx.mutate((draft) => {
        draft.plants[1]!.position = { x: 31, y: 32 }
      })
    })).toBe(true)
  })

  it('keeps a twice-failed immediate abort reachable without rerunning the failed edit', () => {
    let selectionRestoreFailures = 2
    const { coordinator, store } = createAdmissionHarness({
      setSelection: (ids) => {
        const next = new Set(ids)
        if (next.has('plant-1') && selectionRestoreFailures > 0) {
          selectionRestoreFailures -= 1
          throw new Error('selection restore failed')
        }
        store.setSelection(next)
      },
    })
    store.setSelection(['plant-1'])
    const failedEdit = vi.fn((tx: SceneEditTransaction) => {
      tx.mutate((draft) => {
        draft.plants[0]!.position = { x: 44, y: 55 }
      })
      tx.setSelection(['plant-2'])
      throw new Error('edit failed')
    })

    expect(() => coordinator.run('failing-immediate', failedEdit)).toThrow('could not be settled')
    expect(failedEdit).toHaveBeenCalledTimes(1)
    const quarantinedEdit = vi.fn()
    expect(() => coordinator.run('blocked-during-abort', quarantinedEdit)).toThrow('edit failed')
    expect(quarantinedEdit).not.toHaveBeenCalled()
    expect(store.persisted.plants[0]?.position).toEqual({ x: 10, y: 10 })
    expect(store.session.selectedEntityIds).toEqual(new Set(['plant-1']))
    expect(coordinator.run('after-abort', (tx) => {
      tx.mutate((draft) => {
        draft.plants[1]!.position = { x: 31, y: 32 }
      })
    })).toBe(true)
  })

  it('forgets an immediate failure whose callback already aborted its transaction', () => {
    const { coordinator } = createAdmissionHarness()

    expect(() => coordinator.run('self-aborted-command', (tx) => {
      tx.abort()
      throw new Error('command failed after abort')
    })).toThrow('command failed after abort')

    const active = coordinator.begin('interaction-drag')
    const blocked = vi.fn()
    expect(coordinator.runWhenSettled(
      blocked,
      'busy',
      { resumePending: true },
    )).toBe('busy')
    expect(blocked).not.toHaveBeenCalled()
    active.abort()
  })

  it('quarantines a partially applied undo and redo until selection replay succeeds', () => {
    let selectionFailures = 0
    const { coordinator, store } = createAdmissionHarness({
      setSelection: (ids) => {
        if (selectionFailures > 0) {
          selectionFailures -= 1
          throw new Error('selection replay failed')
        }
        store.setSelection(ids)
      },
    })
    expect(coordinator.run('move-and-select', (tx) => {
      tx.mutate((draft) => {
        draft.plants[0]!.position = { x: 44, y: 55 }
      })
      tx.setSelection(['plant-2'])
    })).toBe(true)

    selectionFailures = 1
    expect(() => coordinator.undo()).toThrow('selection replay failed')
    const blockedUndo = vi.fn()
    expect(coordinator.run('blocked-during-undo', blockedUndo)).toBe(false)
    expect(blockedUndo).not.toHaveBeenCalled()
    expect(coordinator.undo()).toBe(true)
    expect(store.persisted.plants[0]?.position).toEqual({ x: 10, y: 10 })
    expect(store.session.selectedEntityIds).toEqual(new Set())

    selectionFailures = 1
    expect(() => coordinator.redo()).toThrow('selection replay failed')
    const blockedRedo = vi.fn()
    expect(coordinator.run('blocked-during-redo', blockedRedo)).toBe(false)
    expect(blockedRedo).not.toHaveBeenCalled()
    expect(coordinator.redo()).toBe(true)
    expect(store.persisted.plants[0]?.position).toEqual({ x: 44, y: 55 })
    expect(store.session.selectedEntityIds).toEqual(new Set(['plant-2']))
  })

  it('quarantines history after cursor movement until undo and redo publication succeeds', () => {
    let invalidationFailures = 0
    const { coordinator, store } = createAdmissionHarness({
      invalidate: () => {
        if (invalidationFailures > 0) {
          invalidationFailures -= 1
          throw new Error('history invalidation failed')
        }
      },
    })
    expect(coordinator.run('move', (tx) => {
      tx.mutate((draft) => {
        draft.plants[0]!.position = { x: 44, y: 55 }
      })
    })).toBe(true)

    invalidationFailures = 1
    expect(() => coordinator.undo()).toThrow('history invalidation failed')
    const blockedUndo = vi.fn()
    expect(coordinator.run('blocked-during-undo', blockedUndo)).toBe(false)
    expect(blockedUndo).not.toHaveBeenCalled()
    expect(coordinator.undo()).toBe(true)
    expect(store.persisted.plants[0]?.position).toEqual({ x: 10, y: 10 })
    expect(coordinator.undo()).toBe(false)

    invalidationFailures = 1
    expect(() => coordinator.redo()).toThrow('history invalidation failed')
    const blockedRedo = vi.fn()
    expect(coordinator.run('blocked-during-redo', blockedRedo)).toBe(false)
    expect(blockedRedo).not.toHaveBeenCalled()
    expect(coordinator.redo()).toBe(true)
    expect(store.persisted.plants[0]?.position).toEqual({ x: 44, y: 55 })
    expect(coordinator.redo()).toBe(false)
  })

  it('retries the same history cursor after clean-state publication fails', () => {
    let cleanStateFailures = 0
    const history = new SceneHistory({
      reportCleanState: () => {
        if (cleanStateFailures > 0) {
          cleanStateFailures -= 1
          throw new Error('history clean-state publication failed')
        }
      },
    })
    const { coordinator, store } = createAdmissionHarness({ history })
    expect(coordinator.run('move', (tx) => {
      tx.mutate((draft) => {
        draft.plants[0]!.position = { x: 44, y: 55 }
      })
    })).toBe(true)
    cleanStateFailures = 1

    expect(() => coordinator.undo()).toThrow('history clean-state publication failed')
    const blocked = vi.fn()
    expect(coordinator.run('blocked-during-history-publication', blocked)).toBe(false)
    expect(blocked).not.toHaveBeenCalled()

    expect(coordinator.undo()).toBe(true)
    expect(store.persisted.plants[0]?.position).toEqual({ x: 10, y: 10 })
    expect(coordinator.undo()).toBe(false)
    expect(coordinator.redo()).toBe(true)
    expect(store.persisted.plants[0]?.position).toEqual({ x: 44, y: 55 })
  })

  it('does not reenter the same history settlement from a revision observer', () => {
    let coordinator: SceneRuntimeEditCoordinator
    let revisionCount = 0
    let reenterUndo = false
    let reenteredResult: boolean | null = null
    const harness = createAdmissionHarness({
      incrementSceneRevision: () => {
        revisionCount += 1
        if (!reenterUndo) return
        reenterUndo = false
        reenteredResult = coordinator.undo()
      },
    })
    coordinator = harness.coordinator
    expect(coordinator.run('move', (tx) => {
      tx.mutate((draft) => {
        draft.plants[0]!.position = { x: 44, y: 55 }
      })
    })).toBe(true)

    reenterUndo = true
    expect(coordinator.undo()).toBe(true)

    expect(reenteredResult).toBe(false)
    expect(revisionCount).toBe(2)
    expect(harness.store.persisted.plants[0]?.position).toEqual({ x: 10, y: 10 })
    expect(coordinator.undo()).toBe(false)
  })

  it('does not reenter a retained immediate settlement from its own publication callback', () => {
    let coordinator: SceneRuntimeEditCoordinator
    let invalidationFailures = 2
    let invalidationCalls = 0
    let reenterSettlement = false
    const harness = createAdmissionHarness({
      invalidate: () => {
        invalidationCalls += 1
        if (reenterSettlement) {
          reenterSettlement = false
          coordinator.runWhenSettled(() => undefined, undefined, { resumePending: true })
        }
        if (invalidationFailures > 0) {
          invalidationFailures -= 1
          throw new Error('invalidation failed')
        }
      },
    })
    coordinator = harness.coordinator
    expect(() => coordinator.run('move', (tx) => {
      tx.mutate((draft) => {
        draft.plants[0]!.position = { x: 44, y: 55 }
      })
    })).toThrow('could not be settled')

    reenterSettlement = true
    expect(coordinator.runWhenSettled(
      () => undefined,
      undefined,
      { resumePending: true },
    )).toBeUndefined()

    expect(invalidationCalls).toBe(3)
    expect(coordinator.canUndo.value).toBe(true)
  })

  it('does not reenter the initial recovery of a retained immediate settlement', () => {
    let coordinator: SceneRuntimeEditCoordinator
    let invalidationCalls = 0
    let reenteredResult: boolean | null = null
    const reenteredEdit = vi.fn()
    const harness = createAdmissionHarness({
      invalidate: () => {
        invalidationCalls += 1
        if (invalidationCalls === 2) {
          reenteredResult = coordinator.run('move', reenteredEdit)
        }
        if (invalidationCalls <= 2) throw new Error('invalidation failed')
      },
    })
    coordinator = harness.coordinator

    expect(() => coordinator.run('move', (tx) => {
      tx.mutate((draft) => {
        draft.plants[0]!.position = { x: 44, y: 55 }
      })
    })).toThrow('could not be settled')

    expect(reenteredResult).toBe(false)
    expect(reenteredEdit).not.toHaveBeenCalled()
    expect(coordinator.run('move', reenteredEdit)).toBe(false)
    expect(reenteredEdit).not.toHaveBeenCalled()
    expect(coordinator.run('move', reenteredEdit)).toBe(false)
    expect(reenteredEdit).toHaveBeenCalledOnce()
  })

  it('publishes one Scene revision when an observer throws after the signal changes', () => {
    const revision = signal(0)
    let throwFromObserver = false
    const dispose = effect(() => {
      void revision.value
      if (!throwFromObserver) return
      throwFromObserver = false
      throw new Error('revision observer failed')
    })
    const { coordinator } = createAdmissionHarness({
      incrementSceneRevision: () => {
        revision.value += 1
      },
    })
    throwFromObserver = true

    expect(coordinator.run('move', (tx) => {
      tx.mutate((draft) => {
        draft.plants[0]!.position = { x: 44, y: 55 }
      })
    })).toBe(true)

    expect(revision.value).toBe(1)
    dispose()
  })

  it('publishes one history revision when an observer throws after the signal changes', () => {
    const revision = signal(0)
    let throwFromObserver = false
    const dispose = effect(() => {
      void revision.value
      if (!throwFromObserver) return
      throwFromObserver = false
      throw new Error('history revision observer failed')
    })
    const { coordinator } = createAdmissionHarness({
      incrementSceneRevision: () => {
        revision.value += 1
      },
    })
    expect(coordinator.run('move', (tx) => {
      tx.mutate((draft) => {
        draft.plants[0]!.position = { x: 44, y: 55 }
      })
    })).toBe(true)
    throwFromObserver = true

    expect(() => coordinator.undo()).toThrow('history revision observer failed')
    expect(coordinator.undo()).toBe(true)

    expect(revision.value).toBe(2)
    dispose()
  })
})

const appleBackfill = [{
  plantId: 'plant-1',
  canonicalName: 'Malus domestica',
  stratum: 'canopy',
  canopySpreadM: 4,
  scale: 4,
}] as const

describe('Settled Scene presentation maintenance', () => {
  it('drains a fresh backfill enqueued by a committed continuation before release', () => {
    const { coordinator, store } = createAdmissionHarness()
    const onCommitted = vi.fn(() => {
      const ticket = coordinator.issueTicket()
      expect(coordinator.applyBackfills(ticket, appleBackfill)).toBe('deferred')
    })

    expect(coordinator.run('move-with-late-backfill', (tx) => {
      tx.mutate((draft) => {
        draft.plants[1]!.position = { x: 31, y: 32 }
      })
    }, { onCommitted })).toBe(true)

    expect(onCommitted).toHaveBeenCalledOnce()
    expect(store.persisted.plants[0]).toMatchObject({
      stratum: 'canopy',
      canopySpreadM: 4,
      scale: 4,
    })
    const admitted = vi.fn()
    coordinator.runWhenSettled(admitted, undefined)
    expect(admitted).toHaveBeenCalledOnce()
  })

  it('drains a fresh backfill enqueued by a replacement finalizer before release', () => {
    const { coordinator, store } = createAdmissionHarness()
    const next = makeFile()
    next.name = 'Replacement with late backfill'
    const finalizeReplacement = vi.fn(() => {
      const ticket = coordinator.issueTicket()
      expect(coordinator.applyBackfills(ticket, appleBackfill)).toBe('deferred')
    })

    coordinator.replaceDocument(next, {
      token: createCanvasDocumentReplacementToken(),
      prepare: () => {},
      finalizeReplacement,
    })

    expect(finalizeReplacement).toHaveBeenCalledOnce()
    expect(store.persisted.plants[0]).toMatchObject({
      stratum: 'canopy',
      canopySpreadM: 4,
      scale: 4,
    })
    const admitted = vi.fn()
    coordinator.runWhenSettled(admitted, undefined)
    expect(admitted).toHaveBeenCalledOnce()
  })

  it('retries post-continuation backfill publication without repeating the continuation', () => {
    let invalidationCalls = 0
    const { coordinator, store } = createAdmissionHarness({
      invalidate: () => {
        invalidationCalls += 1
        if (invalidationCalls === 2) throw new Error('late backfill publication failed')
      },
    })
    const onCommitted = vi.fn(() => {
      const ticket = coordinator.issueTicket()
      expect(coordinator.applyBackfills(ticket, appleBackfill)).toBe('deferred')
    })
    const active = coordinator.begin('gesture-with-late-backfill', { onCommitted })
    active.mutate((draft) => {
      draft.plants[1]!.position = { x: 31, y: 32 }
    })

    expect(() => active.commit()).toThrow('late backfill publication failed')
    expect(onCommitted).toHaveBeenCalledOnce()
    expect(coordinator.canUndo.value).toBe(false)

    active.abort()

    expect(onCommitted).toHaveBeenCalledOnce()
    expect(store.persisted.plants[0]).toMatchObject({
      stratum: 'canopy',
      canopySpreadM: 4,
      scale: 4,
    })
    expect(coordinator.canUndo.value).toBe(true)
  })

  it('defers backfills during an edit and applies them after abort restores committed content', () => {
    const { coordinator, store } = createAdmissionHarness()
    const ticket = coordinator.issueTicket()
    const active = coordinator.begin('interaction-drag')
    active.mutate((draft) => {
      draft.plants[0]!.position = { x: 99, y: 99 }
    })

    expect(coordinator.applyBackfills(ticket, appleBackfill)).toBe('deferred')
    expect(store.persisted.plants[0]).toMatchObject({
      position: { x: 99, y: 99 },
      stratum: null,
    })

    active.abort()

    expect(store.persisted.plants[0]).toMatchObject({
      position: { x: 10, y: 10 },
      stratum: 'canopy',
      canopySpreadM: 4,
      scale: 4,
    })
    expect(coordinator.canUndo.value).toBe(false)
  })

  it('drops deferred backfills when the edit commits newer content', () => {
    const { coordinator, store } = createAdmissionHarness()
    const ticket = coordinator.issueTicket()
    const active = coordinator.begin('interaction-drag')
    active.mutate((draft) => {
      draft.plants[0]!.position = { x: 99, y: 99 }
    })

    expect(coordinator.applyBackfills(ticket, appleBackfill)).toBe('deferred')
    expect(active.commit()).toBe(true)
    expect(store.persisted.plants[0]).toMatchObject({
      position: { x: 99, y: 99 },
      stratum: null,
    })

    expect(coordinator.undo()).toBe(true)
    expect(store.persisted.plants[0]).toMatchObject({
      position: { x: 10, y: 10 },
      stratum: null,
    })
  })

  it('rejects a backfill whose identity differs from its ticket-time Plant', () => {
    const { coordinator, store } = createAdmissionHarness()
    const ticket = coordinator.issueTicket()
    const active = coordinator.begin('preview-species-change')
    active.mutate((draft) => {
      draft.plants[0]!.canonicalName = 'Pyrus communis'
    })

    expect(coordinator.applyBackfills(ticket, [{
      ...appleBackfill[0],
      canonicalName: 'Pyrus communis',
    }])).toBe('stale')

    active.abort()

    expect(store.persisted.plants[0]).toMatchObject({
      canonicalName: 'Malus domestica',
      stratum: null,
      canopySpreadM: null,
    })
  })

  it('does not let a preview identity reserve lineage ahead of a valid sibling', () => {
    const { coordinator, store } = createAdmissionHarness()
    const previewTicket = coordinator.issueTicket()
    const validTicket = coordinator.issueTicket()
    const active = coordinator.begin('preview-species-change')
    active.mutate((draft) => {
      draft.plants[0]!.canonicalName = 'Pyrus communis'
    })

    expect(coordinator.applyBackfills(previewTicket, [{
      ...appleBackfill[0],
      canonicalName: 'Pyrus communis',
    }])).toBe('stale')
    expect(coordinator.applyBackfills(validTicket, appleBackfill)).toBe('deferred')

    active.abort()

    expect(store.persisted.plants[0]).toMatchObject({
      canonicalName: 'Malus domestica',
      stratum: 'canopy',
      canopySpreadM: 4,
      scale: 4,
    })
  })

  it('keeps valid committed and preview-identity reservations separate', () => {
    const { coordinator, store } = createAdmissionHarness()
    const committedTicket = coordinator.issueTicket()
    const active = coordinator.begin('preview-species-change')
    active.mutate((draft) => {
      draft.plants[0]!.canonicalName = 'Pyrus communis'
    })
    const previewTicket = coordinator.issueTicket()

    expect(coordinator.applyBackfills(previewTicket, [{
      ...appleBackfill[0],
      canonicalName: 'Pyrus communis',
    }])).toBe('deferred')
    expect(coordinator.applyBackfills(committedTicket, appleBackfill)).toBe('deferred')

    active.abort()

    expect(store.persisted.plants[0]).toMatchObject({
      canonicalName: 'Malus domestica',
      stratum: 'canopy',
      canopySpreadM: 4,
      scale: 4,
    })
  })

  it('invalidates old presentation tickets when a new document hydrates', () => {
    const { coordinator, store } = createAdmissionHarness()
    const ticket = coordinator.issueTicket()
    const next = makeFile()
    next.plants[0]!.position = { x: 55, y: 66 }

    coordinator.hydrate(next)

    expect(coordinator.applyBackfills(ticket, appleBackfill)).toBe('stale')
    expect(store.persisted.plants[0]).toMatchObject({
      position: { x: 55, y: 66 },
      stratum: null,
    })
  })

  it('preserves newer presentation maintenance across undo and redo patches', () => {
    const { coordinator, store } = createAdmissionHarness()
    expect(coordinator.run('move', (tx) => {
      tx.mutate((draft) => {
        draft.plants[0]!.position = { x: 44, y: 55 }
      })
    })).toBe(true)
    const ticket = coordinator.issueTicket()
    expect(coordinator.applyBackfills(ticket, appleBackfill)).toBe('applied')

    expect(coordinator.undo()).toBe(true)
    expect(store.persisted.plants[0]).toMatchObject({
      position: { x: 10, y: 10 },
      stratum: 'canopy',
      canopySpreadM: 4,
      scale: 4,
    })

    expect(coordinator.redo()).toBe(true)
    expect(store.persisted.plants[0]).toMatchObject({
      position: { x: 44, y: 55 },
      stratum: 'canopy',
      canopySpreadM: 4,
      scale: 4,
    })
  })

  it('preserves maintained presentation when history removes and restores a Plant', () => {
    const { coordinator, store } = createAdmissionHarness()
    expect(coordinator.run('create-plant', (tx) => {
      tx.mutate((draft) => {
        draft.plants.push({
          ...draft.plants[0]!,
          id: 'plant-3',
          stratum: null,
          canopySpreadM: null,
          scale: null,
        })
      })
    })).toBe(true)
    const ticket = coordinator.issueTicket()
    expect(coordinator.applyBackfills(ticket, [{
      ...appleBackfill[0],
      plantId: 'plant-3',
    }])).toBe('applied')

    expect(coordinator.undo()).toBe(true)
    expect(store.persisted.plants.some((plant) => plant.id === 'plant-3')).toBe(false)

    expect(coordinator.redo()).toBe(true)
    expect(store.persisted.plants.find((plant) => plant.id === 'plant-3')).toMatchObject({
      stratum: 'canopy',
      canopySpreadM: 4,
      scale: 4,
    })
  })

  it('allows sibling tickets from one content revision to backfill disjoint plants', () => {
    const { coordinator, store } = createAdmissionHarness()
    const appleTicket = coordinator.issueTicket()
    const pearTicket = coordinator.issueTicket()

    expect(coordinator.applyBackfills(appleTicket, appleBackfill)).toBe('applied')
    expect(coordinator.applyBackfills(pearTicket, [{
      plantId: 'plant-2',
      canonicalName: 'Pyrus communis',
      stratum: 'understory',
      canopySpreadM: 2,
      scale: 2,
    }])).toBe('applied')

    expect(store.persisted.plants[0]).toMatchObject({ stratum: 'canopy', canopySpreadM: 4 })
    expect(store.persisted.plants[1]).toMatchObject({ stratum: 'understory', canopySpreadM: 2 })
  })

  it('rejects an overlapping sibling ticket after another ticket updates that Plant', () => {
    const { coordinator, store } = createAdmissionHarness()
    const firstTicket = coordinator.issueTicket()
    const overlappingTicket = coordinator.issueTicket()

    expect(coordinator.applyBackfills(firstTicket, appleBackfill)).toBe('applied')
    expect(coordinator.applyBackfills(overlappingTicket, [{
      ...appleBackfill[0],
      canopySpreadM: 2,
      scale: 2,
    }])).toBe('stale')

    expect(store.persisted.plants[0]).toMatchObject({
      stratum: 'canopy',
      canopySpreadM: 4,
      scale: 4,
    })
  })

  it('keeps the first deferred backfill reservation for a Plant', () => {
    const { coordinator, store } = createAdmissionHarness()
    const firstTicket = coordinator.issueTicket()
    const overlappingTicket = coordinator.issueTicket()
    const active = coordinator.begin('preview')

    expect(coordinator.applyBackfills(firstTicket, appleBackfill)).toBe('deferred')
    expect(coordinator.applyBackfills(overlappingTicket, [{
      ...appleBackfill[0],
      canopySpreadM: 2,
      scale: 2,
    }])).toBe('stale')
    active.abort()

    expect(store.persisted.plants[0]).toMatchObject({
      canopySpreadM: 4,
      scale: 4,
    })
  })

  it('does not admit settled work while a backfill publishes Scene revision', () => {
    const sceneRevision = signal(0)
    let coordinator: SceneRuntimeEditCoordinator | undefined
    const settledRead = vi.fn()
    const dispose = effect(() => {
      void sceneRevision.value
      coordinator?.runWhenSettled(settledRead, undefined)
    })
    coordinator = createAdmissionHarness({
      incrementSceneRevision: () => {
        sceneRevision.value += 1
      },
    }).coordinator
    const ticket = coordinator.issueTicket()

    expect(coordinator.applyBackfills(ticket, appleBackfill)).toBe('applied')
    expect(sceneRevision.value).toBe(1)
    expect(settledRead).not.toHaveBeenCalled()
    coordinator.runWhenSettled(settledRead, undefined)
    expect(settledRead).toHaveBeenCalledOnce()
    dispose()
  })

  it('reactively republishes settled reads after backfill publication', () => {
    const sceneRevision = signal(0)
    let coordinator: SceneRuntimeEditCoordinator | undefined
    const observations: Array<readonly string[] | null> = []
    const dispose = effect(() => {
      void sceneRevision.value
      void coordinator?.revision.value
      if (!coordinator) return
      observations.push(coordinator.runWhenSettled(
        () => ['settled'] as const,
        null,
      ))
    })
    coordinator = createAdmissionHarness({
      incrementSceneRevision: () => {
        sceneRevision.value += 1
      },
    }).coordinator
    const ticket = coordinator.issueTicket()

    expect(coordinator.applyBackfills(ticket, appleBackfill)).toBe('applied')

    expect(observations).toContain(null)
    expect(observations.at(-1)).toEqual(['settled'])
    dispose()
  })

  it('reports history unavailable while a backfill publishes', () => {
    let coordinator: SceneRuntimeEditCoordinator
    let inspectPublication = false
    let canUndoDuringPublication: boolean | null = null
    const harness = createAdmissionHarness({
      incrementSceneRevision: () => {
        if (inspectPublication) canUndoDuringPublication = coordinator.canUndo.value
      },
    })
    coordinator = harness.coordinator
    expect(coordinator.run('move', (tx) => {
      tx.mutate((draft) => {
        draft.plants[0]!.position = { x: 44, y: 55 }
      })
    })).toBe(true)
    const ticket = coordinator.issueTicket()
    inspectPublication = true

    expect(coordinator.applyBackfills(ticket, appleBackfill)).toBe('applied')

    expect(canUndoDuringPublication).toBe(false)
    expect(coordinator.canUndo.value).toBe(true)
  })

  it('does not admit Scene commands from a backfill publication callback', () => {
    let coordinator: SceneRuntimeEditCoordinator
    const reentrantEdit = vi.fn()
    let reentrantResult: boolean | null = null
    const harness = createAdmissionHarness({
      incrementSceneRevision: () => {
        reentrantResult = coordinator.run('reentrant-backfill-edit', reentrantEdit)
      },
    })
    coordinator = harness.coordinator
    const ticket = coordinator.issueTicket()

    expect(coordinator.applyBackfills(ticket, appleBackfill)).toBe('applied')
    expect(reentrantResult).toBe(false)
    expect(reentrantEdit).not.toHaveBeenCalled()

    expect(coordinator.run('after-backfill-publication', (tx) => {
      tx.mutate((draft) => {
        draft.plants[1]!.position = { x: 31, y: 32 }
      })
    })).toBe(true)
  })

  it('publishes one backfill revision when a revision observer throws', () => {
    const revision = signal(0)
    let throwFromObserver = false
    const dispose = effect(() => {
      void revision.value
      if (!throwFromObserver) return
      throwFromObserver = false
      throw new Error('backfill revision observer failed')
    })
    const { coordinator } = createAdmissionHarness({
      incrementSceneRevision: () => {
        revision.value += 1
      },
    })
    const ticket = coordinator.issueTicket()
    throwFromObserver = true

    expect(() => coordinator.applyBackfills(ticket, appleBackfill)).toThrow(
      'backfill revision observer failed',
    )
    const admittedAfterPublication = vi.fn()
    expect(coordinator.run('flush-backfill-publication', admittedAfterPublication)).toBe(false)
    expect(admittedAfterPublication).toHaveBeenCalledOnce()
    expect(revision.value).toBe(1)
    dispose()
  })

  it('keeps history unavailable while backfill publication remains pending', () => {
    let failBackfillInvalidation = false
    const { coordinator } = createAdmissionHarness({
      invalidate: () => {
        if (!failBackfillInvalidation) return
        failBackfillInvalidation = false
        throw new Error('backfill invalidation failed')
      },
    })
    expect(coordinator.run('seed-history', (tx) => {
      tx.mutate((draft) => {
        draft.plants[1]!.position = { x: 31, y: 32 }
      })
    })).toBe(true)
    const ticket = coordinator.issueTicket()
    failBackfillInvalidation = true

    expect(() => coordinator.applyBackfills(ticket, appleBackfill))
      .toThrow('backfill invalidation failed')

    expect(coordinator.canUndo.value).toBe(false)
    const admittedAfterPublication = vi.fn()
    expect(coordinator.run('flush-backfill-publication', admittedAfterPublication)).toBe(false)
    expect(admittedAfterPublication).toHaveBeenCalledOnce()
    expect(coordinator.canUndo.value).toBe(true)
  })

  it('settles and quarantines pending backfill publication before replacing on retry', () => {
    let invalidationFailures = 1
    const { coordinator, store } = createAdmissionHarness({
      invalidate: () => {
        if (invalidationFailures > 0) {
          invalidationFailures -= 1
          throw new Error('backfill invalidation failed')
        }
      },
    })
    const ticket = coordinator.issueTicket()
    expect(() => coordinator.applyBackfills(ticket, appleBackfill))
      .toThrow('backfill invalidation failed')
    const next = makeFile()
    next.name = 'After retained backfill publication'
    next.plants[0]!.position = { x: 77, y: 88 }
    const prepare = vi.fn()
    const replacementToken = createCanvasDocumentReplacementToken()

    expect(() => coordinator.replaceDocument(next, { token: replacementToken, prepare }))
      .toThrowError(SceneEditBusyError)
    expect(prepare).not.toHaveBeenCalled()
    expect(store.persisted.plants[0]).toMatchObject({
      stratum: 'canopy',
      canopySpreadM: 4,
      scale: 4,
    })

    coordinator.replaceDocument(next, { token: replacementToken, prepare })
    expect(prepare).toHaveBeenCalledOnce()
    expect(store.persisted.plants[0]?.position).toEqual({ x: 77, y: 88 })
  })

  it('drains backfills that arrive after content acceptance before releasing a retried commit', () => {
    let coordinator: SceneRuntimeEditCoordinator
    let invalidationAttempts = 0
    const harness = createAdmissionHarness({
      invalidate: () => {
        invalidationAttempts += 1
        if (invalidationAttempts !== 1) return
        const ticket = coordinator.issueTicket()
        expect(coordinator.applyBackfills(ticket, appleBackfill)).toBe('deferred')
        throw new Error('late commit publication failed')
      },
    })
    coordinator = harness.coordinator
    const active = coordinator.begin('move')
    active.mutate((draft) => {
      draft.plants[1]!.position = { x: 31, y: 32 }
    })

    expect(() => active.commit()).toThrow('late commit publication failed')
    expect(harness.store.persisted.plants[0]?.stratum).toBeNull()

    expect(active.commit()).toBe(true)
    expect(harness.store.persisted.plants[0]).toMatchObject({
      stratum: 'canopy',
      canopySpreadM: 4,
      scale: 4,
    })
    const admittedAfterSettlement = vi.fn()
    expect(coordinator.run('after-settlement', admittedAfterSettlement)).toBe(false)
    expect(admittedAfterSettlement).toHaveBeenCalledOnce()
  })

  it('drains a current backfill before releasing a retried history replay', () => {
    let coordinator: SceneRuntimeEditCoordinator
    let invalidationAttempts = 0
    const harness = createAdmissionHarness({
      invalidate: () => {
        invalidationAttempts += 1
        if (invalidationAttempts !== 2) return
        const ticket = coordinator.issueTicket()
        expect(coordinator.applyBackfills(ticket, appleBackfill)).toBe('deferred')
        throw new Error('late history publication failed')
      },
    })
    coordinator = harness.coordinator
    expect(coordinator.run('move-pear', (tx) => {
      tx.mutate((draft) => {
        draft.plants[1]!.position = { x: 31, y: 32 }
      })
    })).toBe(true)

    expect(() => coordinator.undo()).toThrow('late history publication failed')
    expect(harness.store.persisted.plants[0]?.stratum).toBeNull()

    expect(coordinator.undo()).toBe(true)
    expect(harness.store.persisted.plants[0]).toMatchObject({
      stratum: 'canopy',
      canopySpreadM: 4,
      scale: 4,
    })
    const admittedAfterSettlement = vi.fn()
    expect(coordinator.run('after-history-settlement', admittedAfterSettlement)).toBe(false)
    expect(admittedAfterSettlement).toHaveBeenCalledOnce()
  })

  it('drains a current backfill that arrives while another deferred backfill publishes', () => {
    let coordinator: SceneRuntimeEditCoordinator
    let enqueuePear = true
    const pearBackfill = [{
      plantId: 'plant-2',
      canonicalName: 'Pyrus communis',
      stratum: 'understory',
      canopySpreadM: 2,
      scale: 2,
    }] as const
    const harness = createAdmissionHarness({
      invalidate: () => {
        if (!enqueuePear) return
        enqueuePear = false
        const pearTicket = coordinator.issueTicket()
        expect(coordinator.applyBackfills(pearTicket, pearBackfill)).toBe('deferred')
      },
    })
    coordinator = harness.coordinator
    const appleTicket = coordinator.issueTicket()
    const active = coordinator.begin('preview')
    expect(coordinator.applyBackfills(appleTicket, appleBackfill)).toBe('deferred')

    active.abort()

    expect(harness.store.persisted.plants[0]).toMatchObject({ stratum: 'canopy' })
    expect(harness.store.persisted.plants[1]).toMatchObject({ stratum: 'understory' })
  })

  it('retains admission until deferred-backfill publication succeeds without duplicate revision', () => {
    let sceneRevision = 0
    let invalidationFailures = 1
    let invalidations = 0
    const { coordinator } = createAdmissionHarness({
      incrementSceneRevision: () => {
        sceneRevision += 1
      },
      invalidate: () => {
        invalidations += 1
        if (invalidationFailures > 0) {
          invalidationFailures -= 1
          throw new Error('backfill invalidation failed')
        }
      },
    })
    const ticket = coordinator.issueTicket()
    const active = coordinator.begin('interaction-drag')

    expect(coordinator.applyBackfills(ticket, appleBackfill)).toBe('deferred')
    expect(() => active.abort()).toThrow('backfill invalidation failed')
    expect(sceneRevision).toBe(1)
    expect(coordinator.run('blocked-during-backfill-publication', vi.fn())).toBe(false)

    active.abort()

    expect(sceneRevision).toBe(1)
    expect(invalidations).toBe(2)
    expect(coordinator.run('after-backfill-publication', (tx) => {
      tx.mutate((draft) => {
        draft.plants[1]!.position = { x: 31, y: 32 }
      })
    })).toBe(true)
  })

  it('invalidates old tickets immediately and quarantines a hydrated Scene until history clears', () => {
    let cleanStateFailures = 0
    const history = new SceneHistory({
      reportCleanState: () => {
        if (cleanStateFailures > 0) {
          cleanStateFailures -= 1
          throw new Error('clean-state publication failed')
        }
      },
    })
    const { coordinator, store } = createAdmissionHarness({ history })
    const ticket = coordinator.issueTicket()
    const next = makeFile()
    next.plants[0]!.position = { x: 55, y: 66 }
    cleanStateFailures = 1

    expect(() => coordinator.hydrate(next)).toThrow('clean-state publication failed')
    expect(store.persisted.plants[0]?.position).toEqual({ x: 55, y: 66 })
    expect(coordinator.applyBackfills(ticket, appleBackfill)).toBe('stale')
    const blocked = vi.fn()
    expect(coordinator.run('blocked-during-hydration', blocked)).toBe(false)
    expect(blocked).not.toHaveBeenCalled()

    coordinator.hydrate(next)

    expect(coordinator.run('after-hydration', (tx) => {
      tx.mutate((draft) => {
        draft.plants[1]!.position = { x: 31, y: 32 }
      })
    })).toBe(true)
  })

  it('hydrates Scene content without introducing camera state into the Scene Session', () => {
    const { coordinator, store } = createAdmissionHarness()

    coordinator.hydrate(makeFile())

    expect(store.session).not.toHaveProperty('viewport')
  })

  it('retries the retained replacement finalizer without accepting a duplicate callback', () => {
    const stageCalls = {
      history: 0,
      documentSignals: 0,
      sceneSignals: 0,
      invalidation: 0,
      sceneRevision: 0,
    }
    const history = new SceneHistory({
      reportCleanState: () => {
        stageCalls.history += 1
      },
    })
    const { coordinator, store } = createAdmissionHarness({
      history,
      syncCanvasSignalsFromScene: () => {
        stageCalls.sceneSignals += 1
      },
      invalidate: () => {
        stageCalls.invalidation += 1
      },
      incrementSceneRevision: () => {
        stageCalls.sceneRevision += 1
      },
    })
    const next = makeFile()
    next.name = 'Finalizer-safe hydration'
    next.plants[0]!.position = { x: 55, y: 66 }
    const syncDocumentSignals = vi.fn(() => {
      stageCalls.documentSignals += 1
    })
    let finalizerFailures = 1
    const originalFinalizer = vi.fn(() => {
      if (finalizerFailures > 0) {
        finalizerFailures -= 1
        throw new Error('replacement finalizer failed')
      }
    })
    const retryFinalizer = vi.fn()
    const prepare = vi.fn()
    const replacementToken = createCanvasDocumentReplacementToken()

    expect(() => coordinator.replaceDocument(next, {
      token: replacementToken,
      prepare,
      syncDocumentSignals,
      finalizeReplacement: originalFinalizer,
    }))
      .toThrow('replacement finalizer failed')
    expect(store.persisted.plants[0]?.position).toEqual({ x: 55, y: 66 })
    const blocked = vi.fn()
    expect(coordinator.run('blocked-during-finalizer', blocked)).toBe(false)
    expect(blocked).not.toHaveBeenCalled()

    expect(coordinator.replaceDocument(JSON.parse(JSON.stringify(next)) as CanopiFile, {
      token: replacementToken,
      prepare,
      finalizeReplacement: retryFinalizer,
    })).toBe(false)

    expect(stageCalls).toEqual({
      history: 1,
      documentSignals: 1,
      sceneSignals: 1,
      invalidation: 1,
      sceneRevision: 1,
    })
    expect(originalFinalizer).toHaveBeenCalledTimes(2)
    expect(retryFinalizer).not.toHaveBeenCalled()
    expect(prepare).toHaveBeenCalledOnce()
    const admitted = vi.fn()
    expect(coordinator.runWhenSettled(admitted, undefined)).toBeUndefined()
    expect(admitted).toHaveBeenCalledOnce()
  })

  it('does not let reentrant prepare replace an already reserved document successor', () => {
    const { coordinator, store } = createAdmissionHarness()
    const active = coordinator.begin('interaction-drag')
    active.mutate((draft) => {
      draft.plants[0]!.position = { x: 44, y: 55 }
    })
    const first = makeFile()
    first.name = 'First reserved replacement'
    first.plants[0]!.position = { x: 66, y: 77 }
    const competing = makeFile()
    competing.name = 'Competing replacement'
    competing.plants[0]!.position = { x: 88, y: 99 }
    const firstToken = createCanvasDocumentReplacementToken()
    const competingToken = createCanvasDocumentReplacementToken()
    const competingPrepare = vi.fn(() => active.abort())
    const firstPrepare = vi.fn(() => {
      expect(() => coordinator.replaceDocument(competing, {
        token: competingToken,
        prepare: competingPrepare,
      })).toThrowError(SceneEditBusyError)
      active.abort()
    })

    coordinator.replaceDocument(first, { token: firstToken, prepare: firstPrepare })

    expect(firstPrepare).toHaveBeenCalledOnce()
    expect(competingPrepare).not.toHaveBeenCalled()
    expect(store.persisted.plants[0]?.position).toEqual({ x: 66, y: 77 })
    expect(coordinator.run('after-reserved-replacement', (tx) => {
      tx.mutate((draft) => {
        draft.plants[1]!.position = { x: 31, y: 32 }
      })
    })).toBe(true)
  })

  it('settles but quarantines byte-equivalent replacement content with another token', () => {
    let cleanStateFailures = 1
    const history = new SceneHistory({
      reportCleanState: () => {
        if (cleanStateFailures > 0) {
          cleanStateFailures -= 1
          throw new Error('clean-state publication failed')
        }
      },
    })
    const { coordinator } = createAdmissionHarness({ history })
    const file = makeFile()
    file.name = 'Shared replacement contents'
    const firstToken = createCanvasDocumentReplacementToken()
    const competingToken = createCanvasDocumentReplacementToken()
    const firstFinalizer = vi.fn()
    const competingPrepare = vi.fn()
    const competingFinalizer = vi.fn()

    expect(() => coordinator.replaceDocument(file, {
      token: firstToken,
      prepare: () => {},
      finalizeReplacement: firstFinalizer,
    })).toThrow('clean-state publication failed')

    expect(() => coordinator.replaceDocument(
      JSON.parse(JSON.stringify(file)) as CanopiFile,
      {
        token: competingToken,
        prepare: competingPrepare,
        finalizeReplacement: competingFinalizer,
      },
    )).toThrowError(SceneEditBusyError)
    expect(firstFinalizer).toHaveBeenCalledOnce()
    expect(competingPrepare).not.toHaveBeenCalled()
    expect(competingFinalizer).not.toHaveBeenCalled()

    expect(coordinator.replaceDocument(file, {
      token: competingToken,
      prepare: competingPrepare,
      finalizeReplacement: competingFinalizer,
    })).toBe(true)
    expect(competingPrepare).toHaveBeenCalledOnce()
    expect(competingFinalizer).toHaveBeenCalledOnce()
  })

  it('reports a preparation rejection as not admitted and releases the old Scene', () => {
    const { coordinator, store } = createAdmissionHarness()
    const next = makeFile()
    next.name = 'Rejected before hydration'
    next.plants[0]!.position = { x: 77, y: 88 }
    const preparationError = new Error('replacement preparation failed')
    let rejection: unknown

    try {
      coordinator.replaceDocument(next, {
        token: createCanvasDocumentReplacementToken(),
        prepare: () => {
          throw preparationError
        },
      })
    } catch (error) {
      rejection = error
    }

    expect(rejection).toBeInstanceOf(CanvasDocumentReplacementNotAdmittedError)
    expect(rejection).toMatchObject({ reason: preparationError })
    expect(store.persisted.plants[0]?.position).toEqual({ x: 10, y: 10 })
    expect(coordinator.run('edit-after-rejection', (tx) => {
      tx.mutate((draft) => {
        draft.plants[0]!.position = { x: 44, y: 55 }
      })
    })).toBe(true)
    expect(store.persisted.plants[0]?.position).toEqual({ x: 44, y: 55 })
  })

  it('settles and quarantines a retained immediate edit before replacing on retry', () => {
    let invalidationFailures = 2
    const { coordinator, store } = createAdmissionHarness({
      invalidate: () => {
        if (invalidationFailures > 0) {
          invalidationFailures -= 1
          throw new Error('immediate publication failed')
        }
      },
    })
    expect(() => coordinator.run('retained-before-hydration', (tx) => {
      tx.mutate((draft) => {
        draft.plants[0]!.position = { x: 44, y: 55 }
      })
    })).toThrow('could not be settled')
    const next = makeFile()
    next.name = 'After retained immediate'
    next.plants[0]!.position = { x: 77, y: 88 }
    const prepare = vi.fn()
    const replacementToken = createCanvasDocumentReplacementToken()

    expect(() => coordinator.replaceDocument(next, { token: replacementToken, prepare }))
      .toThrowError(SceneEditBusyError)
    expect(prepare).not.toHaveBeenCalled()
    expect(store.persisted.plants[0]?.position).toEqual({ x: 44, y: 55 })

    coordinator.replaceDocument(next, { token: replacementToken, prepare })
    expect(prepare).toHaveBeenCalledOnce()
    expect(store.persisted.plants[0]?.position).toEqual({ x: 77, y: 88 })
  })

  it('settles and quarantines a retained history replay before replacing on retry', () => {
    let invalidationFailures = 0
    const { coordinator, store } = createAdmissionHarness({
      invalidate: () => {
        if (invalidationFailures > 0) {
          invalidationFailures -= 1
          throw new Error('history publication failed')
        }
      },
    })
    expect(coordinator.run('seed-history-before-hydration', (tx) => {
      tx.mutate((draft) => {
        draft.plants[0]!.position = { x: 44, y: 55 }
      })
    })).toBe(true)
    invalidationFailures = 1
    expect(() => coordinator.undo()).toThrow('history publication failed')
    const next = makeFile()
    next.name = 'After retained history'
    next.plants[0]!.position = { x: 77, y: 88 }
    const prepare = vi.fn()
    const replacementToken = createCanvasDocumentReplacementToken()

    expect(() => coordinator.replaceDocument(next, { token: replacementToken, prepare }))
      .toThrowError(SceneEditBusyError)
    expect(prepare).not.toHaveBeenCalled()
    expect(store.persisted.plants[0]?.position).toEqual({ x: 10, y: 10 })

    coordinator.replaceDocument(next, { token: replacementToken, prepare })
    expect(prepare).toHaveBeenCalledOnce()
    expect(store.persisted.plants[0]?.position).toEqual({ x: 77, y: 88 })
  })

  it('settles and quarantines a retained long-lived commit before replacing on retry', () => {
    let invalidationFailures = 1
    const { coordinator, store } = createAdmissionHarness({
      invalidate: () => {
        if (invalidationFailures > 0) {
          invalidationFailures -= 1
          throw new Error('long-lived publication failed')
        }
      },
    })
    const active = coordinator.begin('retained-gesture-commit')
    active.mutate((draft) => {
      draft.plants[0]!.position = { x: 44, y: 55 }
    })
    expect(() => active.commit()).toThrow('long-lived publication failed')
    const next = makeFile()
    next.name = 'After retained gesture commit'
    next.plants[0]!.position = { x: 77, y: 88 }
    const prepare = vi.fn()
    const replacementToken = createCanvasDocumentReplacementToken()

    expect(() => coordinator.replaceDocument(next, { token: replacementToken, prepare }))
      .toThrowError(SceneEditBusyError)
    expect(prepare).not.toHaveBeenCalled()
    expect(store.persisted.plants[0]?.position).toEqual({ x: 44, y: 55 })

    coordinator.replaceDocument(next, { token: replacementToken, prepare })
    expect(prepare).toHaveBeenCalledOnce()
    expect(store.persisted.plants[0]?.position).toEqual({ x: 77, y: 88 })
  })

  it('resumes hydration when a retry supplies equivalent normalized document data', () => {
    let cleanStateFailures = 1
    const history = new SceneHistory({
      reportCleanState: () => {
        if (cleanStateFailures > 0) {
          cleanStateFailures -= 1
          throw new Error('clean-state publication failed')
        }
      },
    })
    const { coordinator, store } = createAdmissionHarness({ history })
    const next = makeFile()
    next.name = 'Equivalent hydration retry'
    next.plants[0]!.position = { x: 55, y: 66 }

    expect(() => coordinator.hydrate(next)).toThrow('clean-state publication failed')
    coordinator.hydrate(JSON.parse(JSON.stringify(next)) as CanopiFile)

    expect(store.persisted.plants[0]?.position).toEqual({ x: 55, y: 66 })
    expect(coordinator.run('after-equivalent-hydration', (tx) => {
      tx.mutate((draft) => {
        draft.plants[1]!.position = { x: 31, y: 32 }
      })
    })).toBe(true)
  })

  it('rejects a competing hydration while preserving the first accepted snapshot', () => {
    let cleanStateFailures = 1
    const history = new SceneHistory({
      reportCleanState: () => {
        if (cleanStateFailures > 0) {
          cleanStateFailures -= 1
          throw new Error('clean-state publication failed')
        }
      },
    })
    const { coordinator, store } = createAdmissionHarness({ history })
    const accepted = makeFile()
    accepted.name = 'Accepted hydration'
    accepted.plants[0]!.position = { x: 55, y: 66 }
    const competing = makeFile()
    competing.name = 'Competing hydration'
    competing.plants[0]!.position = { x: 99, y: 101 }

    expect(() => coordinator.hydrate(accepted)).toThrow('clean-state publication failed')

    try {
      coordinator.hydrate(competing)
      throw new Error('Expected the competing hydration to stay quarantined')
    } catch (error) {
      expect(error).toBeInstanceOf(SceneEditBusyError)
      expect((error as SceneEditBusyError).activeType).toBe('document-hydration')
    }
    expect(store.persisted.plants[0]?.position).toEqual({ x: 55, y: 66 })

    coordinator.hydrate(JSON.parse(JSON.stringify(accepted)) as CanopiFile)

    expect(store.persisted.plants[0]?.position).toEqual({ x: 55, y: 66 })
    expect(coordinator.run('after-competing-hydration', (tx) => {
      tx.mutate((draft) => {
        draft.plants[1]!.position = { x: 31, y: 32 }
      })
    })).toBe(true)
  })

  it('hydrates from an owned snapshot when the caller mutates failed input', () => {
    let cleanStateFailures = 1
    const history = new SceneHistory({
      reportCleanState: () => {
        if (cleanStateFailures > 0) {
          cleanStateFailures -= 1
          throw new Error('clean-state publication failed')
        }
      },
    })
    const { coordinator, store } = createAdmissionHarness({ history })
    const next = makeFile()
    next.name = 'Owned hydration snapshot'
    next.plants[0]!.position = { x: 55, y: 66 }
    const equivalentRetry = JSON.parse(JSON.stringify(next)) as CanopiFile
    const syncDocumentSignals = vi.fn<(hydratedFile: CanopiFile) => void>()

    expect(() => coordinator.hydrate(next, syncDocumentSignals))
      .toThrow('clean-state publication failed')
    next.plants[0]!.position = { x: 999, y: 999 }

    coordinator.hydrate(equivalentRetry)

    expect(store.persisted.plants[0]?.position).toEqual({ x: 55, y: 66 })
    expect(syncDocumentSignals.mock.calls[0]?.[0].plants[0]?.position)
      .toEqual({ x: 55, y: 66 })
  })

  it('passes a fresh accepted snapshot to each hydration callback retry', () => {
    const { coordinator, store } = createAdmissionHarness()
    const next = makeFile()
    next.name = 'Callback-safe hydration'
    next.north_bearing_deg = 15
    next.plants[0]!.position = { x: 55, y: 66 }
    let callbackAttempts = 0
    const projectedBearings: number[] = []
    const syncDocumentSignals = (hydratedFile: CanopiFile): void => {
      callbackAttempts += 1
      projectedBearings.push(hydratedFile.north_bearing_deg ?? 0)
      hydratedFile.north_bearing_deg = 270
      if (callbackAttempts === 1) throw new Error('document projection failed')
    }

    expect(() => coordinator.hydrate(next, syncDocumentSignals))
      .toThrow('document projection failed')
    coordinator.hydrate(JSON.parse(JSON.stringify(next)) as CanopiFile)

    expect(projectedBearings).toEqual([15, 15])
    expect(next.north_bearing_deg).toBe(15)
    expect(store.persisted.plants[0]?.position).toEqual({ x: 55, y: 66 })
  })

  it('publishes one hydration revision when a revision observer throws', () => {
    const revision = signal(0)
    let throwFromObserver = false
    const dispose = effect(() => {
      void revision.value
      if (!throwFromObserver) return
      throwFromObserver = false
      throw new Error('hydration revision observer failed')
    })
    const { coordinator } = createAdmissionHarness({
      incrementSceneRevision: () => {
        revision.value += 1
      },
    })
    const next = makeFile()
    next.name = 'Revision-safe hydration'
    throwFromObserver = true

    expect(() => coordinator.hydrate(next)).toThrow('hydration revision observer failed')
    coordinator.hydrate(JSON.parse(JSON.stringify(next)) as CanopiFile)

    expect(revision.value).toBe(1)
    dispose()
  })

  it('drains a current backfill before releasing a retried hydration', () => {
    let coordinator: SceneRuntimeEditCoordinator
    let hydrationInvalidation = true
    const harness = createAdmissionHarness({
      invalidate: () => {
        if (!hydrationInvalidation) return
        hydrationInvalidation = false
        const ticket = coordinator.issueTicket()
        expect(coordinator.applyBackfills(ticket, appleBackfill)).toBe('deferred')
        throw new Error('late hydration publication failed')
      },
    })
    coordinator = harness.coordinator
    const next = makeFile()
    next.name = 'Backfilled hydration'

    expect(() => coordinator.hydrate(next)).toThrow('late hydration publication failed')
    expect(harness.store.persisted.plants[0]?.stratum).toBeNull()

    coordinator.hydrate(JSON.parse(JSON.stringify(next)) as CanopiFile)

    expect(harness.store.persisted.plants[0]).toMatchObject({
      stratum: 'canopy',
      canopySpreadM: 4,
      scale: 4,
    })
    const admittedAfterSettlement = vi.fn()
    expect(coordinator.run('after-hydration-backfill', admittedAfterSettlement)).toBe(false)
    expect(admittedAfterSettlement).toHaveBeenCalledOnce()
  })
})
