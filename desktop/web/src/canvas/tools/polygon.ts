import Konva from 'konva'
import type { CanvasTool } from './base'
import type { CanvasEngine } from '../engine'
import { createPolygon, PREVIEW_DASH, zoneDefaults } from '../shapes'
import { AddNodeCommand } from '../commands'

// Distance threshold for snapping to the first vertex to close the polygon.
const CLOSE_THRESHOLD_PX = 10

export class PolygonTool implements CanvasTool {
  readonly name = 'polygon'
  readonly cursor = 'crosshair'

  // Flat [x1,y1, x2,y2, ...] array of committed vertices
  private _points: number[] = []
  // Preview line showing committed vertices + the trailing cursor segment
  private _previewLine: Konva.Line | null = null
  // Small circle markers at each committed vertex
  private _vertexDots: Konva.Circle[] = []

  activate(_engine: CanvasEngine): void {}

  deactivate(engine: CanvasEngine): void {
    this._cancelDraw(engine)
  }

  onMouseDown(e: Konva.KonvaEventObject<MouseEvent>, engine: CanvasEngine): void {
    if (e.evt.button !== 0) return

    const pos = engine.stage.getRelativePointerPosition()
    if (!pos) return

    const layer = engine.layers.get('zones')
    if (!layer) return

    // Double-click closes the polygon (fires mousedown twice rapidly)
    if (e.evt.detail === 2 && this._points.length >= 6) {
      this._finalize(engine)
      return
    }

    // If we have at least one committed vertex, check proximity to first vertex
    if (this._points.length >= 6) {
      const firstX = this._points[0]!
      const firstY = this._points[1]!
      const scale = engine.stage.scaleX()
      const dx = (pos.x - firstX) * scale
      const dy = (pos.y - firstY) * scale
      const distPx = Math.sqrt(dx * dx + dy * dy)
      if (distPx <= CLOSE_THRESHOLD_PX) {
        this._finalize(engine)
        return
      }
    }

    // Append new vertex
    this._points.push(pos.x, pos.y)

    // Create preview line on first click
    if (!this._previewLine) {
      this._previewLine = new Konva.Line({
        points: [...this._points, pos.x, pos.y], // trailing cursor point
        stroke: zoneDefaults().stroke,
        strokeWidth: zoneDefaults().strokeWidth,
        strokeScaleEnabled: false,
        dash: PREVIEW_DASH,
        fill: zoneDefaults().fill,
        listening: false,
      })
      layer.add(this._previewLine)
    } else {
      // Update committed points (trailing cursor point appended on mousemove)
      this._updatePreviewPoints(pos.x, pos.y)
    }

    // Place a vertex dot — radius in screen pixels, counter-scaled to stay constant
    const inv = 1 / engine.stage.scaleX()
    const dot = new Konva.Circle({
      x: pos.x,
      y: pos.y,
      radius: 4 * inv,
      fill: zoneDefaults().stroke,
      stroke: '#FFFFFF',
      strokeWidth: 1,
      strokeScaleEnabled: false,
      listening: false,
    })
    layer.add(dot)
    this._vertexDots.push(dot)

    layer.batchDraw()
  }

  onMouseMove(_e: Konva.KonvaEventObject<MouseEvent>, engine: CanvasEngine): void {
    if (!this._previewLine || this._points.length === 0) return

    const pos = engine.stage.getRelativePointerPosition()
    if (!pos) return

    this._updatePreviewPoints(pos.x, pos.y)
    this._previewLine.getLayer()?.batchDraw()
  }

  onMouseUp(_e: Konva.KonvaEventObject<MouseEvent>, _engine: CanvasEngine): void {
    // State is managed by mousedown / dblclick logic
  }

  onKeyDown(e: KeyboardEvent, engine: CanvasEngine): void {
    if (e.key === 'Escape') {
      this._cancelDraw(engine)
    } else if (e.key === 'Enter' && this._points.length >= 6) {
      this._finalize(engine)
    }
  }

  // Set preview line points = committed vertices + trailing cursor point
  private _updatePreviewPoints(cursorX: number, cursorY: number): void {
    if (!this._previewLine) return
    this._previewLine.points([...this._points, cursorX, cursorY])
  }

  private _finalize(engine: CanvasEngine): void {
    const pts = [...this._points]
    this._cleanupPreview(engine)

    if (pts.length < 6) return // Need at least 3 vertices

    const shape = createPolygon(pts)
    const cmd = new AddNodeCommand('zones', shape)
    engine.history.execute(cmd, engine)
  }

  private _cancelDraw(engine: CanvasEngine): void {
    this._cleanupPreview(engine)
  }

  private _cleanupPreview(engine: CanvasEngine): void {
    const layer = engine.layers.get('zones')

    if (this._previewLine) {
      this._previewLine.destroy()
      this._previewLine = null
    }
    for (const dot of this._vertexDots) {
      dot.destroy()
    }
    this._vertexDots = []
    this._points = []

    layer?.batchDraw()
  }
}
