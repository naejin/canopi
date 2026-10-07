import { describe, expect, it } from 'vitest'
import { getCanvasDetailLayout, getCanvasPlantNameLabels } from '../canvas/runtime/automatic-detail'
import { getAnnotationPresentation, isPointInAnnotationPresentation } from '../canvas/runtime/annotation-layout'
import { SceneStore, type ScenePlantEntity } from '../canvas/runtime/scene'
import { createTestRendererView, createTestSceneRendererSnapshot } from './support/scene-renderer-snapshot'

function plant(id: string, x: number, y: number): ScenePlantEntity {
  return { kind: 'plant', id, position: { x, y }, canonicalName: 'Mentha spicata', commonName: 'Menthe verte',
    color: null, canopySpreadM: null, rotationDeg: null, notes: null,
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

  it('editing a note\'s text recomputes the detail layout', () => {
    const note = (id: string, x: number, text: string) => ({ kind: 'annotation' as const, id, annotationType: 'text',
      position: { x, y: 0 }, text, fontSize: 16, rotationDeg: 0, locked: false })
    const store = new SceneStore()
    store.updatePersisted((draft) => { draft.annotations = [note('a', 0, 'Hi'), note('b', 10, 'Pond')] })
    const layout = getCanvasDetailLayout(store.persisted, 20)
    expect([...layout.annotationIds].sort()).toEqual(['a', 'b'])
    expect(getCanvasDetailLayout(store.persisted, 20)).toBe(layout)

    store.updatePersisted((draft) => { draft.annotations[0]!.text = 'Hi, this note now runs across the pond note' })
    expect([...getCanvasDetailLayout(store.persisted, 20).annotationIds]).toEqual(['b'])
  })

  it('keeps a crowded note discoverable with a compact marker and matching pointer allowance', () => {
    const note = { kind: 'annotation' as const, id: 'note', annotationType: 'text', position: { x: 0, y: 0 },
      text: 'Planting note', fontSize: 16, rotationDeg: 0, locked: false }
    const presentation = getAnnotationPresentation(note, 20, false, false)
    expect(presentation.frame.widthPx).toBe(4)
    expect(isPointInAnnotationPresentation(note, { x: 6 / 20, y: 0 }, 20, false, false)).toBe(true)
    expect(isPointInAnnotationPresentation(note, { x: 7 / 20, y: 0 }, 20, false, false)).toBe(false)
    expect(getAnnotationPresentation(note, 20, true, false).textOpacity).toBe(1)
  })

  it('identifies unpinned plants when local space allows without changing their saved name choices', () => {
    const snapshot = createTestSceneRendererSnapshot({
      scene: { plants: [plant('a', 0, 0), plant('b', .27, 0)] },
    })
    const before = JSON.stringify(snapshot.scene)
    const labels = getCanvasPlantNameLabels(snapshot, 400)
    expect(labels.map((label) => label.text)).toEqual(['Menthe verte', 'Menthe verte'])
    expect(JSON.stringify(snapshot.scene)).toBe(before)
    expect(getCanvasPlantNameLabels(snapshot, 10)).toEqual([])
  })

  it('draws the labels a snapshot asks for over the workspace choice (a saved view)', () => {
    const snapshot = createTestSceneRendererSnapshot({
      scene: { plants: [plant('a', 0, 0), plant('b', .27, 0)], plantSpeciesCodes: { 'Mentha spicata': 'MSP' } },
    })
    const pixelsPerMetre = 400
    expect(getCanvasPlantNameLabels({ ...snapshot, plantLabels: 'none' }, pixelsPerMetre)).toEqual([])
    expect(getCanvasPlantNameLabels({ ...snapshot, plantLabels: 'codes' }, pixelsPerMetre).map((label) => label.text)).toEqual(['MSP', 'MSP'])
    expect(getCanvasPlantNameLabels({ ...snapshot, plantLabels: 'names' }, pixelsPerMetre).map((label) => label.text))
      .toEqual(['Menthe verte', 'Menthe verte'])
  })

  it('keeps collision admission stable during panning and a round trip through overview zoom', () => {
    const snapshot = createTestSceneRendererSnapshot({
      scene: { plants: [plant('a', 0, 0), plant('b', .4, 0), plant('c', .8, 0)] },
    })
    const labels = getCanvasPlantNameLabels(snapshot, 100)
    expect(labels.length).toBeGreaterThan(0)
    expect(labels.length).toBeLessThan(3)
    // A pan moves where the admitted labels land in the frame, by the pan.
    const landing = (viewport: { x: number; y: number; scale: number }) => labels.map((label) => {
      const anchor = createTestRendererView(viewport).worldToScreen(label.anchor)
      return { x: anchor.x + label.offsetPx.x, y: anchor.y + label.offsetPx.y }
    })
    const panned = landing({ x: 113, y: -27, scale: 100 })
    for (const [index, point] of landing({ x: 0, y: 0, scale: 100 }).entries()) {
      expect(panned[index]!.x).toBeCloseTo(point.x + 113, 6)
      expect(panned[index]!.y).toBeCloseTo(point.y - 27, 6)
    }
    getCanvasPlantNameLabels(snapshot, 10)
    expect(getCanvasPlantNameLabels(snapshot, 100)).toEqual(labels)
  })

  it('prioritizes an authored pin in a crowded label area and never reveals a hidden plant layer', () => {
    const snapshot = createTestSceneRendererSnapshot({
      scene: { plants: [plant('a', 0, 0), plant('b', 0, 0), { ...plant('z', 0, 0), pinnedName: true }] },
    })
    const pixelsPerMetre = 100
    expect(getCanvasPlantNameLabels(snapshot, pixelsPerMetre).map(label => label.plantId)).toEqual(['z', 'a'])
    const hidden = { ...snapshot, scene: { ...snapshot.scene,
      layers: [{ kind: 'layer' as const, name: 'plants', visible: false, locked: false, opacity: 1 }] } }
    expect(getCanvasPlantNameLabels(hidden, pixelsPerMetre)).toEqual([])
  })
})
