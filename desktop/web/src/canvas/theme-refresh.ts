import Konva from 'konva'

/**
 * Get the node to apply visual highlight effects to. For counter-scaled
 * plant groups, returns the first child so the shadow renders in
 * screen-pixel space and stays visible at any zoom level.
 */
export function highlightTargetFor(node: Konva.Node): Konva.Node {
  if (node instanceof Konva.Group && node.hasName('plant-group')) {
    const child = (node as Konva.Group).getChildren()[0]
    if (child) return child
  }
  return node
}

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

const _colors: { [K in CanvasColorName]: string } = {
  'plant-label': '#444444',
  'plant-label-muted': '#888888',
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
): void {
  const cs = getComputedStyle(container)

  // Update cache from CSS variables
  _colors['plant-label'] = cs.getPropertyValue('--canvas-plant-label').trim() || _colors['plant-label']
  _colors['plant-label-muted'] = cs.getPropertyValue('--canvas-plant-label-muted').trim() || _colors['plant-label-muted']
  _colors['guide-line'] = cs.getPropertyValue('--canvas-guide-line').trim() || _colors['guide-line']
  _colors['guide-smart'] = cs.getPropertyValue('--canvas-guide-smart').trim() || _colors['guide-smart']
  _colors['stack-badge-bg'] = cs.getPropertyValue('--canvas-stack-badge-bg').trim() || _colors['stack-badge-bg']
  _colors['stack-badge-text'] = cs.getPropertyValue('--canvas-stack-badge-text').trim() || _colors['stack-badge-text']
  _colors['annotation-text'] = cs.getPropertyValue('--canvas-annotation-text').trim() || _colors['annotation-text']
  _colors['annotation-stroke'] = cs.getPropertyValue('--canvas-annotation-stroke').trim() || _colors['annotation-stroke']
  _colors['annotation-surface'] = cs.getPropertyValue('--canvas-annotation-surface').trim() || _colors['annotation-surface']
  _colors['zone-stroke'] = cs.getPropertyValue('--canvas-zone-stroke').trim() || _colors['zone-stroke']
  _colors['zone-fill'] = cs.getPropertyValue('--canvas-zone-fill').trim() || _colors['zone-fill']
  _colors['selection-fill'] = cs.getPropertyValue('--canvas-selection').trim() || _colors['selection-fill']
  _colors['selection-stroke'] = cs.getPropertyValue('--canvas-selection-stroke').trim() || _colors['selection-stroke']
  _colors['highlight-glow'] = cs.getPropertyValue('--color-primary').trim() || _colors['highlight-glow']

  // ── Update plant labels ──
  const plantsLayer = layers.get('plants')
  if (plantsLayer) {
    plantsLayer.find('.plant-label').forEach((node: Konva.Node) => {
      ;(node as Konva.Text).fill(_colors['plant-label'])
    })
    plantsLayer.find('.plant-botanical').forEach((node: Konva.Node) => {
      ;(node as Konva.Text).fill(_colors['plant-label-muted'])
    })
    plantsLayer.find('.stackBadgeBg').forEach((node: Konva.Node) => {
      ;(node as Konva.Circle).fill(_colors['stack-badge-bg'])
    })
    plantsLayer.find('.stackBadgeText').forEach((node: Konva.Node) => {
      ;(node as Konva.Text).fill(_colors['stack-badge-text'])
    })
    plantsLayer.batchDraw()
  }

  // ── Update annotation text ──
  const annotationsLayer = layers.get('annotations')
  if (annotationsLayer) {
    annotationsLayer.find('.annotation-text').forEach((node: Konva.Node) => {
      ;(node as Konva.Text).fill(_colors['annotation-text'])
    })
    annotationsLayer.find('.measure-label').forEach((node: Konva.Node) => {
      const children = (node as Konva.Group).getChildren()
      const pill = children[0]
      const label = children[1]
      if (pill && pill.getClassName() === 'Rect') {
        ;(pill as Konva.Rect).fill(_colors['annotation-stroke'])
      }
      if (label && label.getClassName() === 'Text') {
        ;(label as Konva.Text).fill(_colors['annotation-surface'])
      }
    })
    annotationsLayer.find('.shape').forEach((node: Konva.Node) => {
      if (node.getClassName() !== 'Line') return
      const shape = node as Konva.Line
      if (shape.closed()) return
      if (shape.fillEnabled() && shape.fill()) return
      shape.stroke(_colors['annotation-stroke'])
    })
    annotationsLayer.find('.guide-line').forEach((node: Konva.Node) => {
      ;(node as Konva.Line).stroke(_colors['guide-line'])
    })
    annotationsLayer.find('.smart-guide').forEach((node: Konva.Node) => {
      ;(node as Konva.Line).stroke(_colors['guide-smart'])
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
        const currentFill = shape.fill()
        shape.stroke(_colors['zone-stroke'])
        const managedFillAttr = shape.getAttr('data-theme-managed-fill')
        const hasManagedFill =
          typeof managedFillAttr === 'boolean'
            ? managedFillAttr
            : isThemeManagedZoneFill(typeof currentFill === 'string' ? currentFill : null)

        if (hasManagedFill) {
          shape.fill(_colors['zone-fill'])
          shape.setAttr('data-theme-managed-fill', true)
        } else {
          shape.setAttr('data-theme-managed-fill', false)
        }
      } else {
        // Stroke-only shapes (lines, polylines)
        shape.stroke(_colors['zone-stroke'])
      }
    })
    zonesLayer.batchDraw()
  }

  // ── Update active selection/hover highlights ──
  const glowColor = _colors['highlight-glow']
  for (const [, layer] of layers) {
    let dirty = false
    layer.find('.shape').forEach((node: Konva.Node) => {
      if (typeof node.getAttr !== 'function' || !node.getAttr('data-highlight')) return
      const target = highlightTargetFor(node)
      if (typeof target.getAttr === 'function' && target.getAttr('shadowColor') !== undefined) {
        target.setAttr('shadowColor', glowColor)
        dirty = true
      }
    })
    if (dirty) layer.batchDraw()
  }
}
