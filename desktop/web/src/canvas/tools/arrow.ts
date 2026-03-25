import Konva from 'konva'
import type { CanvasTool } from './base'
import type { CanvasEngine } from '../engine'
import { AddNodeCommand } from '../commands'
import { PREVIEW_DASH } from '../shapes'

const ARROW_STROKE = '#64748B'
const ARROW_POINTER_LENGTH = 12
const ARROW_POINTER_WIDTH = 8

export class ArrowTool implements CanvasTool {
  readonly name = 'arrow'
  readonly cursor = 'crosshair'

  private _startPos: { x: number; y: number } | null = null
  private _previewLine: Konva.Line | null = null

  activate(_engine: CanvasEngine): void {}

  deactivate(engine: CanvasEngine): void {
    this._cancel(engine)
  }

  onMouseDown(e: Konva.KonvaEventObject<MouseEvent>, engine: CanvasEngine): void {
    if (e.evt.button !== 0) return
    const pos = engine.stage.getRelativePointerPosition()
    if (!pos) return

    if (!this._startPos) {
      // First click — set start point
      this._startPos = pos
      const layer = engine.layers.get('annotations')
      if (!layer) return

      this._previewLine = new Konva.Line({
        points: [pos.x, pos.y, pos.x, pos.y],
        stroke: ARROW_STROKE,
        strokeWidth: 2,
        strokeScaleEnabled: false,
        dash: PREVIEW_DASH,
        listening: false,
      })
      layer.add(this._previewLine)
      layer.batchDraw()
    } else {
      // Second click — create arrow
      const arrow = new Konva.Arrow({
        id: crypto.randomUUID(),
        points: [this._startPos.x, this._startPos.y, pos.x, pos.y],
        stroke: ARROW_STROKE,
        strokeWidth: 2,
        strokeScaleEnabled: false,
        pointerLength: ARROW_POINTER_LENGTH,
        pointerWidth: ARROW_POINTER_WIDTH,
        fill: ARROW_STROKE,
        lineCap: 'round',
        lineJoin: 'round',
        draggable: true,
        name: 'shape annotation-arrow',
      })

      // Clean up preview
      this._previewLine?.destroy()
      this._previewLine = null
      this._startPos = null

      const cmd = new AddNodeCommand('annotations', arrow)
      engine.history.execute(cmd, engine)
    }
  }

  onMouseMove(_e: Konva.KonvaEventObject<MouseEvent>, engine: CanvasEngine): void {
    if (!this._previewLine || !this._startPos) return
    const pos = engine.stage.getRelativePointerPosition()
    if (!pos) return

    this._previewLine.points([this._startPos.x, this._startPos.y, pos.x, pos.y])
    engine.layers.get('annotations')?.batchDraw()
  }

  onMouseUp(_e: Konva.KonvaEventObject<MouseEvent>, _engine: CanvasEngine): void {}

  onKeyDown(e: KeyboardEvent, engine: CanvasEngine): void {
    if (e.key === 'Escape') {
      this._cancel(engine)
    }
  }

  private _cancel(engine: CanvasEngine): void {
    this._previewLine?.destroy()
    this._previewLine = null
    this._startPos = null
    engine.layers.get('annotations')?.batchDraw()
  }
}
