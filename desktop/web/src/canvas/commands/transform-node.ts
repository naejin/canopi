import type { Command } from '../history'
import type { CanvasEngine } from '../engine'

export interface TransformAttrs {
  x: number
  y: number
  scaleX: number
  scaleY: number
  rotation: number
  width?: number
  height?: number
}

/**
 * TransformNodeCommand — records a Transformer resize/rotate operation.
 * Used with history.record() since the transform has already happened.
 * execute (redo): apply newAttrs to the node.
 * undo: apply oldAttrs to the node.
 */
export class TransformNodeCommand implements Command {
  readonly type = 'transform-node'

  private _nodeId: string
  private _oldAttrs: TransformAttrs
  private _newAttrs: TransformAttrs

  constructor(nodeId: string, oldAttrs: TransformAttrs, newAttrs: TransformAttrs) {
    this._nodeId = nodeId
    this._oldAttrs = { ...oldAttrs }
    this._newAttrs = { ...newAttrs }
  }

  execute(engine: CanvasEngine): void {
    this._applyAttrs(engine, this._newAttrs)
  }

  undo(engine: CanvasEngine): void {
    this._applyAttrs(engine, this._oldAttrs)
  }

  private _applyAttrs(engine: CanvasEngine, attrs: TransformAttrs): void {
    for (const layer of engine.layers.values()) {
      const node = layer.findOne('#' + this._nodeId)
      if (node) {
        node.setAttrs(attrs)
        layer.batchDraw()
        return
      }
    }
  }
}
