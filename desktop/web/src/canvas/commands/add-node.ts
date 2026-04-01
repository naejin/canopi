import Konva from 'konva'
import { activeTool } from '../../state/canvas'
import type { CanvasCommandEngine, Command } from '../contracts'
import { serializeNode, recreateNode, type SerializedNode } from './node-serialization'

/**
 * AddNodeCommand — records a shape creation.
 * execute: add (or re-add on redo) the node to the named layer.
 * undo: remove the node from whatever layer contains it.
 *
 * Accepts either a live Konva.Node (first execute) or re-serializes on each
 * subsequent redo so the node is always fresh and not shared.
 */
export class AddNodeCommand implements Command {
  readonly type = 'add-node'
  readonly dirtyPasses

  private _layerName: string
  private _serialized: SerializedNode

  constructor(layerName: string, node: Konva.Node) {
    this._layerName = layerName
    this._serialized = serializeNode(node)
    this.dirtyPasses = getLayerDirtyPasses(layerName)
  }

  execute(engine: CanvasCommandEngine): void {
    const node = recreateNode(this._serialized)
    // Draggable state is governed by the active tool — only the select tool
    // allows dragging. Newly added nodes inherit the current tool's policy.
    if (node.hasName('shape')) {
      node.draggable(activeTool.value === 'select')
    }
    const layer = engine.layers.get(this._layerName)
    if (layer) {
      layer.add(node as unknown as Konva.Shape)
      layer.batchDraw()
    }
  }

  undo(engine: CanvasCommandEngine): void {
    const id = this._serialized.attrs.id as string | undefined
    if (!id) return
    engine.removeNode(id)
  }
}

function getLayerDirtyPasses(layerName: string) {
  if (layerName === 'plants') {
    return ['plant-display', 'lod', 'density', 'stacking'] as const
  }
  if (layerName === 'annotations') {
    return ['annotations', 'overlays'] as const
  }
  return ['overlays'] as const
}
