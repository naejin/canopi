import Konva from 'konva'

// ---------------------------------------------------------------------------
// Canvas theme refresh — keeps Konva nodes in sync with CSS theme variables.
//
// Konva nodes bake colors at creation time. When the user toggles dark/light
// theme, this module walks all relevant nodes and re-applies colors from the
// current CSS custom properties.
//
// Pattern: module-level color cache → getCanvasColor() for new nodes
//          → refreshCanvasTheme() for existing nodes on theme change.
// ---------------------------------------------------------------------------

// ── Color cache (populated by refreshCanvasTheme, read by getCanvasColor) ──

type CanvasColorName =
  | 'plant-label'
  | 'plant-label-muted'
  | 'annotation-text'
  | 'zone-stroke'
  | 'zone-fill'
  | 'selection-fill'
  | 'selection-stroke'

const _colors: { [K in CanvasColorName]: string } = {
  'plant-label': '#444444',
  'plant-label-muted': '#888888',
  'annotation-text': '#1A1A1A',
  'zone-stroke': '#2D5F3F',
  'zone-fill': 'rgba(45, 95, 63, 0.1)',
  'selection-fill': 'rgba(160, 107, 31, 0.18)',
  'selection-stroke': 'rgba(160, 107, 31, 0.6)',
}

/**
 * Returns the current theme color for a canvas element.
 * Use this when creating new Konva nodes so they match the active theme.
 */
export function getCanvasColor(name: CanvasColorName): string {
  return _colors[name]
}

/**
 * Refresh cached colors from CSS variables and update all existing Konva nodes.
 * Called from the engine's theme effect after the DOM has applied [data-theme].
 */
export function refreshCanvasTheme(
  container: HTMLElement,
  layers: Map<string, Konva.Layer>,
  transformer?: Konva.Transformer | null,
): void {
  const cs = getComputedStyle(container)

  // Update cache from CSS variables
  _colors['plant-label'] = cs.getPropertyValue('--canvas-plant-label').trim() || _colors['plant-label']
  _colors['plant-label-muted'] = cs.getPropertyValue('--canvas-plant-label-muted').trim() || _colors['plant-label-muted']
  _colors['annotation-text'] = cs.getPropertyValue('--canvas-annotation-text').trim() || _colors['annotation-text']
  _colors['zone-stroke'] = cs.getPropertyValue('--canvas-zone-stroke').trim() || _colors['zone-stroke']
  _colors['zone-fill'] = cs.getPropertyValue('--canvas-zone-fill').trim() || _colors['zone-fill']
  _colors['selection-fill'] = cs.getPropertyValue('--canvas-selection').trim() || _colors['selection-fill']
  _colors['selection-stroke'] = cs.getPropertyValue('--canvas-selection-stroke').trim() || _colors['selection-stroke']

  // ── Update plant labels ──
  const plantsLayer = layers.get('plants')
  if (plantsLayer) {
    plantsLayer.find('.plant-label').forEach((node: Konva.Node) => {
      ;(node as Konva.Text).fill(_colors['plant-label'])
    })
    plantsLayer.find('.plant-botanical').forEach((node: Konva.Node) => {
      ;(node as Konva.Text).fill(_colors['plant-label-muted'])
    })
    plantsLayer.batchDraw()
  }

  // ── Update annotation text ──
  const annotationsLayer = layers.get('annotations')
  if (annotationsLayer) {
    annotationsLayer.find('.annotation-text').forEach((node: Konva.Node) => {
      ;(node as Konva.Text).fill(_colors['annotation-text'])
    })
    annotationsLayer.batchDraw()
  }

  // ── Update zone shapes ──
  const zonesLayer = layers.get('zones')
  if (zonesLayer) {
    zonesLayer.find('.shape').forEach((node: Konva.Node) => {
      const shape = node as Konva.Shape
      // Only update zones (not other shapes on this layer) — zones have fill
      if (shape.fill() !== undefined && shape.fill() !== '') {
        shape.stroke(_colors['zone-stroke'])
        shape.fill(_colors['zone-fill'])
      } else {
        // Stroke-only shapes (lines, polylines)
        shape.stroke(_colors['zone-stroke'])
      }
    })
    zonesLayer.batchDraw()
  }

  // ── Update Transformer (long-lived selection handles) ──
  if (transformer) {
    transformer.borderStroke(_colors['selection-stroke'])
    transformer.anchorStroke(_colors['selection-stroke'])
    transformer.getLayer()?.batchDraw()
  }
}
