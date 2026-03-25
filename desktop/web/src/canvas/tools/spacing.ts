import Konva from 'konva'
import type { CanvasTool } from './base'
import type { CanvasEngine } from '../engine'
import { plantStampSpecies } from '../../state/canvas'
import { createPlantNode } from '../plants'
import { AddNodeCommand, BatchCommand } from '../commands'
import { generateLinePoints } from '../pattern-math'
import { PREVIEW_DASH } from '../shapes'

/**
 * Spacing Tool — click two points to distribute N plants evenly along a line.
 * Requires a stamp species to be set.
 */
export class SpacingTool implements CanvasTool {
  readonly name = 'spacing'
  readonly cursor = 'crosshair'

  private _startPos: { x: number; y: number } | null = null
  private _previewLine: Konva.Line | null = null

  activate(_engine: CanvasEngine): void {}

  deactivate(engine: CanvasEngine): void {
    this._cancel(engine)
  }

  onMouseDown(e: Konva.KonvaEventObject<MouseEvent>, engine: CanvasEngine): void {
    if (e.evt.button !== 0) return
    const species = plantStampSpecies.value
    if (!species) return

    const pos = engine.stage.getRelativePointerPosition()
    if (!pos) return

    if (!this._startPos) {
      this._startPos = pos
      const layer = engine.layers.get('annotations')
      if (!layer) return

      this._previewLine = new Konva.Line({
        points: [pos.x, pos.y, pos.x, pos.y],
        stroke: '#64748B',
        strokeWidth: 2,
        strokeScaleEnabled: false,
        dash: PREVIEW_DASH,
        listening: false,
      })
      layer.add(this._previewLine)
      layer.batchDraw()
    } else {
      const countStr = window.prompt('Number of plants:', '5')
      if (!countStr) { this._cancel(engine); return }
      const count = parseInt(countStr, 10)
      if (isNaN(count) || count < 1) { this._cancel(engine); return }

      const points = generateLinePoints(this._startPos, pos, count)
      const stageScale = engine.stage.scaleX()
      const cmds: AddNodeCommand[] = []

      for (const p of points) {
        const node = createPlantNode({
          id: crypto.randomUUID(),
          canonicalName: species.canonical_name,
          commonName: species.common_name,
          stratum: species.stratum,
          canopySpreadM: species.width_max_m,
          position: p,
          stageScale,
        })
        cmds.push(new AddNodeCommand('plants', node))
      }

      this._previewLine?.destroy()
      this._previewLine = null
      this._startPos = null

      if (cmds.length > 0) {
        engine.history.execute(new BatchCommand(cmds), engine)
      }
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
    engine.layers.get('annotations')?.batchDraw()
  }
}
