import Konva from 'konva'
import type { CanvasTool } from './base'
import type { CanvasToolEngine } from '../contracts'
import { createRect, PREVIEW_DASH, zoneDefaults } from '../shapes'
import { AddNodeCommand } from '../commands'

export class RectangleTool implements CanvasTool {
  readonly name = 'rectangle'
  readonly cursor = 'crosshair'

  // Drawing state
  private _drawing = false
  private _startX = 0
  private _startY = 0
  private _preview: Konva.Rect | null = null

  // rAF throttle
  private _rafId: number | null = null
  private _pendingPos: { x: number; y: number } | null = null

  activate(_engine: CanvasToolEngine): void {
    // Nothing extra needed
  }

  deactivate(engine: CanvasToolEngine): void {
    this._cancelDraw(engine)
  }

  onMouseDown(e: Konva.KonvaEventObject<MouseEvent>, engine: CanvasToolEngine): void {
    // Only draw on left button, ignore right/middle
    if (e.evt.button !== 0) return

    // Cancel any in-progress draw first — this handles the case where
    // mouseup was lost (e.g. pointer left canvas and clicked elsewhere).
    if (this._drawing) {
      this._cancelDraw(engine)
    }

    const pos = engine.stage.getRelativePointerPosition()
    if (!pos) return

    this._drawing = true
    this._startX = pos.x
    this._startY = pos.y

    this._preview = new Konva.Rect({
      x: pos.x,
      y: pos.y,
      width: 0,
      height: 0,
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

  onMouseMove(e: Konva.KonvaEventObject<MouseEvent>, engine: CanvasToolEngine): void {
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

      let dx = x - this._startX
      let dy = y - this._startY

      if (shiftHeld) {
        const side = Math.max(Math.abs(dx), Math.abs(dy))
        dx = dx < 0 ? -side : side
        dy = dy < 0 ? -side : side
      }

      // Normalise negative extents
      const rectX = dx < 0 ? this._startX + dx : this._startX
      const rectY = dy < 0 ? this._startY + dy : this._startY
      const rectW = Math.abs(dx)
      const rectH = Math.abs(dy)

      this._preview.setAttrs({ x: rectX, y: rectY, width: rectW, height: rectH })

      const layer = this._preview.getLayer()
      layer?.batchDraw()
    })
  }

  onMouseUp(e: Konva.KonvaEventObject<MouseEvent>, engine: CanvasToolEngine): void {
    if (!this._drawing || !this._preview) return

    // Cancel any pending rAF so we read the final position cleanly
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId)
      this._rafId = null
    }

    // Use stage pointer position, falling back to the preview's current
    // extent when the cursor is outside the canvas (the preview was already
    // clamped to the canvas edge by the last mousemove from external-input).
    const pos = engine.stage.getRelativePointerPosition()
      ?? { x: this._preview.x() + this._preview.width(), y: this._preview.y() + this._preview.height() }

    let dx = pos.x - this._startX
    let dy = pos.y - this._startY

    if (e.evt.shiftKey) {
      const side = Math.max(Math.abs(dx), Math.abs(dy))
      dx = dx < 0 ? -side : side
      dy = dy < 0 ? -side : side
    }

    // Discard tiny accidental shapes — threshold is 4 screen pixels converted
    // to world units so the check is scale-independent (works at any zoom level).
    const minWorld = 4 / engine.stage.scaleX()
    if (Math.abs(dx) < minWorld && Math.abs(dy) < minWorld) {
      this._cancelDraw(engine)
      return
    }

    const rectX = dx < 0 ? this._startX + dx : this._startX
    const rectY = dy < 0 ? this._startY + dy : this._startY
    const rectW = Math.abs(dx)
    const rectH = Math.abs(dy)

    // Remove preview, add final shape
    this._preview.destroy()
    this._preview = null
    this._drawing = false

    const finalShape = createRect({ x: rectX, y: rectY, width: rectW, height: rectH })
    const cmd = new AddNodeCommand('zones', finalShape)
    engine.history.execute(cmd, engine)
  }

  onKeyDown(e: KeyboardEvent, engine: CanvasToolEngine): void {
    if (e.key === 'Escape') {
      this._cancelDraw(engine)
    }
  }

  private _cancelDraw(_engine: CanvasToolEngine): void {
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
