import Konva from 'konva'
import type { CanvasTool } from './base'
import type { CanvasEngine } from '../engine'
import { AddNodeCommand } from '../commands'
import { createDimensionGroup, registerDimension } from '../dimensions'
import { PREVIEW_DASH } from '../shapes'

/**
 * Dimension Tool — click two points (or shapes) to create a measurement line.
 * If clicks land on shape nodes, the dimension attaches to those nodes and
 * auto-updates when they move.
 */
export class DimensionTool implements CanvasTool {
  readonly name = 'dimension'
  readonly cursor = 'crosshair'

  private _startPos: { x: number; y: number } | null = null
  private _startNodeId: string | null = null
  private _previewLine: Konva.Line | null = null

  activate(_engine: CanvasEngine): void {}

  deactivate(engine: CanvasEngine): void {
    this._cancel(engine)
  }

  onMouseDown(e: Konva.KonvaEventObject<MouseEvent>, engine: CanvasEngine): void {
    if (e.evt.button !== 0) return

    const pos = engine.stage.getRelativePointerPosition()
    if (!pos) return

    // Check if click landed on a shape node
    const target = e.target
    const clickedNodeId = (target !== engine.stage && target.hasName('shape'))
      ? target.id()
      : null

    if (!this._startPos) {
      // First click — set start
      this._startPos = pos
      this._startNodeId = clickedNodeId

      const layer = engine.layers.get('annotations')
      if (!layer) return

      this._previewLine = new Konva.Line({
        points: [pos.x, pos.y, pos.x, pos.y],
        stroke: '#64748B',
        strokeWidth: 1,
        strokeScaleEnabled: false,
        dash: PREVIEW_DASH,
        listening: false,
      })
      layer.add(this._previewLine)
      layer.batchDraw()
    } else {
      // Second click — create dimension
      const dimId = crypto.randomUUID()
      const stageScale = engine.stage.scaleX()

      const dimGroup = createDimensionGroup(dimId, this._startPos, pos, stageScale)

      // Store attachment custom attrs
      dimGroup.setAttr('data-attach-source', this._startNodeId ?? null)
      dimGroup.setAttr('data-attach-target', clickedNodeId ?? null)

      // Register for live tracking
      registerDimension({
        dimensionId: dimId,
        sourceId: this._startNodeId,
        targetId: clickedNodeId,
        sourcePoint: { ...this._startPos },
        targetPoint: { ...pos },
      })

      this._previewLine?.destroy()
      this._previewLine = null
      this._startPos = null
      this._startNodeId = null

      const cmd = new AddNodeCommand('annotations', dimGroup)
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
    if (e.key === 'Escape') this._cancel(engine)
  }

  private _cancel(engine: CanvasEngine): void {
    this._previewLine?.destroy()
    this._previewLine = null
    this._startPos = null
    this._startNodeId = null
    engine.layers.get('annotations')?.batchDraw()
  }
}
