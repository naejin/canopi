import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createToolHarness,
  rectZone,
  type ToolHarness,
  type ToolHarnessOptions,
} from '../../../../__tests__/support/tool-harness'
import type { ScreenPoint } from '../../view/types'
import { ROTATE_HANDLE_ID, rotationReadout } from './rotate-handle'

const harnesses: ToolHarness[] = []

function harness(options: ToolHarnessOptions = {}): ToolHarness {
  const created = createToolHarness(options)
  harnesses.push(created)
  return created
}

afterEach(() => {
  for (const created of harnesses.splice(0)) created.dispose()
  vi.useRealTimers()
})

/** A bed whose bounds centre, the rotation pivot, is (70, 110); its rotation handle sits 28 px above its top edge. */
function bedHarness(): ToolHarness {
  const h = harness({
    scene: { zones: [rectZone('bed', [{ x: 20, y: 80 }, { x: 120, y: 80 }, { x: 120, y: 140 }, { x: 20, y: 140 }])] },
  })
  h.select({ kind: 'zone', id: 'bed' })
  return h
}

const PIVOT = { x: 70, y: 110 }
const ROTATE = { kind: 'handle', id: ROTATE_HANDLE_ID } as const

/** The screen point at `angleDeg` about the pivot, `radius` px away (the view is 1 px/m at the origin). */
function aroundPivot(angleDeg: number, radius: number): ScreenPoint {
  const radians = (angleDeg * Math.PI) / 180
  return { x: PIVOT.x + Math.cos(radians) * radius, y: PIVOT.y + Math.sin(radians) * radius }
}

describe('Select rotation handle', () => {
  it('shows above a rotatable selection, centred on its top edge', () => {
    const h = bedHarness()

    expect(h.chrome.handles.find((handle) => handle.id === ROTATE_HANDLE_ID)).toMatchObject({
      anchor: { x: 70, y: 80 },
      offsetPx: { x: 0, y: -28 },
      hitRadiusPx: 14,
      glyph: 'rotate',
      label: 'canvas.rotationHandle.label',
    })
  })

  it('the handle sits 28 px above the projected hull', () => {
    vi.useFakeTimers()
    const h = harness({
      camera: { bearingDeg: 45 },
      scene: { zones: [rectZone('bed', [{ x: 20, y: 80 }, { x: 120, y: 80 }, { x: 120, y: 140 }, { x: 20, y: 140 }])] },
    })
    h.select({ kind: 'zone', id: 'bed' })
    /** The handle's centre on screen, and where it belongs: centred 28 px above the screen box of the bounds' four corners. */
    const placement = () => {
      const view = h.view.view()
      const handle = h.chrome.handles.find((entry) => entry.id === ROTATE_HANDLE_ID)!
      const anchor = view.worldToScreen(handle.anchor)
      const hull = view.worldQuadToScreen([{ x: 20, y: 80 }, { x: 120, y: 80 }, { x: 120, y: 140 }, { x: 20, y: 140 }])
      const xs = hull.map((corner) => corner.x)
      return {
        at: { x: anchor.x + handle.offsetPx!.x, y: anchor.y + handle.offsetPx!.y },
        expected: { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: Math.min(...hull.map((corner) => corner.y)) - 28 },
      }
    }

    let { at, expected } = placement()
    expect(at.x).toBeCloseTo(expected.x, 6)
    expect(at.y).toBeCloseTo(expected.y, 6)

    // It follows a turn of the view with the pointer resting on the map.
    h.hover({ x: 10, y: 10 })
    h.view.navigation.rotateBy(1)
    vi.advanceTimersByTime(400)
    expect(h.view.view().camera.bearingDeg).toBe(60);
    ({ at, expected } = placement())
    expect(at.x).toBeCloseTo(expected.x, 6)
    expect(at.y).toBeCloseTo(expected.y, 6)
  })

  it('Shift steps 15 degrees from the press angle', () => {
    const h = bedHarness()
    // A press off the handle's centre, so the press angle is no multiple of 15.
    const pressAngle = Math.atan2(52 - PIVOT.y, 78 - PIVOT.x) * 180 / Math.PI
    expect(pressAngle % 15).not.toBeCloseTo(0)

    h.press({ x: 78, y: 52 }, { target: ROTATE })
    h.move(aroundPivot(pressAngle + 22, 58), { shift: true })
    // Relative steps: 22 degrees turned is 15, whatever the absolute angle.
    expect(h.store.persisted.zones[0]!.rotationDeg).toBe(15)
    h.move(aroundPivot(pressAngle + 38, 58), { shift: true })
    expect(h.store.persisted.zones[0]!.rotationDeg).toBe(45)
    h.move(aroundPivot(pressAngle + 22, 58))
    expect(h.store.persisted.zones[0]!.rotationDeg).toBeCloseTo(22)
    h.release(aroundPivot(pressAngle + 22, 58))

    expect(h.store.persisted.zones[0]!.rotationDeg).toBeCloseTo(22)
    expect(h.undo()).toBe(true)
    expect(h.store.persisted.zones[0]!.rotationDeg).toBe(0)
    expect(h.history.canUndo.value).toBe(false)
  })

  it('the handle reads 0° at its press, then hides with the others while the turn changes the scene', () => {
    const h = bedHarness()
    h.press({ x: 70, y: 52 }, { target: ROTATE })
    expect(h.chrome.activeHandle).toBe(ROTATE_HANDLE_ID)
    expect(h.chrome.handles.find((handle) => handle.id === ROTATE_HANDLE_ID)?.readout).toBe('0°')

    h.move(aroundPivot(0, 58))
    expect(h.store.persisted.zones[0]!.rotationDeg).toBeCloseTo(90)
    expect(h.chrome.handles).toEqual([])

    h.release()
    expect(h.chrome.handles.find((handle) => handle.id === ROTATE_HANDLE_ID)?.readout).toBeUndefined()
    expect(h.chrome.activeHandle).toBeNull()
  })

  it('the readout is the whole degrees turned, signed', () => {
    expect(rotationReadout(90)).toBe('+90°')
    expect(rotationReadout(15)).toBe('+15°')
    expect(rotationReadout(0.4)).toBe('0°')
    expect(rotationReadout(-30.4)).toBe('-30°')
  })

  it('a turn of a quarter degree or less commits nothing', () => {
    const h = bedHarness()

    h.press({ x: 70, y: 52 }, { target: ROTATE })
    h.move({ x: 70.1, y: 52 })
    h.release()

    expect(h.store.persisted.zones[0]!.rotationDeg).toBe(0)
    expect(h.history.canUndo.value).toBe(false)
  })
})
