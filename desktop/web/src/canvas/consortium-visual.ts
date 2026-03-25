import Konva from 'konva'
import type { CanvasEngine } from './engine'
import type { Consortium } from '../types/design'

// ---------------------------------------------------------------------------
// Consortium visual — dashed convex hull boundary around member plants
// ---------------------------------------------------------------------------

const HULL_STROKE = 'rgba(45, 95, 63, 0.6)'
const HULL_FILL = 'rgba(45, 95, 63, 0.05)'
const HULL_DASH = [10, 5]
const HULL_PADDING = 15 // world-unit padding around the hull

/**
 * Render consortium boundaries on the zones layer.
 * Call after loading a design or after consortium membership changes.
 */
export function renderConsortiumBoundaries(
  engine: CanvasEngine,
  consortiums: Consortium[],
): void {
  const zonesLayer = engine.layers.get('zones')
  const plantsLayer = engine.layers.get('plants')
  if (!zonesLayer || !plantsLayer) return

  // Remove existing consortium boundaries
  zonesLayer.find('.consortium-hull').forEach((n: Konva.Node) => n.destroy())

  for (const consortium of consortiums) {
    if (consortium.plant_ids.length < 2) continue

    // Find plant positions — use absolute position to handle grouped plants
    const positions: { x: number; y: number }[] = []
    for (const plantId of consortium.plant_ids) {
      const node = plantsLayer.findOne('#' + plantId)
      if (node) {
        const abs = node.getAbsolutePosition(plantsLayer)
        positions.push({ x: abs.x, y: abs.y })
      }
    }

    if (positions.length < 2) continue

    const hull = convexHull(positions)
    if (hull.length < 3) continue

    // Expand hull by padding
    const expanded = expandPolygon(hull, HULL_PADDING)
    const points: number[] = []
    for (const p of expanded) {
      points.push(p.x, p.y)
    }

    const line = new Konva.Line({
      points,
      stroke: HULL_STROKE,
      strokeWidth: 2,
      strokeScaleEnabled: false,
      fill: HULL_FILL,
      closed: true,
      dash: HULL_DASH,
      listening: false,
      name: 'consortium-hull',
    })
    line.setAttr('data-consortium-id', consortium.id)
    zonesLayer.add(line)
  }

  zonesLayer.batchDraw()
}

/**
 * Update a single consortium boundary when a plant moves.
 */
export function updateConsortiumForPlant(
  plantId: string,
  engine: CanvasEngine,
  consortiums: Consortium[],
): void {
  const affected = consortiums.filter((c) => c.plant_ids.includes(plantId))
  if (affected.length === 0) return

  // Just re-render all affected — simpler than targeted updates
  const zonesLayer = engine.layers.get('zones')
  if (!zonesLayer) return

  for (const consortium of affected) {
    // Remove existing hull for this consortium
    zonesLayer.find('.consortium-hull').forEach((n: Konva.Node) => {
      if (n.getAttr('data-consortium-id') === consortium.id) n.destroy()
    })
  }

  // Re-render affected
  renderConsortiumBoundaries(engine, affected)
}

// ---------------------------------------------------------------------------
// Convex hull — Andrew's monotone chain algorithm
// ---------------------------------------------------------------------------

function convexHull(points: { x: number; y: number }[]): { x: number; y: number }[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  if (sorted.length <= 1) return sorted

  const lower: { x: number; y: number }[] = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) {
      lower.pop()
    }
    lower.push(p)
  }

  const upper: { x: number; y: number }[] = []
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]!
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) {
      upper.pop()
    }
    upper.push(p)
  }

  // Remove last point of each half (duplicate)
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

function cross(o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

function expandPolygon(
  polygon: { x: number; y: number }[],
  padding: number,
): { x: number; y: number }[] {
  // Compute centroid
  let cx = 0, cy = 0
  for (const p of polygon) { cx += p.x; cy += p.y }
  cx /= polygon.length
  cy /= polygon.length

  // Expand each point away from centroid
  return polygon.map((p) => {
    const dx = p.x - cx
    const dy = p.y - cy
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist === 0) return p
    return {
      x: p.x + (dx / dist) * padding,
      y: p.y + (dy / dist) * padding,
    }
  })
}
