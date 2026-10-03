export interface SimpleRect {
  x: number
  y: number
  width: number
  height: number
}

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

export function rectsIntersect(a: SimpleRect, b: SimpleRect): boolean {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  )
}
