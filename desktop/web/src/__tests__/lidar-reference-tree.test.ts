import { describe, expect, it } from 'vitest'
import {
  canMoveReference,
  movedReferenceOrders,
  referenceDrawOrder,
  referenceRows,
} from '../app/lidar/reference-tree'

const node = (id: string, order: number, parentId: string | null = null) => ({ id, order, parentId })

describe('site data tree', () => {
  const nodes = [
    node('ground', 0),
    node('slope', 2, 'ground'),
    node('canopy', 1),
    node('percent', 3, 'ground'),
  ]

  it('lists groups front first with results under their source', () => {
    expect(referenceRows(nodes).map((row) => [row.id, row.depth])).toEqual([
      ['canopy', 0],
      ['ground', 0],
      ['percent', 1],
      ['slope', 1],
    ])
  })

  it('draws results over their source and groups by their root', () => {
    expect(referenceDrawOrder(nodes).map((row) => row.id)).toEqual(['ground', 'slope', 'percent', 'canopy'])
  })

  it('keeps a result whose source is not in the Design at the top level', () => {
    const rows = referenceRows([node('slope', 0, 'elsewhere'), node('canopy', 1)])
    expect(rows.map((row) => [row.id, row.depth])).toEqual([['canopy', 0], ['slope', 0]])
  })

  it('survives a cycle by listing its members at the top level', () => {
    const rows = referenceRows([node('a', 0, 'b'), node('b', 1, 'a')])
    expect(rows.map((row) => row.id).sort()).toEqual(['a', 'b'])
  })

  it('moves a group past its neighbour group and renumbers in drawing order', () => {
    const orders = movedReferenceOrders(nodes, 'ground', 'front')!
    const moved = nodes.map((entry) => ({ ...entry, order: orders.get(entry.id)! }))
    expect(referenceRows(moved).map((row) => row.id)).toEqual(['ground', 'percent', 'slope', 'canopy'])
    expect(referenceDrawOrder(moved).map((row) => row.order)).toEqual([0, 1, 2, 3])
  })

  it('moves a result only among the results of the same source', () => {
    const orders = movedReferenceOrders(nodes, 'slope', 'front')!
    const moved = nodes.map((entry) => ({ ...entry, order: orders.get(entry.id)! }))
    expect(referenceRows(moved).map((row) => row.id)).toEqual(['canopy', 'ground', 'slope', 'percent'])
  })

  it('refuses a move past either end of the siblings', () => {
    expect(movedReferenceOrders(nodes, 'canopy', 'front')).toBeNull()
    expect(movedReferenceOrders(nodes, 'slope', 'back')).toBeNull()
    expect(movedReferenceOrders(nodes, 'missing', 'back')).toBeNull()
    const rows = referenceRows(nodes)
    expect(canMoveReference(rows, 'canopy', 'front')).toBe(false)
    expect(canMoveReference(rows, 'canopy', 'back')).toBe(true)
    expect(canMoveReference(rows, 'percent', 'front')).toBe(false)
    expect(canMoveReference(rows, 'percent', 'back')).toBe(true)
  })

  it('swaps siblings saved with the same order', () => {
    const tied = [node('a', 0), node('b', 0)]
    const orders = movedReferenceOrders(tied, 'b', 'front')!
    const moved = tied.map((entry) => ({ ...entry, order: orders.get(entry.id)! }))
    expect(referenceRows(moved).map((row) => row.id)).toEqual(['b', 'a'])
  })
})
