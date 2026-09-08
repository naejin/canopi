import { describe, expect, it } from 'vitest'
import { getAnnotationPresentation, getAnnotationVisualWorldBounds } from '../canvas/runtime/annotation-layout'
import { SceneStore, type SceneDesignObjectSelection } from '../canvas/runtime/scene'
import { SceneRuntimePresentationController } from '../canvas/runtime/scene-runtime/presentation'
import { createZoomCalibrationScene } from './support/zoom-calibration-scenes'

describe('scene text presentation', () => {
  it('keeps marker geometry upright and switches to authored rotated text at half opacity', () => {
    const note = { ...createZoomCalibrationScene('garden').annotations[1]!, position: { x: 10, y: 20 }, rotationDeg: 90 }
    expect(getAnnotationVisualWorldBounds(note, 4)).toEqual({ x: 9, y: 19, width: 2, height: 2 })
    expect(getAnnotationPresentation(note, { x: 0, y: 0, scale: 13.99 }).markerOwnsGeometry).toBe(true)
    expect(getAnnotationPresentation(note, { x: 0, y: 0, scale: 14 }).markerOwnsGeometry).toBe(false)
    expect(getAnnotationPresentation(note, { x: 0, y: 0, scale: 4 }, true)).toMatchObject({ textOpacity: 1, markerOpacity: 0, markerOwnsGeometry: false })
  })

  it('projects a direct singleton Annotation reveal without revealing group or mixed selection', () => {
    const store = new SceneStore()
    store.updatePersisted((scene) => Object.assign(scene, createZoomCalibrationScene('garden')))
    const presentation = new SceneRuntimePresentationController({ sceneStore: store,
      getViewport: () => ({ x: 0, y: 0, scale: 4 }), getLocale: () => 'en',
      resolveHighlightedTargets: () => ({ plantIds: [], zoneIds: [] }), onPlantNamesChanged: () => {},
    })
    for (const selection of [
      [{ kind: 'annotation', id: 'note-0' }],
      [{ kind: 'annotation', id: 'note-0' }, { kind: 'plant', id: 'plant-0' }],
      [{ kind: 'group', id: 'guild' }],
    ] satisfies SceneDesignObjectSelection[]) {
      store.setSelection(selection)
      expect(presentation.buildRendererSnapshot().revealedAnnotationId).toBe(selection.length === 1 && selection[0]?.kind === 'annotation' ? 'note-0' : null)
    }
  })

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
