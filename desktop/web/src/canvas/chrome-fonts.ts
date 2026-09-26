/**
 * Font stack for text the canvas draws itself: Pixi labels, Canvas2D rulers
 * and lens badges, and runtime-owned DOM overlays. Pixi and Canvas2D cannot
 * resolve CSS custom properties, so this mirrors `--font-sans` in
 * `styles/global.css` (bundled Source Sans 3 first, then Noto/system fallbacks
 * for CJK and Cyrillic); `canvas-chrome-theme.test.ts` keeps the two equal.
 */
export const CANVAS_CHROME_FONT_FAMILY = "'Source Sans 3', 'Noto Sans', 'Noto Sans SC', 'Noto Sans JP', 'Noto Sans KR', 'PingFang SC', 'Hiragino Sans', 'Apple SD Gothic Neo', 'Microsoft YaHei', 'Yu Gothic UI', 'Malgun Gothic', system-ui, -apple-system, 'Segoe UI', sans-serif"
