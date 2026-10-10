import { describe, expect, it } from 'vitest'
import { snapWorldPoint } from './snapping'

describe('tool snapping', () => {
  it('returns the point itself when grid snapping is off', () => {
    const point = { x: 1.234, y: 5.678 }

    expect(snapWorldPoint(point, { grid: false }, 1)).toBe(point)
  })

  it('snaps to the grid interval the frame scale gives, as the grid draws it', () => {
    // At 1 px/m the minor grid is 20 m, at 2 px/m 10 m, at 4 px/m 5 m (canvas/grid.ts, 20 px minimum gap).
    expect(snapWorldPoint({ x: 11, y: 29 }, { grid: true }, 1)).toEqual({ x: 20, y: 20 })
    expect(snapWorldPoint({ x: 11, y: 29 }, { grid: true }, 2)).toEqual({ x: 10, y: 30 })
    expect(snapWorldPoint({ x: 11, y: 29 }, { grid: true }, 4)).toEqual({ x: 10, y: 30 })
  })
})
