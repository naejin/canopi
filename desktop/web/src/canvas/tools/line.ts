import Konva from 'konva'
import type { CanvasTool } from './base'
import type { CanvasEngine } from '../engine'
import { createPolyline, PREVIEW_DASH } from '../shapes'
import { AddNodeCommand } from '../commands'

const ANNOTATION_STROKE = '#64748B'

export class LineTool implements CanvasTool {
  readonly name = 'line'
  readonly cursor = 'crosshair'

  // Flat [x1,y1, x2,y2, ...] committed vertices
  private _points: number[] = []
  // Dashed preview line: committed vertices + trailing cursor point
  private _previewLine: Konva.Line | null = null
  // Vertex dot markers
  private _vertexDots: Konva.Circle[] = []

  activate(_engine: CanvasEngine): void {}

  deactivate(engine: CanvasEngine): void {
    this._cancelDraw(engine)
  }

  onMouseDown(e: Konva.KonvaEventObject<MouseEvent>, engine: CanvasEngine): void {
    if (e.evt.button !== 0) return

    const pos = engine.stage.getRelativePointerPosition()
    if (!pos) return

    const layer = engine.layers.get('annotations')
    if (!layer) return

    // Double-click finalizes (fires mousedown twice rapidly)
    if (e.evt.detail === 2 && this._points.length >= 4) {
      this._finalize(engine)
      return
    }

    this._points.push(pos.x, pos.y)

    if (!this._previewLine) {
      this._previewLine = new Konva.Line({
        points: [...this._points, pos.x, pos.y],
        stroke: ANNOTATION_STROKE,
        strokeWidth: 2,
        strokeScaleEnabled: false,
        dash: PREVIEW_DASH,
        lineCap: 'round',
        lineJoin: 'round',
        listening: false,
      })
      layer.add(this._previewLine)
    } else {
      this._updatePreviewPoints(pos.x, pos.y)
    }

    // Vertex dot — radius in screen pixels, counter-scaled to stay constant
    const inv = 1 / engine.stage.scaleX()
    const dot = new Konva.Circle({
      x: pos.x,
      y: pos.y,
      radius: 3 * inv,
      fill: ANNOTATION_STROKE,
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
    // Managed by mousedown / dblclick logic
  }

  onKeyDown(e: KeyboardEvent, engine: CanvasEngine): void {
    if (e.key === 'Escape') {
      this._cancelDraw(engine)
    } else if (e.key === 'Enter' && this._points.length >= 4) {
      this._finalize(engine)
    }
  }

  private _updatePreviewPoints(cursorX: number, cursorY: number): void {
    if (!this._previewLine) return
    this._previewLine.points([...this._points, cursorX, cursorY])
  }

  private _finalize(engine: CanvasEngine): void {
    const pts = [...this._points]
    this._cleanupPreview(engine)

    if (pts.length < 4) return // Need at least 2 vertices

    const shape = createPolyline(pts)
    const cmd = new AddNodeCommand('annotations', shape)
    engine.history.execute(cmd, engine)
  }

  private _cancelDraw(engine: CanvasEngine): void {
    this._cleanupPreview(engine)
  }

  private _cleanupPreview(engine: CanvasEngine): void {
    const layer = engine.layers.get('annotations')

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
