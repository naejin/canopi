import { describe, expect, it } from 'vitest'
import type { CanvasPrintSnapshot } from '../../canvas/print'
import { areaFromFrame, areaToFrame, layoutAngle, pageFrame, turnSnapshot } from './page-frame'

const snapshot: CanvasPrintSnapshot = {
  layers: [{ name: 'plants', visible: true, opacity: 1 }],
  plants: [{ id: 'p', canonicalName: 'Malus domestica', position: { x: 10, y: 0 }, color: '#123456', symbol: 'round', mark: [], pinnedName: false }],
  zones: [
    { name: 'Bed', path: 'M0 0 L10 0 L10 4 L0 4 Z', fill: null, bounds: { x: 0, y: 0, width: 10, height: 4 },
      geometry: { kind: 'rect', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 0, y: 4 }] } },
    { name: 'Pond', path: 'M2 0 C2 1 1 2 0 2 Z', fill: '#aabbcc', bounds: { x: -2, y: -1, width: 4, height: 2 },
      geometry: { kind: 'ellipse', center: { x: 0, y: 0 }, radii: { x: 2, y: 1 }, rotation: 30 } },
  ],
  annotations: [{ id: 'n', position: { x: 0, y: -10 }, text: 'Level on screen', fontSize: 14, rotation: 30 }],
  measurements: [{ id: 'm', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }],
}
const turned = (x: number, y: number, angle: number) => {
  const a = angle * Math.PI / 180
  return { x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) }
}
const close = (actual: { x: number; y: number }, expected: { x: number; y: number }) => {
  expect(actual.x).toBeCloseTo(expected.x, 6); expect(actual.y).toBeCloseTo(expected.y, 6)
}

describe('PDF page frame', () => {
  it('a layout at 30 turns the snapshot by −30 about the layout pivot', () => {
    const frame = pageFrame(30)
    expect(frame.angleDeg).toBe(30)
    const result = turnSnapshot(snapshot, frame)
    close(result.plants[0]!.position, turned(10, 0, -30))
    close(result.measurements[0]!.end, turned(10, 0, -30))
    close(result.measurements[0]!.start, { x: 0, y: 0 })
    // A note level on a screen turned to 30 is level on the page.
    expect(result.annotations[0]!.rotation).toBeCloseTo(0, 6)
    close(result.annotations[0]!.position, turned(0, -10, -30))
    const [bed, pond] = result.zones
    const corners = [[0, 0], [10, 0], [10, 4], [0, 4]].map(([x, y]) => turned(x!, y!, -30))
    if (bed!.geometry.kind !== 'rect') throw new Error('rect expected')
    bed!.geometry.points.forEach((point, i) => close(point, corners[i]!))
    // Every coordinate pair of the path turns.
    const numbers = bed!.path.match(/-?[\d.]+(?:e-?\d+)?/g)!.map(Number)
    const pairs = Array.from({ length: numbers.length / 2 }, (_, i) => ({ x: numbers[2 * i]!, y: numbers[2 * i + 1]! }))
    expect(pairs).toHaveLength(4)
    pairs.forEach((pair, i) => close(pair, corners[i]!))
    const xs = corners.map(p => p.x), ys = corners.map(p => p.y)
    expect(bed!.bounds.x).toBeCloseTo(Math.min(...xs), 6)
    expect(bed!.bounds.y).toBeCloseTo(Math.min(...ys), 6)
    expect(bed!.bounds.width).toBeCloseTo(Math.max(...xs) - Math.min(...xs), 6)
    expect(bed!.bounds.height).toBeCloseTo(Math.max(...ys) - Math.min(...ys), 6)
    if (pond!.geometry.kind !== 'ellipse') throw new Error('ellipse expected')
    expect(pond!.geometry.rotation).toBeCloseTo(0, 6)
    expect(pond!.bounds.width).toBeCloseTo(4, 6)
    expect(pond!.bounds.height).toBeCloseTo(2, 6)
    expect(pond!.path.startsWith('M')).toBe(true)
    close({ x: Number(pond!.path.split(/[ MC]/).filter(Boolean)[0]), y: Number(pond!.path.split(/[ MC]/).filter(Boolean)[1]) }, turned(2, 0, -30))
    // Turning back restores the plan: the frame is a rotation about the plan origin.
    close(frame.fromFrame(result.plants[0]!.position), { x: 10, y: 0 })
    // An area keeps its size along the page axes and turns about its own centre.
    const area = { x: 4, y: -1, width: 6, height: 2 }
    const onPage = areaToFrame(frame, area)
    expect(onPage.width).toBe(6); expect(onPage.height).toBe(2)
    close({ x: onPage.x + 3, y: onPage.y + 1 }, turned(7, 0, -30))
    const back = areaFromFrame(frame, onPage)
    close(back, area)
    expect(back.width).toBe(6); expect(back.height).toBe(2)
  })

  it('a North up layout has angle 0 and an unchanged snapshot', () => {
    expect(layoutAngle({}, { viewBearingDeg: 30 })).toBe(0)
    expect(layoutAngle({ mapOrientation: 'north-up' }, { viewBearingDeg: 30 })).toBe(0)
    expect(layoutAngle({ mapOrientation: 'as-on-screen' }, { viewBearingDeg: 30 })).toBe(30)
    for (const angle of [0, 360, -360]) {
      const frame = pageFrame(angle)
      expect(frame.angleDeg).toBe(0)
      expect(turnSnapshot(snapshot, frame)).toBe(snapshot)
      const area = { x: .1, y: .7, width: .3, height: .9 }
      expect(areaToFrame(frame, area)).toBe(area)
      expect(areaFromFrame(frame, area)).toBe(area)
    }
    expect(pageFrame(-30).angleDeg).toBe(330)
  })
})
