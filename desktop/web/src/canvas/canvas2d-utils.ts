let _cachedStyle: CSSStyleDeclaration | null = null
let _styleDirty = true

/** Mark the CSS variable cache as stale (call on theme change). */
export function invalidateCssVarCache(): void {
  _styleDirty = true
}

/** Read a CSS custom property, caching getComputedStyle until invalidated. */
export function cssVar(name: string): string {
  if (!_cachedStyle || _styleDirty) {
    _cachedStyle = getComputedStyle(document.documentElement)
    _styleDirty = false
  }
  return _cachedStyle.getPropertyValue(name).trim()
}

/** Shared font-family fallback — used by all Canvas2D renderers. */
export const FONT_SANS_FALLBACK = 'Inter, system-ui, sans-serif'

/** Shared theme tokens read from CSS custom properties. */
export interface ThemeTokens {
  bg: string
  surface: string
  border: string
  text: string
  textMuted: string
  primary: string
  primaryContrast: string
  fontSans: string
}

/** Read shared theme CSS tokens with hex fallbacks for Canvas2D renderers. */
export function readThemeTokens(): ThemeTokens {
  return {
    bg: cssVar('--color-bg') || '#E6E0D4',
    surface: cssVar('--color-surface') || '#EDE8DD',
    border: cssVar('--color-border') || '#D4CFC5',
    text: cssVar('--color-text') || '#2C2418',
    textMuted: cssVar('--color-text-muted') || '#6B5F4E',
    primary: cssVar('--color-primary') || '#A06B1F',
    primaryContrast: cssVar('--color-primary-contrast') || '#F8F4ED',
    fontSans: cssVar('--font-sans') || FONT_SANS_FALLBACK,
  }
}

/** Draw a rounded rectangle path (does not fill or stroke). */
export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const cr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + cr, y)
  ctx.lineTo(x + w - cr, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + cr)
  ctx.lineTo(x + w, y + h - cr)
  ctx.quadraticCurveTo(x + w, y + h, x + w - cr, y + h)
  ctx.lineTo(x + cr, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - cr)
  ctx.lineTo(x, y + cr)
  ctx.quadraticCurveTo(x, y, x + cr, y)
  ctx.closePath()
}
