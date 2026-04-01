import type Konva from 'konva'
import type { CanvasToolEngine } from '../contracts'

export interface CanvasTool {
  name: string
  /** CSS cursor value applied to the stage container while this tool is active */
  cursor: string
  activate(engine: CanvasToolEngine): void
  deactivate(engine: CanvasToolEngine): void
  onMouseDown(e: Konva.KonvaEventObject<MouseEvent>, engine: CanvasToolEngine): void
  onMouseMove(e: Konva.KonvaEventObject<MouseEvent>, engine: CanvasToolEngine): void
  onMouseUp(e: Konva.KonvaEventObject<MouseEvent>, engine: CanvasToolEngine): void
  onKeyDown?(e: KeyboardEvent, engine: CanvasToolEngine): void
}
