/**
 * The Design's site data as a tree: a derived result nests under the item it
 * was calculated from (its first input) when that item is in the same Design.
 *
 * Saved `order` ranks an entry among its siblings only. The tree decides the
 * map's drawing order: groups stack by their root's order, and inside a group
 * results draw over the item they come from, so a slope is never hidden under
 * its own terrain. Order is display order only; it never changes an item's
 * source priority or values.
 */
export interface ReferenceNode {
  readonly id: string
  readonly order: number
  /** The in-Design item this one nests under; null for a top-level row. */
  readonly parentId: string | null
}

export type ReferenceRow<T extends ReferenceNode> = T & {
  /** Nesting depth: 0 for a top-level row. */
  readonly depth: number
}

/** Rows as Layers lists them: front first, each followed by its results. */
export function referenceRows<T extends ReferenceNode>(nodes: readonly T[]): ReferenceRow<T>[] {
  return walk(nodes, 'front-first')
}

/** Items back to front, the order the map draws them. */
export function referenceDrawOrder<T extends ReferenceNode>(nodes: readonly T[]): ReferenceRow<T>[] {
  return walk(nodes, 'back-first')
}

/**
 * The saved orders after moving one row one place towards the front or back
 * among its siblings, renumbered densely in drawing order; null when the row
 * is already at that end or is not listed.
 */
export function movedReferenceOrders<T extends ReferenceNode>(
  nodes: readonly T[],
  id: string,
  towards: 'front' | 'back',
): Map<string, number> | null {
  const rows = referenceRows(nodes)
  const row = rows.find((candidate) => candidate.id === id)
  if (!row) return null
  const siblings = rows.filter((candidate) => candidate.parentId === row.parentId && candidate.depth === row.depth)
  const index = siblings.findIndex((candidate) => candidate.id === id)
  const target = towards === 'front' ? index - 1 : index + 1
  if (target < 0 || target >= siblings.length) return null
  // Re-rank the siblings in their new list order (front first), then
  // renumber everything densely in drawing order.
  const reordered = siblings.map((sibling) => sibling.id)
  reordered[index] = siblings[target]!.id
  reordered[target] = id
  const ranks = new Map(reordered.map((sibling, position) => [sibling, reordered.length - 1 - position]))
  const moved = nodes.map((node) => ranks.has(node.id) ? { ...node, order: ranks.get(node.id)! } : node)
  return new Map(referenceDrawOrder(moved).map((node, position) => [node.id, position]))
}

/** Whether a row can move one place towards the front or back among its siblings. */
export function canMoveReference<T extends ReferenceNode>(
  rows: readonly ReferenceRow<T>[],
  id: string,
  towards: 'front' | 'back',
): boolean {
  const row = rows.find((candidate) => candidate.id === id)
  if (!row) return false
  const siblings = rows.filter((candidate) => candidate.parentId === row.parentId && candidate.depth === row.depth)
  const index = siblings.findIndex((candidate) => candidate.id === id)
  return towards === 'front' ? index > 0 : index < siblings.length - 1
}

function walk<T extends ReferenceNode>(nodes: readonly T[], direction: 'front-first' | 'back-first'): ReferenceRow<T>[] {
  const ids = new Set(nodes.map((node) => node.id))
  const children = new Map<string | null, T[]>()
  for (const node of nodes) {
    const parent = node.parentId !== null && node.parentId !== node.id && ids.has(node.parentId) ? node.parentId : null
    children.set(parent, [...(children.get(parent) ?? []), node])
  }
  const sign = direction === 'front-first' ? -1 : 1
  const rows: ReferenceRow<T>[] = []
  const visited = new Set<string>()
  const visit = (parent: string | null, depth: number) => {
    const siblings = [...(children.get(parent) ?? [])].sort((left, right) =>
      sign * (left.order - right.order) || left.id.localeCompare(right.id))
    for (const node of siblings) {
      if (visited.has(node.id)) continue
      visited.add(node.id)
      rows.push({ ...node, depth })
      visit(node.id, depth + 1)
    }
  }
  visit(null, 0)
  // A cycle has no root: list whatever it left out at the top level.
  for (const node of nodes) {
    if (!visited.has(node.id)) {
      visited.add(node.id)
      rows.push({ ...node, parentId: null, depth: 0 })
    }
  }
  return rows
}
