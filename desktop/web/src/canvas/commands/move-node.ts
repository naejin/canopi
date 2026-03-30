import type { Command } from '../history'
import type { CanvasEngine } from '../engine'

interface Position {
  x: number
  y: number
}

/**
 * MoveNodeCommand — records a drag operation.
 * Used with history.record() since the drag has already happened.
 * execute (redo): move node to 'to' position.
 * undo: move node back to 'from' position.
 */
export class MoveNodeCommand implements Command {
  readonly type = 'move-node'
  readonly dirtyPasses = ['overlays', 'density', 'stacking'] as const

  private _nodeId: string
  private _from: Position
  private _to: Position

  constructor(nodeId: string, from: Position, to: Position) {
    this._nodeId = nodeId
    this._from = { ...from }
    this._to = { ...to }
  }

  execute(engine: CanvasEngine): void {
    this._applyPosition(engine, this._to)
  }

  undo(engine: CanvasEngine): void {
    this._applyPosition(engine, this._from)
  }

  private _applyPosition(engine: CanvasEngine, pos: Position): void {
    for (const layer of engine.layers.values()) {
      const node = layer.findOne('#' + this._nodeId)
      if (node) {
        node.position(pos)
        layer.batchDraw()
        return
      }
    }
  }
}
