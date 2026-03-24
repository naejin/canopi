import Konva from 'konva'
import type { Command } from '../history'
import type { CanvasEngine } from '../engine'
import { serializeNode, recreateNode, type SerializedNode } from './node-serialization'

/**
 * RemoveNodeCommand — records a shape deletion.
 * execute: remove the node from its layer (destroys it).
 * undo: recreate the node from stored attrs and add it back.
 *
 * The layer name is captured at construction time by finding the node
 * in the engine. Callers must construct this command BEFORE destroying
 * the node, passing the live node reference.
 */
export class RemoveNodeCommand implements Command {
  readonly type = 'remove-node'

  private _layerName: string
  private _serialized: SerializedNode

  constructor(layerName: string, node: Konva.Node) {
    this._layerName = layerName
    this._serialized = serializeNode(node)
  }

  execute(engine: CanvasEngine): void {
    const id = this._serialized.attrs.id as string | undefined
    if (!id) return
    engine.removeNode(id)
  }

  undo(engine: CanvasEngine): void {
    const node = recreateNode(this._serialized)
    const layer = engine.layers.get(this._layerName)
    if (layer) {
      layer.add(node as unknown as Konva.Shape)
      layer.batchDraw()
    }
  }
}
