/**
 * Font stacks for text the canvas draws itself: Pixi labels and draft chips,
 * Canvas2D lens badges, and runtime-owned DOM overlays. Pixi and
 * Canvas2D cannot resolve CSS custom properties, so these mirror `--font-sans`
 * and `--font-mono` in `styles/global.css` (bundled Source Sans 3 and IBM Plex
 * Mono first, then Noto/system fallbacks for CJK and Cyrillic);
 * `canvas-chrome-theme.test.ts` keeps each pair equal.
 */
export const CANVAS_CHROME_FONT_FAMILY = "'Source Sans 3', 'Noto Sans', 'Noto Sans SC', 'Noto Sans JP', 'Noto Sans KR', 'PingFang SC', 'Hiragino Sans', 'Apple SD Gothic Neo', 'Microsoft YaHei', 'Yu Gothic UI', 'Malgun Gothic', system-ui, -apple-system, 'Segoe UI', sans-serif"

/** The mono stack of measurement chips (`--font-mono`). */
export const CANVAS_CHROME_MONO_FONT_FAMILY = "'IBM Plex Mono', ui-monospace, 'SFMono-Regular', 'Cascadia Mono', 'Noto Sans Mono', monospace"
