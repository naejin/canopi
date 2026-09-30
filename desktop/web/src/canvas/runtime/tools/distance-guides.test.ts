import { describe, expect, it } from 'vitest'
import { createToolSceneSource, plantEntity, sceneStoreWith } from '../../../__tests__/support/tool-harness'
import { distanceGuideShapes, plantDragDistanceGuideShapes } from './distance-guides'
import { createToolScene } from './spatial-index'

describe('plant distance guides', () => {
  it('is a dashed draft line over its casing with a measure chip at its middle', () => {
    expect(distanceGuideShapes({ x: 0, y: 0 }, { x: 4, y: 3 }, '5 m')).toEqual([
      { kind: 'polyline', points: [{ x: 0, y: 0 }, { x: 4, y: 3 }], style: { token: 'draft', widthPx: 1.5, dash: [4, 4] } },
      { kind: 'label', anchor: { x: 2, y: 1.5 }, offsetPx: { x: 0, y: 0 }, text: '5 m', tone: 'measure' },
    ])
  })

  it('puts its chip where the caller says, as Place plants does below the symbol', () => {
    const [, label] = distanceGuideShapes({ x: 0, y: 0 }, { x: 4, y: 3 }, 'Nearest', {
      anchor: { x: 0, y: 0 },
      offsetPx: { x: 0, y: 22 },
    })

    expect(label).toEqual({ kind: 'label', anchor: { x: 0, y: 0 }, offsetPx: { x: 0, y: 22 }, text: 'Nearest', tone: 'measure' })
  })

  it('guides a dragged plant to the two nearest plants left behind, by distance then id', () => {
    const store = sceneStoreWith({
      plants: [
        plantEntity('dragged', 'Malus domestica', { x: 0, y: 0 }),
        plantEntity('also-dragged', 'Malus domestica', { x: 0.5, y: 0 }),
        plantEntity('far', 'Malus domestica', { x: 30, y: 0 }),
        plantEntity('b', 'Malus domestica', { x: 0, y: 3 }),
        plantEntity('a', 'Malus domestica', { x: 3, y: 0 }),
      ],
    })
    const scene = createToolScene(createToolSceneSource(store))
    const dragged = store.persisted.plants[0]!

    const shapes = plantDragDistanceGuideShapes(scene, dragged, new Set(['dragged', 'also-dragged']))

    expect(shapes).toEqual([
      ...distanceGuideShapes({ x: 0, y: 0 }, { x: 3, y: 0 }, '3 m'),
      ...distanceGuideShapes({ x: 0, y: 0 }, { x: 0, y: 3 }, '3 m'),
    ])
  })

  it('shows no guide while the plants layer is hidden, as today', () => {
    const store = sceneStoreWith({
      plants: [
        plantEntity('dragged', 'Malus domestica', { x: 0, y: 0 }),
        plantEntity('a', 'Malus domestica', { x: 3, y: 0 }),
      ],
    })
    store.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) => layer.name === 'plants' ? { ...layer, visible: false } : layer)
    })
    const scene = createToolScene(createToolSceneSource(store))

    expect(plantDragDistanceGuideShapes(scene, store.persisted.plants[0]!, new Set(['dragged']))).toEqual([])
  })

  it('shows no guide when no plant is left behind', () => {
    const store = sceneStoreWith({ plants: [plantEntity('only', 'Malus domestica', { x: 0, y: 0 })] })
    const scene = createToolScene(createToolSceneSource(store))

    expect(plantDragDistanceGuideShapes(scene, store.persisted.plants[0]!, new Set(['only']))).toEqual([])
  })
})
