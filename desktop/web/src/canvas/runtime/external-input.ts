import Konva from 'konva'
import { activeTool } from '../../state/canvas'
import { AddNodeCommand } from '../commands'
import { createPlantNode } from '../plants'
import { getCanvasColor } from '../theme-refresh'
import type { CanvasTool } from '../tools/base'
import type { ExternalInputDeps } from './types'

export class CanvasExternalInput {
  private _boundKeyDown: (e: KeyboardEvent) => void
  private _boundKeyUp: (e: KeyboardEvent) => void
  private _boundMouseDown: ((e: Konva.KonvaEventObject<MouseEvent>) => void) | null = null
  private _boundMouseMove: ((e: Konva.KonvaEventObject<MouseEvent>) => void) | null = null
  private _boundMouseUp: ((e: Konva.KonvaEventObject<MouseEvent>) => void) | null = null
  private _boundWindowPointerMove: ((e: PointerEvent) => void) | null = null
  private _boundWindowPointerUp: ((e: PointerEvent) => void) | null = null
  private _boundDragOver: ((e: DragEvent) => void) | null = null
  private _boundDragLeave: ((e: DragEvent) => void) | null = null
  private _boundDrop: ((e: DragEvent) => void) | null = null

  // Drag-in-progress state: locks the tool that started the drag so
  // mousemove/mouseup always route to the same tool, even if activeTool
  // changes mid-drag.
  private _dragTool: CanvasTool | null = null

  constructor(private readonly _deps: ExternalInputDeps) {
    this._boundKeyDown = this._onKeyDown.bind(this)
    this._boundKeyUp = this._onKeyUp.bind(this)
  }

  init(): void {
    window.addEventListener('keydown', this._boundKeyDown)
    window.addEventListener('keyup', this._boundKeyUp)
    this._attachStageMouseEvents()
    this._attachDropHandlers()
  }

  destroy(): void {
    window.removeEventListener('keydown', this._boundKeyDown)
    window.removeEventListener('keyup', this._boundKeyUp)

    if (this._boundMouseDown) {
      this._deps.stage.off('mousedown', this._boundMouseDown)
      this._boundMouseDown = null
    }
    if (this._boundMouseMove) {
      this._deps.stage.off('mousemove', this._boundMouseMove)
      this._boundMouseMove = null
    }
    if (this._boundMouseUp) {
      this._deps.stage.off('mouseup', this._boundMouseUp)
      this._boundMouseUp = null
    }

    this._endDrag()

    const container = this._deps.stage.container()
    if (this._boundDragOver) {
      container.removeEventListener('dragover', this._boundDragOver)
      this._boundDragOver = null
    }
    if (this._boundDragLeave) {
      container.removeEventListener('dragleave', this._boundDragLeave)
      this._boundDragLeave = null
    }
    if (this._boundDrop) {
      container.removeEventListener('drop', this._boundDrop)
      this._boundDrop = null
    }
  }

  // -------------------------------------------------------------------------
  // Stage mouse events + window-level drag tracking
  // -------------------------------------------------------------------------

  private _attachStageMouseEvents(): void {
    // Konva mousedown/mousemove/mouseup fire when cursor is over the canvas.
    // For drags that leave the canvas, window-level pointermove/pointerup
    // take over and feed clamped positions back through the stage.
    this._boundMouseDown = (event) => {
      const tool = this._deps.toolRegistry.get(activeTool.value) ?? null
      this._dragTool = tool
      this._startWindowDragListeners()
      tool?.onMouseDown(event, this._deps.getEngine())
    }

    this._boundMouseMove = (event) => {
      const tool = this._dragTool ?? this._deps.toolRegistry.get(activeTool.value)
      tool?.onMouseMove(event, this._deps.getEngine())
    }

    this._boundMouseUp = (event) => {
      const tool = this._dragTool
      this._endDrag()
      tool?.onMouseUp(event, this._deps.getEngine())
    }

    this._deps.stage.on('mousedown', this._boundMouseDown)
    this._deps.stage.on('mousemove', this._boundMouseMove)
    this._deps.stage.on('mouseup', this._boundMouseUp)
  }

  /**
   * Attach window-level pointermove/pointerup for the duration of a drag.
   * When the cursor is inside the canvas, Konva fires its own events and
   * these are no-ops. When the cursor leaves, these kick in — converting
   * the screen position to a canvas-edge-clamped world position and firing
   * synthetic Konva events on the stage so the locked tool keeps updating.
   */
  private _startWindowDragListeners(): void {
    const container = this._deps.stage.container()

    this._boundWindowPointerMove = (e: PointerEvent) => {
      if (!this._dragTool) return
      // If the cursor is inside the canvas container, Konva handles it.
      // Only intervene when outside.
      if (this._isInsideContainer(e, container)) return

      const clamped = this._clampToContainer(e, container)
      this._injectClampedPosition(clamped)
      this._deps.stage.fire('mousemove', { evt: e } as unknown as Konva.KonvaEventObject<MouseEvent>)
    }

    this._boundWindowPointerUp = (e: PointerEvent) => {
      if (!this._dragTool) return

      // If outside, inject a clamped position so the tool commits at the edge.
      if (!this._isInsideContainer(e, container)) {
        const clamped = this._clampToContainer(e, container)
        this._injectClampedPosition(clamped)
      }
      this._deps.stage.fire('mouseup', { evt: e } as unknown as Konva.KonvaEventObject<MouseEvent>)
    }

    window.addEventListener('pointermove', this._boundWindowPointerMove)
    window.addEventListener('pointerup', this._boundWindowPointerUp)
  }

  /** Remove window-level drag listeners and clear drag state. */
  private _endDrag(): void {
    if (this._boundWindowPointerMove) {
      window.removeEventListener('pointermove', this._boundWindowPointerMove)
      this._boundWindowPointerMove = null
    }
    if (this._boundWindowPointerUp) {
      window.removeEventListener('pointerup', this._boundWindowPointerUp)
      this._boundWindowPointerUp = null
    }
    this._dragTool = null
  }

  /** Check if a pointer event is inside the canvas container bounds. */
  private _isInsideContainer(e: PointerEvent, container: HTMLDivElement): boolean {
    const rect = container.getBoundingClientRect()
    return (
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom
    )
  }

  /**
   * Clamp a pointer event's screen coordinates to the canvas container edges,
   * then convert to world (canvas) coordinates. The clamped point lies on the
   * line from the container center to the cursor — so the shape edge stays
   * aligned with the cursor direction.
   */
  private _clampToContainer(e: PointerEvent, container: HTMLDivElement): { x: number; y: number } {
    const rect = container.getBoundingClientRect()
    const clampedScreenX = Math.max(rect.left, Math.min(rect.right, e.clientX))
    const clampedScreenY = Math.max(rect.top, Math.min(rect.bottom, e.clientY))

    const localX = clampedScreenX - rect.left
    const localY = clampedScreenY - rect.top
    const scale = this._deps.stage.scaleX()
    return {
      x: (localX - this._deps.stage.x()) / scale,
      y: (localY - this._deps.stage.y()) / scale,
    }
  }

  /**
   * Temporarily override `stage.getRelativePointerPosition()` so the next
   * tool call sees the clamped position instead of the real (off-canvas) one.
   * Restores the original method after one call.
   */
  private _injectClampedPosition(pos: { x: number; y: number }): void {
    const stage = this._deps.stage
    const original = stage.getRelativePointerPosition.bind(stage)
    stage.getRelativePointerPosition = () => {
      stage.getRelativePointerPosition = original
      return pos
    }
  }

  // -------------------------------------------------------------------------
  // Keyboard events
  // -------------------------------------------------------------------------

  private _onKeyDown(event: KeyboardEvent): void {
    if (event.code === 'Space' && !this._deps.getSpaceHeld()) {
      this._deps.setSpaceHeld(true)
      this._deps.setWasSpaceDraggable(this._deps.stage.draggable())
      this._deps.stage.draggable(true)
      const container = this._deps.stage.container()
      if (container) container.style.cursor = 'grab'
    }

    this._deps.toolRegistry.get(activeTool.value)?.onKeyDown?.(event, this._deps.getEngine())
  }

  private _onKeyUp(event: KeyboardEvent): void {
    if (event.code !== 'Space') return
    this._deps.setSpaceHeld(false)
    this._deps.stage.draggable(this._deps.getWasSpaceDraggable())
    const container = this._deps.stage.container()
    if (container) container.style.cursor = this._deps.getActiveToolCursor()
  }

  // -------------------------------------------------------------------------
  // Drag-and-drop (plant placement from panel)
  // -------------------------------------------------------------------------

  private _attachDropHandlers(): void {
    const container = this._deps.stage.container()
    let ghostNode: Konva.Group | null = null

    const plantsLayer = (): Konva.Layer | undefined => this._deps.layers.get('plants')
    const removeGhost = (): void => {
      if (!ghostNode) return
      ghostNode.destroy()
      ghostNode = null
      plantsLayer()?.batchDraw()
    }

    const parseDragData = (event: DragEvent): {
      canonical_name: string
      common_name: string | null
      stratum: string | null
      width_max_m: number | null
    } | null => {
      let raw: string | null = null
      try {
        raw = event.dataTransfer?.getData('text/plain') ?? null
      } catch {
        return null
      }
      if (!raw) return null

      try {
        const data = JSON.parse(raw)
        if (typeof data.canonical_name !== 'string') return null
        return {
          canonical_name: data.canonical_name as string,
          common_name: typeof data.common_name === 'string' ? data.common_name : null,
          stratum: typeof data.stratum === 'string' ? data.stratum : null,
          width_max_m: typeof data.width_max_m === 'number' ? data.width_max_m : null,
        }
      } catch {
        return null
      }
    }

    const domToCanvas = (event: DragEvent): { x: number; y: number } => {
      const rect = container.getBoundingClientRect()
      const screenX = event.clientX - rect.left
      const screenY = event.clientY - rect.top
      const scale = this._deps.stage.scaleX()
      return {
        x: (screenX - this._deps.stage.x()) / scale,
        y: (screenY - this._deps.stage.y()) / scale,
      }
    }

    this._boundDragOver = (event) => {
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'

      const pos = domToCanvas(event)
      if (!ghostNode) {
        const inv = 1 / this._deps.stage.scaleX()
        ghostNode = new Konva.Group({
          x: pos.x,
          y: pos.y,
          listening: false,
          opacity: 0.5,
          name: 'plant-ghost',
        })

        const ghostCircle = new Konva.Circle({
          radius: 8,
          fill: getCanvasColor('zone-stroke'),
          opacity: 0.5,
          stroke: getCanvasColor('zone-stroke'),
          strokeWidth: 1.5,
          strokeScaleEnabled: false,
        })
        ghostCircle.scale({ x: inv, y: inv })
        ghostNode.add(ghostCircle)
        plantsLayer()?.add(ghostNode as unknown as Konva.Shape)
      }

      ghostNode.position(pos)
      plantsLayer()?.batchDraw()
    }

    this._boundDragLeave = () => {
      removeGhost()
    }

    this._boundDrop = (event) => {
      event.preventDefault()
      removeGhost()

      const data = parseDragData(event)
      if (!data) return

      const pos = domToCanvas(event)
      const plantNode = createPlantNode({
        id: crypto.randomUUID(),
        canonicalName: data.canonical_name,
        commonName: data.common_name,
        stratum: data.stratum,
        canopySpreadM: data.width_max_m,
        position: pos,
        stageScale: this._deps.stage.scaleX(),
      })

      this._deps.history.execute(new AddNodeCommand('plants', plantNode), this._deps.getEngine())
    }

    container.addEventListener('dragover', this._boundDragOver)
    container.addEventListener('dragleave', this._boundDragLeave)
    container.addEventListener('drop', this._boundDrop)
  }
}
