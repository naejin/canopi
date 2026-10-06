import { afterEach, describe, expect, it } from 'vitest'
import {
  createToolHarness,
  plantEntity,
  rectZone,
  type ToolHarness,
  type ToolHarnessOptions,
} from '../../../../__tests__/support/tool-harness'
import type { SceneDesignObjectTarget } from '../../scene/design-object-targets'
import '../../../../__tests__/support/camera-tolerance'

const harnesses: ToolHarness[] = []

function harness(options: ToolHarnessOptions = {}): ToolHarness {
  const created = createToolHarness(options)
  harnesses.push(created)
  return created
}

afterEach(() => {
  for (const created of harnesses.splice(0)) created.dispose()
})

const plant = (id: string): SceneDesignObjectTarget => ({ kind: 'plant', id })

function orchard() {
  return {
    plants: [
      plantEntity('a', 'Malus domestica', { x: 50, y: 50 }),
      plantEntity('b', 'Pyrus communis', { x: 90, y: 80 }),
      plantEntity('c', 'Prunus avium', { x: 300, y: 250 }),
      plantEntity('locked', 'Malus domestica', { x: 70, y: 60 }, { locked: true }),
    ],
  }
}

describe('Select band', () => {
  it('a band from empty ground selects what it hits', () => {
    const h = harness({ scene: orchard() })
    h.select(plant('c'))

    h.press({ x: 20, y: 20 })
    // The press clears the selection at once, as today.
    expect(h.store.session.selectedTargets).toEqual([])
    h.move({ x: 60, y: 60 })
    expect(h.renderer.lastDraft()).toEqual({
      shapes: [{
        kind: 'quad',
        corners: [{ x: 20, y: 20 }, { x: 60, y: 20 }, { x: 60, y: 60 }, { x: 20, y: 60 }],
        style: { token: 'selection', widthPx: 2 },
        fill: { token: 'selection-fill' },
      }],
    })
    h.move({ x: 120, y: 120 })
    h.release()

    // The locked plant inside the band is left out; nothing outside it is selected.
    expect(h.store.session.selectedTargets).toEqual([plant('a'), plant('b')])
    expect(h.renderer.lastDraft()).toBeNull()
    expect(h.history.canUndo.value).toBe(false)
  })

  it('the band hits in its rotated quad at 30', () => {
    const probe = harness({ camera: { bearingDeg: 30 } })
    // A screen box from (100, 100) to (300, 200); one plant inside it, one outside it but inside the world box of its
    // turned quad (the corner the turn swings out), which today's query read.
    const inside = probe.world({ x: 290, y: 190 })
    const outside = probe.world({ x: 250, y: 60 })
    const corners = [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 200 }, { x: 100, y: 200 }].map((at) => probe.world(at))
    const xs = corners.map((corner) => corner.x)
    const ys = corners.map((corner) => corner.y)
    expect(outside.x).toBeGreaterThan(Math.min(...xs) + 5)
    expect(outside.x).toBeLessThan(Math.max(...xs) - 5)
    expect(outside.y).toBeGreaterThan(Math.min(...ys) + 5)
    expect(outside.y).toBeLessThan(Math.max(...ys) - 5)
    const h = harness({
      camera: { bearingDeg: 30 },
      scene: { plants: [plantEntity('inside', 'Malus domestica', inside), plantEntity('outside', 'Malus domestica', outside)] },
    })

    h.drag({ x: 100, y: 100 }, { x: 300, y: 200 })

    expect(h.store.session.selectedTargets).toEqual([plant('inside')])
  })

  it('Shift adds the band', () => {
    const h = harness({ scene: orchard() })
    h.select(plant('c'))

    h.drag({ x: 20, y: 20 }, { x: 120, y: 120 }, { mods: { shift: true } })

    expect(h.store.session.selectedTargets).toEqual([plant('c'), plant('a'), plant('b')])
  })

  it('a band shorter than 2 px selects nothing, and its release waits for a settled scene', () => {
    const h = harness({ scene: orchard() })
    h.select(plant('c'))

    h.press({ x: 20, y: 20 })
    h.move({ x: 21, y: 21 })
    h.release()
    expect(h.store.session.selectedTargets).toEqual([])

    h.press({ x: 20, y: 20 })
    h.move({ x: 120, y: 120 })
    const busy = h.edits.begin('external-preview')
    expect(h.release()).toEqual({ quarantine: true })
    expect(h.store.session.selectedTargets).toEqual([])
    expect(h.renderer.lastDraft()).toBeNull()
    busy.abort()
  })

  it("a drag in a zone's fill draws a band", () => {
    const bed = rectZone('bed', [{ x: 10, y: 10 }, { x: 200, y: 10 }, { x: 200, y: 200 }, { x: 10, y: 200 }])
    const h = harness({ scene: { ...orchard(), zones: [bed] } })
    h.select(plant('c'))

    // The press in the fill clears the selection unless additive, and the drag bands; the zone never moves.
    h.press({ x: 30, y: 30 })
    expect(h.store.session.selectedTargets).toEqual([])
    h.move({ x: 60, y: 60 })
    expect(h.renderer.lastDraft()?.shapes[0]).toMatchObject({ kind: 'quad' })
    h.move({ x: 100, y: 100 })
    h.release()

    expect(h.store.persisted.zones[0]!.points).toEqual(bed.points)
    expect(h.store.session.selectedTargets).toEqual([plant('a'), plant('b'), { kind: 'zone', id: 'bed' }])
    expect(h.history.canUndo.value).toBe(false)
  })
})
