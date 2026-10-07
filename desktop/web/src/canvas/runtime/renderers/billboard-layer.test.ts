// Production CSP rejects Pixi's generated functions; its shim avoids eval.
import 'pixi.js/unsafe-eval'
import { Container, Graphics, Text } from 'pixi.js'
import { describe, expect, it } from 'vitest'

import { createTestRendererView, createTestSceneRendererSnapshot } from '../../../__tests__/support/scene-renderer-snapshot'
import type { ScenePlantEntity } from '../scene'
import { createBillboardLayer } from './billboard-layer'

function createPlant(overrides: Partial<ScenePlantEntity> = {}): ScenePlantEntity {
  return {
    kind: 'plant', locked: false, id: 'plant', canonicalName: 'Malus domestica', commonName: 'Apple',
    color: null, canopySpreadM: null, position: { x: 4, y: 3 }, rotationDeg: null,
    notes: null, plantedDate: null, quantity: 1, ...overrides,
  }
}

/** Every node under `root`, depth first. */
function nodes(root: Container): Container[] {
  return root.children.flatMap((child) => [child, ...nodes(child)])
}

describe('billboard layer', () => {
  it('billboards stay upright at bearings 0, 30, 45, 60 and 200', () => {
    const layer = createBillboardLayer({ createText: () => new Text(), viewSize: { width: 400, height: 300 } })
    const plants = [
      createPlant({ id: 'apple', position: { x: 4, y: 3 }, pinnedName: true }),
      createPlant({ id: 'pear', canonicalName: 'Pyrus communis', commonName: 'Pear', position: { x: 6, y: 2 } }),
    ]
    const snapshot = createTestSceneRendererSnapshot({
      scene: {
        plants,
        annotations: [{ kind: 'annotation', id: 'note', annotationType: 'text', locked: false,
          position: { x: 5, y: 5 }, text: 'Pond edge', fontSize: 16, rotationDeg: 30 }],
      },
      selectedTargets: [{ kind: 'plant', id: 'pear' }],
    })

    for (const bearingDeg of [0, 30, 45, 60, 200]) {
      const view = createTestRendererView({ x: 200, y: 150, scale: 20 }, { bearingDeg })
      layer.present(view, bearingDeg === 0 ? snapshot : undefined)
      // The root carries no transform: billboards are CSS px, placed one by one.
      layer.root.updateLocalTransform()
      expect(layer.root.localTransform.a).toBe(1)
      expect(layer.root.localTransform.b).toBe(0)

      const symbols = nodes(layer.root).filter((node) => node instanceof Graphics && node.zIndex >= 0 && node.parent?.sortableChildren)
      expect(symbols).toHaveLength(2)
      for (const [index, plant] of plants.entries()) {
        const at = view.worldToScreen(plant.position)
        expect(symbols[index]!.position.x, `bearing ${bearingDeg}`).toBeCloseTo(at.x, 3)
        expect(symbols[index]!.position.y, `bearing ${bearingDeg}`).toBeCloseTo(at.y, 3)
        expect(symbols[index]!.rotation).toBe(0)
      }

      // The pinned name and the selection's name hang below their plants on screen, whatever the bearing.
      const texts = nodes(layer.root).filter((node): node is Text => node instanceof Text)
      for (const [name, plant] of [['Apple', plants[0]!], ['Pear', plants[1]!]] as const) {
        const label = texts.find((text) => text.text === name)!
        const at = view.worldToScreen(plant.position)
        expect(label.rotation).toBe(0)
        expect(label.position.x, `${name} at bearing ${bearingDeg}`).toBeCloseTo(at.x, 3)
        expect(label.position.y - at.y, `${name} at bearing ${bearingDeg}`).toBeGreaterThan(0)
      }

      // A note's text keeps its angle on the ground: its own 30°, less the bearing.
      const note = texts.find((text) => text.text === 'Pond edge')!
      const noteAt = view.worldToScreen({ x: 5, y: 5 })
      expect(note.position.x).toBeCloseTo(noteAt.x, 3)
      expect(note.position.y).toBeCloseTo(noteAt.y, 3)
      expect(note.rotation).toBeCloseTo(((30 - bearingDeg) * Math.PI) / 180, 6)
    }
    layer.dispose()
  })
})
