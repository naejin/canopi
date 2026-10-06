import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createToolHarness,
  measurementGuide,
  rectZone,
  type ToolHarness,
} from '../../../../__tests__/support/tool-harness'
import type { ToolHandleId } from '../../interaction-types'
import type { ScreenPoint, WorldPoint } from '../../view/types'
import '../../../../__tests__/support/camera-tolerance'

const harnesses: ToolHarness[] = []

afterEach(() => {
  for (const created of harnesses.splice(0)) created.dispose()
})

/**
 * The drag of one point handle under Select, for a rectangle's corner (tools/select/reshape.ts) and a guide's end
 * (tools/select/guide-ends.ts): the successors of today's control-point overlays.
 */
const cases = [
  {
    label: 'Zone',
    handle: 'rect-corner:zone-1:se' as ToolHandleId,
    start: { x: 60, y: 50 },
    create: () => createToolHarness({
      scene: { zones: [rectZone('zone-1', [{ x: 10, y: 10 }, { x: 60, y: 10 }, { x: 60, y: 50 }, { x: 10, y: 50 }])] },
    }),
    select: (h: ToolHarness) => h.select({ kind: 'zone', id: 'zone-1' }),
    draggedPoint: (h: ToolHarness): WorldPoint => h.store.persisted.zones[0]!.points[2]!,
  },
  {
    label: 'Measurement Guide',
    handle: 'guide-end:guide-1:b' as ToolHandleId,
    start: { x: 60, y: 10 },
    create: () => createToolHarness({
      scene: { measurementGuides: [measurementGuide('guide-1', { x: 10, y: 10 }, { x: 60, y: 10 })] },
    }),
    select: (h: ToolHarness) => h.select({ kind: 'measurement-guide', id: 'guide-1' }),
    draggedPoint: (h: ToolHarness): WorldPoint => h.store.persisted.measurementGuides[0]!.end,
  },
] as const

describe.each(cases)('$label point handle drags', ({ handle, start, create, select, draggedPoint }) => {
  function harness(): ToolHarness {
    const created = create()
    harnesses.push(created)
    select(created)
    return created
  }

  function pressHandle(h: ToolHarness, at: ScreenPoint = start): void {
    h.press(at, { target: { kind: 'handle', id: handle } })
  }

  it('shows the handle on the selected object and none once it is deselected', () => {
    const h = harness()
    expect(h.chrome.handles.map((entry) => entry.id)).toContain(handle)
    expect(h.chrome.handles.find((entry) => entry.id === handle)?.anchor).toEqual(start)

    h.select()
    expect(h.chrome.handles).toEqual([])
  })

  it('a handle the selection no longer owns begins no Scene Edit', () => {
    const h = harness()
    const begin = vi.spyOn(h.edits, 'begin')
    pressHandle(h)
    h.release()
    expect(begin).toHaveBeenCalledTimes(1)

    // The handle list is refreshed when the selection changes; a press on a stale id starts nothing.
    h.store.setSelection([])
    begin.mockClear()
    pressHandle(h)
    h.move({ x: 90, y: 70 })
    h.release()
    expect(begin).not.toHaveBeenCalled()
    expect(draggedPoint(h)).toEqual(start)
  })

  it('a drag within 2 px of the press changes nothing and records no history', () => {
    const h = harness()

    pressHandle(h)
    h.move({ x: start.x + 1, y: start.y })
    h.release({ x: start.x + 1, y: start.y })

    expect(draggedPoint(h)).toEqual(start)
    expect(h.history.canUndo.value).toBe(false)
    expect(h.host.hasLiveGesture()).toBe(false)
  })

  it('the release point is applied and commits one changed edit', () => {
    const h = harness()

    pressHandle(h)
    h.move({ x: 80, y: 60 })
    h.release({ x: 90, y: 70 })

    expect(draggedPoint(h)).toEqual({ x: 90, y: 70 })
    expect(h.history.canUndo.value).toBe(true)
    expect(h.undo()).toBe(true)
    expect(draggedPoint(h)).toEqual(start)
    expect(h.history.canUndo.value).toBe(false)
  })

  it('a cancelled drag rolls back its live change without history', () => {
    const h = harness()

    pressHandle(h)
    h.move({ x: 90, y: 70 })
    expect(draggedPoint(h)).toEqual({ x: 90, y: 70 })
    h.cancel('pointercancel')

    expect(draggedPoint(h)).toEqual(start)
    expect(h.history.canUndo.value).toBe(false)
    expect(h.host.hasLiveGesture()).toBe(false)
  })

  it('disposing the host mid-drag rolls the object back and removes the handles', () => {
    const h = harness()

    pressHandle(h)
    h.move({ x: 90, y: 70 })
    expect(draggedPoint(h)).toEqual({ x: 90, y: 70 })
    h.dispose()
    harnesses.splice(harnesses.indexOf(h), 1)

    expect(draggedPoint(h)).toEqual(start)
    expect(h.history.canUndo.value).toBe(false)
    expect(h.chrome.handles).toEqual([])
  })
})

describe('the rotation handle during a zone corner press', () => {
  it('a corner press hides the rotation handle at once and keeps the corners; its release shows it again', () => {
    const h = cases[0].create()
    harnesses.push(h)
    cases[0].select(h)
    const shown = h.chrome.handles.map((entry) => entry.id)
    expect(shown).toContain('rotate')

    // Today's control-point press hid the rotation handle in its drag presentation, before any move.
    h.press(cases[0].start, { target: { kind: 'handle', id: cases[0].handle } })
    expect(h.chrome.handles.map((entry) => entry.id)).toEqual(shown.filter((id) => id !== 'rotate'))
    expect(h.chrome.activeHandle).toBe(cases[0].handle)
    h.release()
    expect(h.chrome.handles.map((entry) => entry.id)).toEqual(shown)

    h.press(cases[0].start, { target: { kind: 'handle', id: cases[0].handle } })
    h.cancel('pointercancel')
    expect(h.chrome.handles.map((entry) => entry.id)).toEqual(shown)
  })
})
