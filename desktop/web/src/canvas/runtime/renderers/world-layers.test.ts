// Production CSP rejects Pixi's generated functions; its shim avoids eval.
import 'pixi.js/unsafe-eval'
import { Graphics } from 'pixi.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createTestRendererView, createTestSceneRendererSnapshot } from '../../../__tests__/support/scene-renderer-snapshot'
import { createWorldLayers } from './world-layers'

afterEach(() => {
  vi.restoreAllMocks()
})

function bedAndGuide() {
  return createTestSceneRendererSnapshot({ scene: {
    zones: [{ kind: 'zone', id: 'bed', name: 'bed', zoneType: 'rect', locked: false, rotationDeg: 0, fillColor: '#eeeeee', notes: null,
      points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }] }],
    measurementGuides: [{ kind: 'measurement-guide', id: 'guide', locked: false, start: { x: 0, y: 0 }, end: { x: 2, y: 0 } }],
  } })
}

describe('world layers', () => {
  it('a pan re-tessellates no zone', () => {
    const layers = createWorldLayers()
    layers.syncScene(bedAndGuide())
    layers.setView(createTestRendererView({ x: 0, y: 0, scale: 30 }))
    const traced = layers.root.children.flatMap((layer) => layer.children) as Graphics[]
    expect(traced).toHaveLength(2)
    const instructions = traced.map((graphics) => graphics.context.instructions.length)
    const clear = vi.spyOn(Graphics.prototype, 'clear')

    // A pan writes the world root's affine, one write, and traces nothing.
    const panned = createTestRendererView({ x: 10, y: 20, scale: 30 })
    layers.setView(panned)
    expect(clear).not.toHaveBeenCalled()
    expect(traced.map((graphics) => graphics.context.instructions.length)).toEqual(instructions)
    layers.root.updateLocalTransform()
    const { a, b, c, d, tx, ty } = layers.root.localTransform
    expect([a, b, c, d, tx, ty]).toEqual([...panned.planar!.affine!])

    // A zoom traces the CSS-px strokes again at the new scale.
    layers.setView(createTestRendererView({ x: 10, y: 20, scale: 60 }))
    expect(clear).toHaveBeenCalledTimes(2)
  })

  it('a scene that arrives before the first view draws at that view', () => {
    const layers = createWorldLayers()
    layers.syncScene(bedAndGuide())
    expect(layers.root.children.flatMap((layer) => layer.children)).toEqual([])
    layers.setView(createTestRendererView({ x: 0, y: 0, scale: 30 }))
    expect(layers.root.children.flatMap((layer) => layer.children)).toHaveLength(2)
  })
})
