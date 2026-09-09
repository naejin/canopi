import { describe, expect, it } from 'vitest'
import { getCanvasDetailLayout, getCanvasPlantNameLabels } from '../canvas/runtime/automatic-detail'
import { getAnnotationPresentation, isPointInAnnotationPresentation } from '../canvas/runtime/annotation-layout'
import type { ScenePlantEntity } from '../canvas/runtime/scene'
import { createTestSceneRendererSnapshot } from './support/scene-renderer-snapshot'

function plant(id: string, x: number, y: number): ScenePlantEntity {
  return { kind: 'plant', id, position: { x, y }, canonicalName: 'Mentha spicata', commonName: 'Menthe verte',
    color: null, stratum: null, canopySpreadM: null, rotationDeg: null, scale: null, notes: null,
    plantedDate: null, quantity: null, locked: false, pinnedName: false }
}

describe('Automatic Detail', () => {
  it('does not let invisible plants suppress readable notes', () => {
    const { scene } = createTestSceneRendererSnapshot({ scene: {
      plants: [plant('a', 0, 0)],
      layers: [{ kind: 'layer', name: 'plants', visible: true, locked: false, opacity: 0 }],
      annotations: [{ kind: 'annotation', id: 'note', annotationType: 'text', position: { x: 0, y: 0 },
        text: 'Planting note', fontSize: 16, rotationDeg: 0, locked: false }],
    } })
    expect(getCanvasDetailLayout(scene, 20).annotationIds.has('note')).toBe(true)
  })

  it('keeps a crowded note discoverable with a compact marker and matching pointer allowance', () => {
    const note = { kind: 'annotation' as const, id: 'note', annotationType: 'text', position: { x: 0, y: 0 },
      text: 'Planting note', fontSize: 16, rotationDeg: 0, locked: false }
    const presentation = getAnnotationPresentation(note, { x: 0, y: 0, scale: 20 }, false, false)
    expect(presentation.frame.widthPx).toBe(4)
    expect(isPointInAnnotationPresentation(note, { x: 6 / 20, y: 0 }, 20, false, false)).toBe(true)
    expect(isPointInAnnotationPresentation(note, { x: 7 / 20, y: 0 }, 20, false, false)).toBe(false)
    expect(getAnnotationPresentation(note, { x: 0, y: 0, scale: 20 }, true, false).textOpacity).toBe(1)
  })

  it('identifies unpinned plants when local space allows without changing their saved name choices', () => {
    const snapshot = createTestSceneRendererSnapshot({
      scene: { plants: [plant('a', 0, 0), plant('b', .27, 0)] }, viewport: { x: 0, y: 0, scale: 400 },
    })
    const before = JSON.stringify(snapshot.scene)
    const labels = getCanvasPlantNameLabels(snapshot)
    expect(labels.map((label) => label.text)).toEqual(['Menthe verte', 'Menthe verte'])
    expect(JSON.stringify(snapshot.scene)).toBe(before)
    expect(getCanvasPlantNameLabels({ ...snapshot, viewport: { x: 0, y: 0, scale: 10 } })).toEqual([])
  })

  it('keeps collision admission stable during panning and a round trip through overview zoom', () => {
    const snapshot = createTestSceneRendererSnapshot({
      scene: { plants: [plant('a', 0, 0), plant('b', .4, 0), plant('c', .8, 0)] },
      viewport: { x: 0, y: 0, scale: 100 },
    })
    const labels = getCanvasPlantNameLabels(snapshot)
    expect(labels.length).toBeGreaterThan(0)
    expect(labels.length).toBeLessThan(3)
    expect(getCanvasPlantNameLabels({ ...snapshot, viewport: { x: 113, y: -27, scale: 100 } }))
      .toEqual(labels.map(label => ({ ...label, screenPoint: { x: label.screenPoint.x + 113, y: label.screenPoint.y - 27 } })))
    getCanvasPlantNameLabels({ ...snapshot, viewport: { x: 0, y: 0, scale: 10 } })
    expect(getCanvasPlantNameLabels(snapshot)).toEqual(labels)
  })

  it('prioritizes an authored pin in a crowded label area and never reveals a hidden plant layer', () => {
    const snapshot = createTestSceneRendererSnapshot({
      scene: { plants: [plant('a', 0, 0), plant('b', 0, 0), { ...plant('z', 0, 0), pinnedName: true }] },
      viewport: { x: 0, y: 0, scale: 100 },
      pinnedPlantNameLabels: [{ plantId: 'z', text: 'Menthe verte', fontStyle: 'normal', opacity: 1, screenPoint: { x: 0, y: 10 } }],
    })
    expect(getCanvasPlantNameLabels(snapshot).map(label => label.plantId)).toEqual(['z', 'a'])
    const hidden = { ...snapshot, scene: { ...snapshot.scene,
      layers: [{ kind: 'layer' as const, name: 'plants', visible: false, locked: false, opacity: 1 }] } }
    expect(getCanvasPlantNameLabels(hidden)).toEqual([])
  })
})
