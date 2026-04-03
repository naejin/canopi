// ---------------------------------------------------------------------------
// Canvas theme color cache — keeps canvas rendering in sync with CSS theme.
//
// Pattern: module-level color cache → getCanvasColor() for reading
//          → refreshCanvasColorCache() to update from CSS on theme change.
// ---------------------------------------------------------------------------

type CanvasColorName =
  | 'plant-label'
  | 'guide-line'
  | 'guide-smart'
  | 'stack-badge-bg'
  | 'stack-badge-text'
  | 'annotation-text'
  | 'annotation-stroke'
  | 'annotation-surface'
  | 'zone-stroke'
  | 'zone-fill'
  | 'selection-fill'
  | 'selection-stroke'
  | 'highlight-glow'

// CSS variable name for each canvas color. Most follow `--canvas-{key}`;
// the two exceptions are explicit here instead of hidden in procedural code.
const _cssVarMap: { [K in CanvasColorName]: string } = {
  'plant-label': '--canvas-plant-label',
  'guide-line': '--canvas-guide-line',
  'guide-smart': '--canvas-guide-smart',
  'stack-badge-bg': '--canvas-stack-badge-bg',
  'stack-badge-text': '--canvas-stack-badge-text',
  'annotation-text': '--canvas-annotation-text',
  'annotation-stroke': '--canvas-annotation-stroke',
  'annotation-surface': '--canvas-annotation-surface',
  'zone-stroke': '--canvas-zone-stroke',
  'zone-fill': '--canvas-zone-fill',
  'selection-fill': '--canvas-selection',
  'selection-stroke': '--canvas-selection-stroke',
  'highlight-glow': '--color-primary',
}

const _colors: { [K in CanvasColorName]: string } = {
  'plant-label': '#444444',
  'guide-line': 'rgba(45, 95, 63, 0.6)',
  'guide-smart': 'rgba(181, 67, 42, 0.72)',
  'stack-badge-bg': '#5A7D3A',
  'stack-badge-text': '#FCF8F2',
  'annotation-text': '#1A1A1A',
  'annotation-stroke': '#6B6253',
  'annotation-surface': '#FFFDF8',
  'zone-stroke': '#2D5F3F',
  'zone-fill': 'rgba(45, 95, 63, 0.1)',
  'selection-fill': 'rgba(160, 107, 31, 0.18)',
  'selection-stroke': 'rgba(160, 107, 31, 0.6)',
  'highlight-glow': '#A06B1F',
}

const MANAGED_ZONE_FILL_VALUES = new Set([
  'rgba(45,95,63,0.1)',
  'rgba(200,180,150,0.06)',
])

function normalizeColor(value: string | null | undefined): string | null {
  if (!value) return null
  return value.replace(/\s+/g, '').toLowerCase()
}

export function isThemeManagedZoneFill(value: string | null | undefined): boolean {
  const normalized = normalizeColor(value)
  if (!normalized) return true
  return MANAGED_ZONE_FILL_VALUES.has(normalized)
}

/**
 * Returns the current theme color for a canvas element.
 */
export function getCanvasColor(name: CanvasColorName): string {
  return _colors[name]
}

export function refreshCanvasColorCache(container: HTMLElement): void {
  const cs = getComputedStyle(container)

  for (const key of Object.keys(_colors) as CanvasColorName[]) {
    const value = cs.getPropertyValue(_cssVarMap[key]).trim()
    if (value) _colors[key] = value
  }
}
