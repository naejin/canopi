interface SpacingPoint { readonly x: number; readonly y: number }
interface PositionedPlant { readonly position: SpacingPoint }

interface Node { point: SpacingPoint; axis: 'x' | 'y'; left: Node | null; right: Node | null }
interface SpacingIndex { tree: Node | null; distances: ReadonlyMap<string, number> }
const indices = new WeakMap<readonly PositionedPlant[], SpacingIndex>()
// Scene reads clone arrays. Retain only a few recent geometries (including drag
// previews) so equivalent snapshots can share the expensive tree and distances.
const recentIndices: { positions: readonly SpacingPoint[]; index: SpacingIndex }[] = []
const MAX_RECENT_GEOMETRIES = 4
const key = (point: SpacingPoint) => `${point.x}:${point.y}`

/** Immutable plant arrays own the cache; coincident centres share a footprint. */
export function nearestPlantSpacing(plants: readonly PositionedPlant[], point: SpacingPoint): number {
  let index = indices.get(plants)
  if (!index) {
    const match = recentIndices.findIndex(({ positions }) => positions.length === plants.length
      && positions.every((position, i) => position.x === plants[i]!.position.x && position.y === plants[i]!.position.y))
    const cached = match < 0 ? undefined : recentIndices.splice(match, 1)[0]
    index = cached?.index
    if (!index) {
      // Own coordinates: mutating a caller's defensive snapshot must never
      // corrupt the index subsequently reused by another snapshot.
      const points = [...new Map(plants.map((plant) => [key(plant.position), { ...plant.position }])).values()]
      const tree = buildTree(points, 0)
      index = { tree, distances: new Map(points.map((entry) => [key(entry), Math.sqrt(nearestSquared(tree, entry, Infinity))])) }
    }
    recentIndices.unshift(cached ?? { positions: plants.map((plant) => ({ ...plant.position })), index })
    if (recentIndices.length > MAX_RECENT_GEOMETRIES) recentIndices.pop()
    indices.set(plants, index)
  }
  // Placement previews may not yet belong to the source.
  return index.distances.get(key(point)) ?? Math.sqrt(nearestSquared(index.tree, point, Infinity))
}

function buildTree(points: SpacingPoint[], depth: number): Node | null {
  if (!points.length) return null
  const axis = depth % 2 === 0 ? 'x' : 'y'
  points.sort((a, b) => a[axis] - b[axis])
  const middle = Math.floor(points.length / 2)
  return { point: points[middle]!, axis, left: buildTree(points.slice(0, middle), depth + 1), right: buildTree(points.slice(middle + 1), depth + 1) }
}

function nearestSquared(node: Node | null, point: SpacingPoint, best: number): number {
  if (!node) return best
  const dx = node.point.x - point.x, dy = node.point.y - point.y
  const squared = dx * dx + dy * dy
  if (squared > 0) best = Math.min(best, squared)
  const delta = point[node.axis] - node.point[node.axis]
  best = nearestSquared(delta < 0 ? node.left : node.right, point, best)
  if (delta * delta < best) best = nearestSquared(delta < 0 ? node.right : node.left, point, best)
  return best
}
