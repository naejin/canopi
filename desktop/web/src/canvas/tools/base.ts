import type Konva from 'konva'
import type { CanvasEngine } from '../engine'

export interface CanvasTool {
  name: string
  /** CSS cursor value applied to the stage container while this tool is active */
  cursor: string
  activate(engine: CanvasEngine): void
  deactivate(engine: CanvasEngine): void
  onMouseDown(e: Konva.KonvaEventObject<MouseEvent>, engine: CanvasEngine): void
  onMouseMove(e: Konva.KonvaEventObject<MouseEvent>, engine: CanvasEngine): void
  onMouseUp(e: Konva.KonvaEventObject<MouseEvent>, engine: CanvasEngine): void
  onKeyDown?(e: KeyboardEvent, engine: CanvasEngine): void
}
