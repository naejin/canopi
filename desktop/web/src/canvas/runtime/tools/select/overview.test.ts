import { afterEach, describe, expect, it } from 'vitest'
import {
  createToolHarness,
  plantEntity,
  rectZone,
  textNote,
  type ToolHarness,
  type ToolHarnessOptions,
} from '../../../../__tests__/support/tool-harness'
import type { SceneDesignObjectTarget } from '../../scene/design-object-targets'
import '../../../../__tests__/support/camera-tolerance'

const harnesses: ToolHarness[] = []

afterEach(() => {
  for (const created of harnesses.splice(0)) created.dispose()
})

/** Overview at 0.05 px/m: the world's origin at the screen's (0, 0), 20 m per pixel. */
const OVERVIEW = { x: 0, y: 0, scale: 0.05 }
const BED: SceneDesignObjectTarget = { kind: 'zone', id: 'bed' }
const POND: SceneDesignObjectTarget = { kind: 'zone', id: 'pond' }
const NOTE: SceneDesignObjectTarget = { kind: 'annotation', id: 'note' }

/** In world metres: a bed with an apple in it, a pond, a note; on screen at 0.05 px/m the bed spans (5, 5)–(25, 25). */
function site(options: ToolHarnessOptions = {}): ToolHarness {
  const h = createToolHarness({
    viewport: OVERVIEW,
    scene: {
      zones: [
        rectZone('bed', [{ x: 100, y: 100 }, { x: 500, y: 100 }, { x: 500, y: 500 }, { x: 100, y: 500 }]),
        rectZone('pond', [{ x: 1000, y: 100 }, { x: 1400, y: 100 }, { x: 1400, y: 500 }, { x: 1000, y: 500 }]),
      ],
      plants: [plantEntity('apple', 'Malus domestica', { x: 300, y: 300 })],
      annotations: [textNote('note', { x: 3000, y: 3000 }, 'Gate')],
    },
    ...options,
  })
  harnesses.push(h)
  return h
}

describe('overview selection (spec §3.2, the host half)', () => {
  it('a click selects the zone under a hidden plant and empty ground clears, with no history', () => {
    const h = site()

    h.click({ x: 15, y: 15 })
    expect(h.store.session.selectedTargets).toEqual([BED])

    h.click({ x: 300, y: 250 })
    expect(h.store.session.selectedTargets).toEqual([])
    expect(h.history.canUndo.value).toBe(false)
  })

  it('Shift or mod toggles, Alt removes; a double-click is a click', () => {
    const h = site()

    h.click({ x: 15, y: 15 })
    h.click({ x: 60, y: 15 }, { mods: { shift: true } })
    expect(h.store.session.selectedTargets).toEqual([BED, POND])
    h.click({ x: 15, y: 15 }, { mods: { alt: true } })
    expect(h.store.session.selectedTargets).toEqual([POND])
    h.click({ x: 60, y: 15 }, { mods: { ctrl: true }, clickCount: 2 })
    expect(h.store.session.selectedTargets).toEqual([])
  })

  it('a drag bands zones and notes, never plants, and moves nothing', () => {
    const h = site()

    // From empty ground well clear of every outline (an outline's 6 px are 120 m here).
    h.press({ x: 180, y: 2 })
    h.move({ x: 100, y: 100 })
    expect(h.renderer.lastDraft()?.shapes[0]).toMatchObject({ kind: 'quad' })
    h.move({ x: 0, y: 200 })
    h.release()

    expect(h.store.session.selectedTargets).toEqual([BED, POND, NOTE])
    expect(h.renderer.lastDraft()).toBeNull()
    expect(h.store.persisted.zones[0]!.points[0]).toEqual({ x: 100, y: 100 })
    expect(h.history.canUndo.value).toBe(false)
  })

  it('a drawing tool stays armed and draws nothing: its press selects', () => {
    const h = site({ tool: 'rectangle' })

    h.drag({ x: 35, y: 35 }, { x: 2, y: 2 })
    expect(h.history.canUndo.value).toBe(false)
    expect(h.store.persisted.zones).toHaveLength(2)
    expect(h.store.session.selectedTargets).toEqual([BED])
    expect(h.toolState.peek()).toBe('rectangle')
  })

  it('leaving overview mid-band drops the band and selects nothing', () => {
    const h = site()
    h.press({ x: 180, y: 2 })
    h.move({ x: 100, y: 100 })

    h.view.setViewport({ x: 0, y: 0, scale: 1 })
    expect(h.renderer.lastDraft()).toBeNull()
    expect(h.host.hasLiveGesture()).toBe(false)
    h.release()
    expect(h.store.session.selectedTargets).toEqual([])
  })
})
