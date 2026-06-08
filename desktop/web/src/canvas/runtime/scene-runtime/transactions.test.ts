import { beforeEach, describe, expect, it } from 'vitest'

import { canvasClean } from '../../../__tests__/support/design-session-state'
import type { CanopiFile } from '../../../types/design'
import { selectedObjectIds } from '../../session-state'
import { SceneHistory } from '../scene-history'
import { SceneStore } from '../scene'
import { SceneRuntimeDocumentBridge } from './document'
import {
  SceneRuntimeEditCoordinator,
  type SceneEditInvalidationKind,
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
  const documents = new SceneRuntimeDocumentBridge({
    sceneStore,
    history,
    setSelection,
    resetTransientRuntimeState: () => {},
    clearHoveredTargets: () => {},
    clearPanelOriginTargets: () => {},
    composeDocumentForSave: ({ canvas }) => canvas,
    syncCanvasSignalsFromDocument: () => {},
    syncCanvasSignalsFromScene: () => {},
    invalidateScene: () => {
      invalidations.push('scene')
    },
    incrementSceneRevision: () => {
      sceneRevision += 1
    },
    incrementViewportRevision: () => {},
  })
  const sceneEdits = new SceneRuntimeEditCoordinator({
    sceneStore,
    captureSnapshot: () => documents.captureCommandSnapshot(),
    markDirty: (before, type) => documents.markDirty(before, type),
    setSelection,
    invalidate: (kind) => {
      invalidations.push(kind)
    },
  })

  return {
    sceneStore,
    history,
    documents,
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
    const { sceneStore, history, documents, sceneEdits, invalidations, readSceneRevision } = createHarness()

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

    history.undo(documents.historyRuntime())

    expect(sceneStore.persisted.plants[0]?.position).toEqual({ x: 10, y: 10 })
    expect(history.canUndo.value).toBe(false)
    expect(history.canRedo.value).toBe(true)

    history.redo(documents.historyRuntime())

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
