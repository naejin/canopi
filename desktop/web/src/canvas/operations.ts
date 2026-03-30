import Konva from 'konva'
import type { CanvasEngine } from './engine'

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

export interface SimpleRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Compute the normalized selection rectangle from two arbitrary corner points.
 * Always returns a rect with non-negative width/height regardless of drag direction.
 */
export function computeSelectionRect(
  start: { x: number; y: number },
  end: { x: number; y: number },
): SimpleRect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  }
}

function rectsIntersect(a: SimpleRect, b: SimpleRect): boolean {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  )
}

// ---------------------------------------------------------------------------
// Spatial query
// ---------------------------------------------------------------------------

/**
 * Find all nodes in visible, unlocked layers whose bounding rect intersects
 * with the given world-space selection rectangle.
 *
 * Both the rubber band and this function work in world (canvas) coordinates —
 * the same space returned by `stage.getRelativePointerPosition()`. Node rects
 * are obtained via `getClientRect()` (absolute screen pixels) and then
 * converted to world coords using the stage's current scale and position.
 */
export function nodesInRect(
  engine: CanvasEngine,
  rect: SimpleRect,
  lockedIds: Set<string>,
): Konva.Node[] {
  const result: Konva.Node[] = []

  const scale = engine.stage.scaleX()
  const stagePos = engine.stage.position()

  for (const [, layer] of engine.layers) {
    if (!layer.visible()) continue

    layer.find('.shape').forEach((node) => {
      if (lockedIds.has(node.id())) return

      // getClientRect() returns absolute screen-pixel coordinates. Convert to
      // world coords so they match the rubber-band rect (world space).
      const sr = node.getClientRect()
      const worldRect: SimpleRect = {
        x: (sr.x - stagePos.x) / scale,
        y: (sr.y - stagePos.y) / scale,
        width: sr.width / scale,
        height: sr.height / scale,
      }
      if (rectsIntersect(rect, worldRect)) {
        result.push(node)
      }
    })
  }

  return result
}

// ---------------------------------------------------------------------------
// Serialization — minimal attrs only, no IDs (they are re-generated on paste)
// ---------------------------------------------------------------------------

export interface SerializedNode {
  className: string
  attrs: Record<string, unknown>
}

// Attrs we always strip before serializing (re-generated or tool-specific)
const STRIP_ATTRS = new Set([
  'id', 'shadowColor', 'shadowBlur', 'shadowOpacity', 'shadowForStrokeEnabled',
  'data-highlight', 'data-orig-stroke', 'data-orig-strokeWidth',
])

export function serializeNodes(nodes: Konva.Node[]): string {
  const data: SerializedNode[] = nodes.map((node) => {
    const raw = node.attrs as Record<string, unknown>
    const attrs: Record<string, unknown> = {}
    for (const key of Object.keys(raw)) {
      if (!STRIP_ATTRS.has(key)) {
        attrs[key] = raw[key]
      }
    }
    return {
      className: node.getClassName(),
      attrs,
    }
  })
  return JSON.stringify(data)
}

export function deserializeNodes(json: string): SerializedNode[] {
  try {
    return JSON.parse(json) as SerializedNode[]
  } catch {
    return []
  }
}
