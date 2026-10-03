export interface SimpleRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The band select query: the world bounds of a band's four corners. At bearing 0 the band is level with the world axes, so
 * the bounds are the band itself (the box spanned by its two corners); a turned band is queried as a polygon
 * from phase 1 (INV-TOOL-01).
 */
export function computeQuadBoundsRect(corners: readonly { x: number; y: number }[]): SimpleRect {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const corner of corners) {
    minX = Math.min(minX, corner.x)
    minY = Math.min(minY, corner.y)
    maxX = Math.max(maxX, corner.x)
    maxY = Math.max(maxY, corner.y)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export function rectsIntersect(a: SimpleRect, b: SimpleRect): boolean {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  )
}
