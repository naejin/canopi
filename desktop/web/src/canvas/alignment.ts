import Konva from 'konva'
import { MoveNodeCommand, BatchCommand } from './commands'

// ---------------------------------------------------------------------------
// Align & Distribute — operates on selected nodes
// ---------------------------------------------------------------------------

export type Alignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
export type DistributeAxis = 'horizontal' | 'vertical'

/**
 * Align selected nodes to a given edge/center. Returns a BatchCommand for undo.
 */
export function alignNodes(
  nodes: Konva.Node[],
  alignment: Alignment,
): BatchCommand | null {
  if (nodes.length < 2) return null

  // Get bounding rects relative to layer (world coords)
  const rects = nodes.map((n) => ({
    node: n,
    rect: n.getClientRect({ relativeTo: n.getLayer() ?? undefined }),
  }))

  // Compute target from the collective bounding box
  let target: number
  switch (alignment) {
    case 'left':
      target = Math.min(...rects.map((r) => r.rect.x))
      break
    case 'right':
      target = Math.max(...rects.map((r) => r.rect.x + r.rect.width))
      break
    case 'center': {
      const minX = Math.min(...rects.map((r) => r.rect.x))
      const maxX = Math.max(...rects.map((r) => r.rect.x + r.rect.width))
      target = (minX + maxX) / 2
      break
    }
    case 'top':
      target = Math.min(...rects.map((r) => r.rect.y))
      break
    case 'bottom':
      target = Math.max(...rects.map((r) => r.rect.y + r.rect.height))
      break
    case 'middle': {
      const minY = Math.min(...rects.map((r) => r.rect.y))
      const maxY = Math.max(...rects.map((r) => r.rect.y + r.rect.height))
      target = (minY + maxY) / 2
      break
    }
  }

  const cmds: MoveNodeCommand[] = []

  for (const { node, rect } of rects) {
    const from = { x: node.x(), y: node.y() }
    let to = { ...from }

    switch (alignment) {
      case 'left':
        to.x = from.x + (target - rect.x)
        break
      case 'right':
        to.x = from.x + (target - (rect.x + rect.width))
        break
      case 'center':
        to.x = from.x + (target - (rect.x + rect.width / 2))
        break
      case 'top':
        to.y = from.y + (target - rect.y)
        break
      case 'bottom':
        to.y = from.y + (target - (rect.y + rect.height))
        break
      case 'middle':
        to.y = from.y + (target - (rect.y + rect.height / 2))
        break
    }

    if (from.x !== to.x || from.y !== to.y) {
      cmds.push(new MoveNodeCommand(node.id(), from, to))
      node.position(to)
    }
  }

  if (cmds.length === 0) return null
  return new BatchCommand(cmds)
}

/**
 * Distribute selected nodes evenly along an axis. Returns a BatchCommand for undo.
 */
export function distributeNodes(
  nodes: Konva.Node[],
  axis: DistributeAxis,
): BatchCommand | null {
  if (nodes.length < 3) return null

  const rects = nodes.map((n) => ({
    node: n,
    rect: n.getClientRect({ relativeTo: n.getLayer() ?? undefined }),
  }))

  // Sort by position along the axis
  if (axis === 'horizontal') {
    rects.sort((a, b) => a.rect.x - b.rect.x)
  } else {
    rects.sort((a, b) => a.rect.y - b.rect.y)
  }

  const first = rects[0]!
  const last = rects[rects.length - 1]!

  let totalSpan: number
  let totalObjSize: number

  if (axis === 'horizontal') {
    totalSpan = (last.rect.x + last.rect.width) - first.rect.x
    totalObjSize = rects.reduce((sum, r) => sum + r.rect.width, 0)
  } else {
    totalSpan = (last.rect.y + last.rect.height) - first.rect.y
    totalObjSize = rects.reduce((sum, r) => sum + r.rect.height, 0)
  }

  const gap = (totalSpan - totalObjSize) / (rects.length - 1)

  const cmds: MoveNodeCommand[] = []
  let cursor = axis === 'horizontal' ? first.rect.x : first.rect.y

  for (const { node, rect } of rects) {
    const from = { x: node.x(), y: node.y() }
    const to = { ...from }

    if (axis === 'horizontal') {
      to.x = from.x + (cursor - rect.x)
      cursor += rect.width + gap
    } else {
      to.y = from.y + (cursor - rect.y)
      cursor += rect.height + gap
    }

    if (from.x !== to.x || from.y !== to.y) {
      cmds.push(new MoveNodeCommand(node.id(), from, to))
      node.position(to)
    }
  }

  if (cmds.length === 0) return null
  return new BatchCommand(cmds)
}
