import { afterEach, describe, expect, it } from 'vitest'
import {
  createToolHarness,
  plantEntity,
  type ToolHarness,
  type ToolHarnessOptions,
} from '../../../../__tests__/support/tool-harness'
import type { SceneDesignObjectTarget } from '../../scene/design-object-targets'

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
})
