import type { ScenePlantEntity, ScenePoint } from './scene'

interface Node { point: ScenePoint; axis: 'x' | 'y'; left: Node | null; right: Node | null }
interface SpacingIndex { tree: Node | null; distances: ReadonlyMap<string, number> }
const indices = new WeakMap<readonly ScenePlantEntity[], SpacingIndex>()
const key = (point: ScenePoint) => `${point.x}:${point.y}`

/** Immutable Scene plant arrays own the cache; coincident centres share a footprint. */
export function nearestPlantSpacing(plants: readonly ScenePlantEntity[], point: ScenePoint): number {
  let index = indices.get(plants)
  if (!index) {
    const points = [...new Map(plants.map((plant) => [key(plant.position), plant.position])).values()]
    const tree = buildTree(points, 0)
    index = { tree, distances: new Map(points.map((entry) => [key(entry), Math.sqrt(nearestSquared(tree, entry, Infinity))])) }
    indices.set(plants, index)
  }
  // Placement previews may not yet belong to the Scene.
  return index.distances.get(key(point)) ?? Math.sqrt(nearestSquared(index.tree, point, Infinity))
}

function buildTree(points: ScenePoint[], depth: number): Node | null {
  if (!points.length) return null
  const axis = depth % 2 === 0 ? 'x' : 'y'
  points.sort((a, b) => a[axis] - b[axis])
  const middle = Math.floor(points.length / 2)
  return { point: points[middle]!, axis, left: buildTree(points.slice(0, middle), depth + 1), right: buildTree(points.slice(middle + 1), depth + 1) }
}

function nearestSquared(node: Node | null, point: ScenePoint, best: number): number {
  if (!node) return best
  const dx = node.point.x - point.x, dy = node.point.y - point.y
  const squared = dx * dx + dy * dy
  if (squared > 0) best = Math.min(best, squared)
  const delta = point[node.axis] - node.point[node.axis]
  best = nearestSquared(delta < 0 ? node.left : node.right, point, best)
  if (delta * delta < best) best = nearestSquared(delta < 0 ? node.right : node.left, point, best)
  return best
}
