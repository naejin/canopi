import Konva from 'konva'
import type { CanvasTool } from './base'
import type { CanvasEngine } from '../engine'
import { createFreeform, ZONE_DEFAULTS } from '../shapes'
import { AddNodeCommand } from '../commands'

interface Point {
  x: number
  y: number
}

/**
 * Ramer-Douglas-Peucker simplification.
 * Takes a flat [x1,y1, x2,y2, ...] array and a tolerance in canvas units.
 * Returns a simplified flat array.
 */
function rdp(points: number[], tolerance: number): number[] {
  const pts: Point[] = []
  for (let i = 0; i + 1 < points.length; i += 2) {
    pts.push({ x: points[i] as number, y: points[i + 1] as number })
  }

  if (pts.length < 3) return points

  const simplified = _rdpRecurse(pts, tolerance)

  const result: number[] = []
  for (const p of simplified) {
    result.push(p.x, p.y)
  }
  return result
}

function _rdpRecurse(pts: Point[], tolerance: number): Point[] {
  if (pts.length <= 2) return pts

  const first: Point = pts[0]!
  const last: Point = pts[pts.length - 1]!

  const dxLine = last.x - first.x
  const dyLine = last.y - first.y
  const lineLen2 = dxLine * dxLine + dyLine * dyLine

  let maxDist = 0
  let maxIdx = 0

  for (let i = 1; i < pts.length - 1; i++) {
    const pt: Point = pts[i]!
    let dist: number
    if (lineLen2 === 0) {
      dist = Math.sqrt((pt.x - first.x) ** 2 + (pt.y - first.y) ** 2)
    } else {
      const t = ((pt.x - first.x) * dxLine + (pt.y - first.y) * dyLine) / lineLen2
      const projX = first.x + t * dxLine
      const projY = first.y + t * dyLine
      dist = Math.sqrt((pt.x - projX) ** 2 + (pt.y - projY) ** 2)
    }
    if (dist > maxDist) {
      maxDist = dist
      maxIdx = i
    }
  }

  if (maxDist > tolerance) {
    const left = _rdpRecurse(pts.slice(0, maxIdx + 1), tolerance)
    const right = _rdpRecurse(pts.slice(maxIdx), tolerance)
    return [...left.slice(0, -1), ...right]
  }

  return [first, last]
}

export class FreeformTool implements CanvasTool {
  readonly name = 'freeform'
  readonly cursor = 'crosshair'

  private _drawing = false
  private _points: number[] = []
  private _preview: Konva.Line | null = null

  // Throttle: only record every Nth mousemove
  private _moveCount = 0
  private readonly _SAMPLE_EVERY = 3

  // rAF guard for batchDraw
  private _rafId: number | null = null

  activate(_engine: CanvasEngine): void {}

  deactivate(engine: CanvasEngine): void {
    this._cancelDraw(engine)
  }

  onMouseDown(e: Konva.KonvaEventObject<MouseEvent>, engine: CanvasEngine): void {
    if (e.evt.button !== 0) return

    const pos = engine.stage.getRelativePointerPosition()
    if (!pos) return

    this._drawing = true
    this._points = [pos.x, pos.y]
    this._moveCount = 0

    this._preview = new Konva.Line({
      points: this._points,
      stroke: ZONE_DEFAULTS.stroke,
      strokeWidth: ZONE_DEFAULTS.strokeWidth,
      strokeScaleEnabled: false,
      lineCap: 'round',
      lineJoin: 'round',
      tension: 0.3,
      listening: false,
    })

    const layer = engine.layers.get('zones')
    if (layer) {
      layer.add(this._preview)
      layer.batchDraw()
    }
  }

  onMouseMove(_e: Konva.KonvaEventObject<MouseEvent>, engine: CanvasEngine): void {
    if (!this._drawing || !this._preview) return

    this._moveCount++
    if (this._moveCount % this._SAMPLE_EVERY !== 0) return

    const pos = engine.stage.getRelativePointerPosition()
    if (!pos) return

    this._points.push(pos.x, pos.y)

    if (this._rafId !== null) return
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null
      if (!this._preview) return
      this._preview.points(this._points)
      this._preview.getLayer()?.batchDraw()
    })
  }

  onMouseUp(_e: Konva.KonvaEventObject<MouseEvent>, engine: CanvasEngine): void {
    if (!this._drawing || !this._preview) return

    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId)
      this._rafId = null
    }

    if (this._points.length < 4) {
      // Too short to be meaningful
      this._cancelDraw(engine)
      return
    }

    const simplified = rdp(this._points, 2)

    this._preview.destroy()
    this._preview = null
    this._drawing = false
    this._points = []

    const shape = createFreeform(simplified, false)
    const cmd = new AddNodeCommand('zones', shape)
    engine.history.execute(cmd, engine)
  }

  onKeyDown(e: KeyboardEvent, engine: CanvasEngine): void {
    if (e.key === 'Escape') {
      this._cancelDraw(engine)
    }
  }

  private _cancelDraw(_engine: CanvasEngine): void {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId)
      this._rafId = null
    }
    if (this._preview) {
      const layer = this._preview.getLayer()
      this._preview.destroy()
      this._preview = null
      layer?.batchDraw()
    }
    this._drawing = false
    this._points = []
    this._moveCount = 0
  }
}
