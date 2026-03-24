import type Konva from 'konva'
import type { CanvasTool } from './base'
import type { CanvasEngine } from '../engine'

export class HandTool implements CanvasTool {
  readonly name = 'hand'
  readonly cursor = 'grab'

  activate(engine: CanvasEngine): void {
    engine.stage.draggable(true)
    this._setCursor(engine, 'grab')
  }

  deactivate(engine: CanvasEngine): void {
    engine.stage.draggable(false)
    this._setCursor(engine, 'default')
  }

  onMouseDown(_e: Konva.KonvaEventObject<MouseEvent>, engine: CanvasEngine): void {
    this._setCursor(engine, 'grabbing')
  }

  onMouseMove(_e: Konva.KonvaEventObject<MouseEvent>, _engine: CanvasEngine): void {
    // No-op
  }

  onMouseUp(_e: Konva.KonvaEventObject<MouseEvent>, engine: CanvasEngine): void {
    this._setCursor(engine, 'grab')
  }

  private _setCursor(engine: CanvasEngine, cursor: string): void {
    const container = engine.stage.container()
    if (container) {
      container.style.cursor = cursor
    }
  }
}
