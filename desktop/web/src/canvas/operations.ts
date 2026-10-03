export interface SimpleRect {
  x: number
  y: number
  width: number
  height: number
}

export function rectsIntersect(a: SimpleRect, b: SimpleRect): boolean {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  )
}
