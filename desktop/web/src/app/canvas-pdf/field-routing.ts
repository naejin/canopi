import type { PrintPoint as Point } from '../../canvas/print'
import { distance, type Segment } from './field-geometry'
import type { FieldSpace } from './field-placement'

interface Node { x: number; y: number; cost: number; score: number; parent?: Node }

/** A bounded physical search. Failure leaves the caller free to use a local label. */
export function orthogonalRoute(space: FieldSpace, start: Point, end: Point, ids: readonly string[], budget = { remaining: 12000 }): Segment[] | null {
  const step = .45, queue: Node[] = [], costs = new Map<string, number>()
  const at = (n: Node): Point => ({ x: start.x + n.x * step, y: start.y + n.y * step })
  // Retain the true starting marker exemption even while testing a distant edge.
  const clear = (a: Point, b: Point) => space.pathClear([{ a: start, b: start }, { a, b }], ids)
  const push = (node: Node) => {
    let i = queue.length; queue.push(node)
    while (i) { const parent = (i - 1) >> 1; if (queue[parent]!.score <= node.score) break; queue[i] = queue[parent]!; i = parent }
    queue[i] = node
  }
  const pop = (): Node => {
    const first = queue[0]!, last = queue.pop()!
    if (queue.length) {
      let i = 0
      while (2 * i + 1 < queue.length) {
        let child = 2 * i + 1
        if (child + 1 < queue.length && queue[child + 1]!.score < queue[child]!.score) child++
        if (queue[child]!.score >= last.score) break
        queue[i] = queue[child]!; i = child
      }
      queue[i] = last
    }
    return first
  }
  push({ x: 0, y: 0, cost: 0, score: 0 }); costs.set('0,0', 0)
  for (let visited = 0; queue.length && visited < 12000 && budget.remaining > 0; visited++, budget.remaining--) {
    const node = pop(), position = at(node)
    if (costs.get(`${node.x},${node.y}`) !== node.cost) continue
    for (const corner of [{ x: position.x, y: end.y }, { x: end.x, y: position.y }]) {
      if (!clear(position, corner) || !clear(corner, end)) continue
      const points = [position, corner, end]
      for (let parent = node.parent; parent; parent = parent.parent) points.unshift(at(parent))
      const compact: Point[] = []
      for (const point of points) {
        const a = compact[compact.length - 2], b = compact[compact.length - 1]
        if (b && distance(b, point) < 1e-8) continue
        if (a && b && (Math.abs(a.x - b.x) < 1e-8 && Math.abs(b.x - point.x) < 1e-8
          || Math.abs(a.y - b.y) < 1e-8 && Math.abs(b.y - point.y) < 1e-8)) compact.pop()
        compact.push(point)
      }
      return compact.slice(1).map((b, i) => ({ a: compact[i]!, b }))
    }
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
      const next = { x: node.x + dx, y: node.y + dy, cost: node.cost + step, score: 0, parent: node }, point = at(next)
      if (point.x < Math.min(start.x, end.x) - 8 || point.x > Math.max(start.x, end.x) + 8
        || point.y < Math.min(start.y, end.y) - 8 || point.y > Math.max(start.y, end.y) + 8) continue
      const key = `${next.x},${next.y}`
      if (next.cost >= (costs.get(key) ?? Infinity) || !clear(position, point)) continue
      costs.set(key, next.cost)
      next.score = next.cost + Math.abs(point.x - end.x) + Math.abs(point.y - end.y)
      push(next)
    }
  }
  return null
}
