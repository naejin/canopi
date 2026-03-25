import Konva from 'konva'
import type { CanvasTool } from './base'
import type { CanvasEngine } from '../engine'
import { plantStampSpecies } from '../../state/canvas'
import { createPlantNode } from '../plants'
import { AddNodeCommand, BatchCommand } from '../commands'
import { generatePatternPoints, type PatternType } from '../pattern-math'

/**
 * Pattern Fill Tool — click a zone shape to fill it with plants in a pattern.
 * Requires a stamp species to be set (from PlantRow "Set as stamp" or direct signal write).
 * Opens a simple prompt for spacing and pattern type.
 */
export class PatternFillTool implements CanvasTool {
  readonly name = 'pattern-fill'
  readonly cursor = 'crosshair'

  activate(_engine: CanvasEngine): void {}
  deactivate(_engine: CanvasEngine): void {}

  onMouseDown(e: Konva.KonvaEventObject<MouseEvent>, engine: CanvasEngine): void {
    if (e.evt.button !== 0) return

    const species = plantStampSpecies.value
    if (!species) return

    // Find the clicked zone shape
    const target = e.target
    if (target === engine.stage) return
    if (target.hasName('plant-group')) return

    // Get zone polygon points
    const polygon = _extractPolygon(target)
    if (!polygon || polygon.length < 3) return

    // Prompt for spacing and pattern (simple approach — could be a modal later)
    const spacingStr = window.prompt('Spacing (meters):', '2')
    if (!spacingStr) return
    const spacing = parseFloat(spacingStr)
    if (isNaN(spacing) || spacing <= 0) return

    const patternStr = window.prompt('Pattern (grid / hex / offset):', 'hex') as PatternType
    const pattern: PatternType = ['grid', 'hex', 'offset'].includes(patternStr) ? patternStr : 'grid'

    const points = generatePatternPoints(polygon, spacing, pattern, 500)
    if (points.length === 0) return

    const stageScale = engine.stage.scaleX()
    const cmds: AddNodeCommand[] = []

    for (const pos of points) {
      const node = createPlantNode({
        id: crypto.randomUUID(),
        canonicalName: species.canonical_name,
        commonName: species.common_name,
        stratum: species.stratum,
        canopySpreadM: species.width_max_m,
        position: pos,
        stageScale,
      })
      cmds.push(new AddNodeCommand('plants', node))
    }

    engine.history.execute(new BatchCommand(cmds), engine)
  }

  onMouseMove(_e: Konva.KonvaEventObject<MouseEvent>, _engine: CanvasEngine): void {}
  onMouseUp(_e: Konva.KonvaEventObject<MouseEvent>, _engine: CanvasEngine): void {}

  onKeyDown(e: KeyboardEvent, engine: CanvasEngine): void {
    if (e.key === 'Escape') engine.setActiveTool('select')
  }
}

function _extractPolygon(node: Konva.Node): { x: number; y: number }[] | null {
  const className = node.getClassName()

  if (className === 'Line') {
    const line = node as Konva.Line
    const pts = line.points()
    const ox = line.x()
    const oy = line.y()
    const polygon: { x: number; y: number }[] = []
    for (let i = 0; i < pts.length; i += 2) {
      polygon.push({ x: (pts[i] ?? 0) + ox, y: (pts[i + 1] ?? 0) + oy })
    }
    return polygon.length >= 3 ? polygon : null
  }

  if (className === 'Rect') {
    const r = node as Konva.Rect
    return [
      { x: r.x(), y: r.y() },
      { x: r.x() + r.width(), y: r.y() },
      { x: r.x() + r.width(), y: r.y() + r.height() },
      { x: r.x(), y: r.y() + r.height() },
    ]
  }

  if (className === 'Ellipse') {
    // Approximate ellipse as 16-sided polygon
    const el = node as Konva.Ellipse
    const cx = el.x(), cy = el.y()
    const rx = el.radiusX(), ry = el.radiusY()
    const points: { x: number; y: number }[] = []
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2
      points.push({ x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) })
    }
    return points
  }

  return null
}
