// ---------------------------------------------------------------------------
// Pattern math — point-in-polygon + grid/hex/offset point generation
// ---------------------------------------------------------------------------

export type PatternType = 'grid' | 'hex' | 'offset'

/**
 * Ray-casting point-in-polygon test.
 * `polygon` is an array of {x, y} vertices forming a closed polygon.
 */
export function pointInPolygon(
  px: number,
  py: number,
  polygon: { x: number; y: number }[],
): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i]!.x, yi = polygon[i]!.y
    const xj = polygon[j]!.x, yj = polygon[j]!.y
    const intersect = ((yi > py) !== (yj > py)) &&
      (px < (xj - xi) * (py - yi) / (yj - yi) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

/**
 * Generate points inside a polygon using the given pattern and spacing.
 * Returns world-coordinate positions for plant placement.
 * Caps output at maxPoints to prevent performance issues.
 */
export function generatePatternPoints(
  polygon: { x: number; y: number }[],
  spacing: number,
  pattern: PatternType,
  maxPoints = 500,
): { x: number; y: number }[] {
  if (polygon.length < 3 || spacing <= 0) return []

  // Compute bounding rect
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of polygon) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }

  const points: { x: number; y: number }[] = []
  let row = 0

  for (let y = minY + spacing / 2; y <= maxY; y += spacing) {
    let xOffset = 0
    if (pattern === 'hex' && row % 2 === 1) {
      xOffset = spacing / 2
    } else if (pattern === 'offset' && row % 2 === 1) {
      xOffset = spacing / 3
    }

    for (let x = minX + spacing / 2 + xOffset; x <= maxX; x += spacing) {
      if (pointInPolygon(x, y, polygon)) {
        points.push({ x, y })
        if (points.length >= maxPoints) return points
      }
    }
    row++
  }

  return points
}

/**
 * Generate N points evenly distributed along a line segment.
 */
export function generateLinePoints(
  start: { x: number; y: number },
  end: { x: number; y: number },
  count: number,
): { x: number; y: number }[] {
  if (count < 1) return []
  if (count === 1) return [{ x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }]

  const points: { x: number; y: number }[] = []
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1)
    points.push({
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
    })
  }
  return points
}
