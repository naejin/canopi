import { describe, expect, it } from 'vitest'
import type { Guide } from '../../guides'
import { snapWorldPoint } from './snapping'

const GUIDES: readonly Guide[] = [
  { id: 'v', axis: 'v', position: 3 },
  { id: 'h', axis: 'h', position: 7 },
]

describe('tool snapping', () => {
  it('returns the point itself when grid and guide snapping are off', () => {
    const point = { x: 1.234, y: 5.678 }

    expect(snapWorldPoint(point, { grid: false, guides: false }, 1, GUIDES)).toBe(point)
  })

  it('snaps to the grid interval the frame scale gives, as the grid draws it', () => {
    // At 1 px/m the minor grid is 20 m, at 2 px/m 10 m, at 4 px/m 5 m (canvas/grid.ts, 20 px minimum gap).
    expect(snapWorldPoint({ x: 11, y: 29 }, { grid: true, guides: false }, 1, [])).toEqual({ x: 20, y: 20 })
    expect(snapWorldPoint({ x: 11, y: 29 }, { grid: true, guides: false }, 2, [])).toEqual({ x: 10, y: 30 })
    expect(snapWorldPoint({ x: 11, y: 29 }, { grid: true, guides: false }, 4, [])).toEqual({ x: 10, y: 30 })
  })

  it('snaps to a ruler guide within 8 px at the frame scale, axis by axis', () => {
    // 8 px at 2 px/m is 4 m: x 6.5 is 3.5 m from the vertical guide, y 12 is 5 m from the horizontal one.
    expect(snapWorldPoint({ x: 6.5, y: 12 }, { grid: false, guides: true }, 2, GUIDES)).toEqual({ x: 3, y: 12 })
  })

  it('snaps to the grid first, then to the guides', () => {
    // The grid (5 m at 4 px/m) moves x 4.2 to 5, then the off-grid guide at 4.5 (0.5 m, 2 px away) takes it: the guide wins.
    const guides: readonly Guide[] = [{ id: 'v', axis: 'v', position: 4.5 }]
    expect(snapWorldPoint({ x: 4.2, y: 7.4 }, { grid: true, guides: true }, 4, guides)).toEqual({ x: 4.5, y: 5 })
  })

  it('leaves guide snapping out when the Design has no guides', () => {
    expect(snapWorldPoint({ x: 4.2, y: 7.4 }, { grid: false, guides: true }, 4, [])).toEqual({ x: 4.2, y: 7.4 })
  })
})
