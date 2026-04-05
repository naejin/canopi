let _cachedStyle: CSSStyleDeclaration | null = null
let _cachedStyleFrame = -1

/** Read a CSS custom property, caching getComputedStyle within the same frame. */
export function cssVar(name: string): string {
  const frame = performance.now()
  if (!_cachedStyle || frame - _cachedStyleFrame > 16) {
    _cachedStyle = getComputedStyle(document.documentElement)
    _cachedStyleFrame = frame
  }
  return _cachedStyle.getPropertyValue(name).trim()
}

/** Draw a rounded rectangle path (does not fill or stroke). */
export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}
