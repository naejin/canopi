import Konva from 'konva'
import type { CanvasTool } from './base'
import type { CanvasEngine } from '../engine'
import { createEllipse, PREVIEW_DASH, zoneDefaults } from '../shapes'
import { AddNodeCommand } from '../commands'

export class EllipseTool implements CanvasTool {
  readonly name = 'ellipse'
  readonly cursor = 'crosshair'

  private _drawing = false
  private _startX = 0
  private _startY = 0
  private _preview: Konva.Ellipse | null = null

  private _rafId: number | null = null
  private _pendingPos: { x: number; y: number } | null = null

  activate(_engine: CanvasEngine): void {}

  deactivate(engine: CanvasEngine): void {
    this._cancelDraw(engine)
  }

  onMouseDown(e: Konva.KonvaEventObject<MouseEvent>, engine: CanvasEngine): void {
    if (e.evt.button !== 0) return

    const pos = engine.stage.getRelativePointerPosition()
    if (!pos) return

    this._drawing = true
    this._startX = pos.x
    this._startY = pos.y

    // Preview ellipse centred at start (zero radii initially)
    this._preview = new Konva.Ellipse({
      x: pos.x,
      y: pos.y,
      radiusX: 0,
      radiusY: 0,
      fill: zoneDefaults().fill,
      stroke: zoneDefaults().stroke,
      strokeWidth: zoneDefaults().strokeWidth,
      strokeScaleEnabled: false,
      dash: PREVIEW_DASH,
      listening: false,
    })

    const layer = engine.layers.get('zones')
    if (layer) {
      layer.add(this._preview)
      layer.batchDraw()
    }
  }

  onMouseMove(e: Konva.KonvaEventObject<MouseEvent>, engine: CanvasEngine): void {
    if (!this._drawing || !this._preview) return

    const pos = engine.stage.getRelativePointerPosition()
    if (!pos) return

    this._pendingPos = pos

    if (this._rafId !== null) return
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null
      if (!this._drawing || !this._preview || !this._pendingPos) return

      const { x, y } = this._pendingPos
      const shiftHeld = e.evt.shiftKey

      let rX = Math.abs(x - this._startX) / 2
      let rY = Math.abs(y - this._startY) / 2

      if (shiftHeld) {
        const r = Math.max(rX, rY)
        rX = r
        rY = r
      }

      const cx = (this._startX + x) / 2
      const cy = (this._startY + y) / 2

      this._preview.setAttrs({ x: cx, y: cy, radiusX: rX, radiusY: rY })

      const layer = this._preview.getLayer()
      layer?.batchDraw()
    })
  }

  onMouseUp(e: Konva.KonvaEventObject<MouseEvent>, engine: CanvasEngine): void {
    if (!this._drawing || !this._preview) return

    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId)
      this._rafId = null
    }

    const pos = engine.stage.getRelativePointerPosition()
    if (!pos) {
      this._cancelDraw(engine)
      return
    }

    let rX = Math.abs(pos.x - this._startX) / 2
    let rY = Math.abs(pos.y - this._startY) / 2

    if (e.evt.shiftKey) {
      const r = Math.max(rX, rY)
      rX = r
      rY = r
    }

    if (rX < 2 && rY < 2) {
      this._cancelDraw(engine)
      return
    }

    const cx = (this._startX + pos.x) / 2
    const cy = (this._startY + pos.y) / 2

    this._preview.destroy()
    this._preview = null
    this._drawing = false

    const finalShape = createEllipse({ x: cx, y: cy, radiusX: rX, radiusY: rY })
    const cmd = new AddNodeCommand('zones', finalShape)
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
    this._pendingPos = null
  }
}
