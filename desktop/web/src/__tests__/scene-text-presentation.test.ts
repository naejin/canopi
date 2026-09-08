import { describe, expect, it } from 'vitest'
import { SceneStore, type SceneDesignObjectSelection } from '../canvas/runtime/scene'
import { SceneRuntimePresentationController } from '../canvas/runtime/scene-runtime/presentation'
import { createZoomCalibrationScene } from './support/zoom-calibration-scenes'

describe('scene text presentation', () => {
  it('reveals a name only for direct singleton selection, without modifying the Design', () => {
    const store = new SceneStore()
    store.updatePersisted((scene) => Object.assign(scene, createZoomCalibrationScene('garden')))
    const before = store.persisted
    const presentation = new SceneRuntimePresentationController({
      sceneStore: store, getViewport: () => ({ x: 0, y: 0, scale: 4 }),
      getLocale: () => 'en', resolveHighlightedTargets: () => ({ plantIds: [], zoneIds: [] }),
      onPlantNamesChanged: () => {},
    })
    const selections: SceneDesignObjectSelection[] = [
      [{ kind: 'plant', id: 'plant-1' }],
      [{ kind: 'plant', id: 'plant-1' }, { kind: 'annotation', id: 'note-0' }],
      [{ kind: 'group', id: store.persisted.groups[0]!.id }],
      [{ kind: 'plant', id: 'plant-2' }],
      [{ kind: 'plant', id: 'plant-0' }],
    ]
    const snapshots = selections.map((selection) => {
      store.setSelection(selection)
      return presentation.buildRendererSnapshot()
    })
    expect(snapshots.map((snapshot) => snapshot.pinnedPlantNameLabels.map((label) => label.plantId)))
      .toEqual([['plant-1'], [], [], ['plant-2'], []])
    expect(snapshots.map((snapshot) => snapshot.selectionLabels.length)).toEqual([0, 0, 0, 0, 1])
    expect(store.persisted).toEqual(before)
    expect(store.session.documentRevision).toBe(0)
  })
})
