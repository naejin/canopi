// ---------------------------------------------------------------------------
// Canvas theme color cache — keeps canvas rendering in sync with CSS theme.
//
// Pattern: module-level color cache → getCanvasColor() for reading
//          → refreshCanvasColorCache() to update from CSS on theme change.
//
// Text, halos, badges and the grid drawn over the map do not follow the UI
// theme: `runtime/scene-visuals.ts` resolves them from the map backdrop.
//
// `canvasPaintRevision` moves whenever either source changes, so paint kept
// outside the renderer (the panel Target overlays on the map) can re-read it.
// ---------------------------------------------------------------------------

import { signal } from '@preact/signals'

type CanvasColorName =
  | 'background'
  | 'ruler-bg'
  | 'ruler-text'
  | 'guide-line'
  | 'overlay-casing'
  | 'zone-stroke'
  | 'zone-fill'
  | 'hover-stroke'
  | 'selection-stroke'
  | 'interaction-casing'
  | 'locked-object-stroke'
  | 'locked-layer-stroke'

/** CSS variable read for each canvas colour. Most follow `--canvas-{key}`. */
export const CANVAS_COLOR_CSS_VARS: { readonly [K in CanvasColorName]: string } = {
  background: '--canvas-bg',
  'ruler-bg': '--canvas-ruler-bg',
  'ruler-text': '--canvas-ruler-text',
  'guide-line': '--canvas-guide-line',
  'overlay-casing': '--canvas-overlay-casing',
  'zone-stroke': '--canvas-zone-stroke',
  'zone-fill': '--canvas-zone-fill',
  'hover-stroke': '--canvas-hover-stroke',
  'selection-stroke': '--canvas-selection-stroke',
  'interaction-casing': '--canvas-interaction-casing',
  'locked-object-stroke': '--canvas-locked-object-stroke',
  'locked-layer-stroke': '--canvas-locked-layer-stroke',
}

// Light-theme values from `styles/global.css`, used until the first refresh.
const _colors: { [K in CanvasColorName]: string } = {
  background: '#EFE9DD',
  'ruler-bg': '#F3EEE3',
  'ruler-text': '#645A4C',
  'guide-line': '#FFF3D6',
  'overlay-casing': 'rgba(20, 16, 10, 0.6)',
  'zone-stroke': '#FFF3D6',
  'zone-fill': 'rgba(255, 243, 214, 0.1)',
  'hover-stroke': 'rgba(156, 90, 22, 0.62)',
  'selection-stroke': '#9C5A16',
  'interaction-casing': '#FFF8EC',
  'locked-object-stroke': 'rgba(100, 90, 76, 0.86)',
  'locked-layer-stroke': 'rgba(168, 51, 42, 0.88)',
}

// The light and dark `--canvas-zone-fill` values: a zone storing one of them
// follows the theme instead of keeping it as an authored colour.
const MANAGED_ZONE_FILL_VALUES = new Set([
  'rgba(255,243,214,0.1)',
  'rgba(255,243,214,0.08)',
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

/** Moves when a canvas colour or the map backdrop changes. */
export const canvasPaintRevision = signal(0)

/** Tells paint readers outside the renderer that canvas colours changed. */
export function markCanvasPaintChanged(): void {
  canvasPaintRevision.value += 1
}

export function refreshCanvasColorCache(container: HTMLElement): void {
  const cs = getComputedStyle(container)
  let changed = false

  for (const key of Object.keys(_colors) as CanvasColorName[]) {
    const value = cs.getPropertyValue(CANVAS_COLOR_CSS_VARS[key]).trim()
    if (value && value !== _colors[key]) {
      _colors[key] = value
      changed = true
    }
  }
  if (changed) markCanvasPaintChanged()
}
