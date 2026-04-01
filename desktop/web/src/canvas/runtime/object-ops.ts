import Konva from 'konva'
import { activeTool, lockedObjectIds, selectedObjectIds } from '../../state/canvas'
import { AddNodeCommand, BatchCommand, RemoveNodeCommand } from '../commands'
import { alignNodes, type Alignment, type DistributeAxis, distributeNodes } from '../alignment'
import { GroupCommand, UngroupCommand } from '../commands/group'
import { serializeNode, recreateNode } from '../commands/node-serialization'
import { extractGroups, restoreGroups } from '../grouping'
import type { ObjectGroup, PlacedPlant } from '../../types/design'
import type { CanvasEngine } from '../engine'
import type { ObjectOpsDeps } from './types'

export class CanvasObjectOps {
  constructor(private readonly _deps: ObjectOpsDeps) {}

  getLayerForTool(toolName: string): Konva.Layer {
    const zoneTools = new Set(['rectangle', 'ellipse', 'polygon', 'freeform'])
    const layerName = zoneTools.has(toolName) ? 'zones' : 'annotations'
    return this._deps.layers.get(layerName)!
  }

  addNode(layerName: string, node: Konva.Node): void {
    const layer = this._deps.layers.get(layerName)
    if (!layer) return
    layer.add(node as unknown as Konva.Shape)
    layer.batchDraw()
  }

  removeNode(nodeId: string): void {
    for (const layer of this._deps.layers.values()) {
      const node = layer.findOne('#' + nodeId)
      if (!node) continue
      node.destroy()
      layer.batchDraw()
      return
    }
  }

  getSelectedNodes(): Konva.Node[] {
    const ids = selectedObjectIds.value
    const nodes: Konva.Node[] = []
    for (const layer of this._deps.layers.values()) {
      layer.find('.shape').forEach((node) => {
        if (ids.has(node.id())) nodes.push(node)
      })
    }
    return nodes
  }

  deleteSelected(engine: CanvasEngine): void {
    const nodes = this.getSelectedNodes()
    if (nodes.length === 0) return

    const cmds = nodes.map((node) => {
      const layerName = node.getLayer()?.id() ?? 'annotations'
      return new RemoveNodeCommand(layerName, node)
    })

    selectedObjectIds.value = new Set()
    this._deps.history.execute(new BatchCommand(cmds), engine)
  }

  duplicateSelected(engine: CanvasEngine): void {
    const nodes = this.getSelectedNodes()
    if (nodes.length === 0) return

    const cmds: AddNodeCommand[] = []
    const newIds = new Set<string>()

    for (const node of nodes) {
      const clone = node.clone({ id: crypto.randomUUID() }) as Konva.Node
      clone.x(clone.x() + 20)
      clone.y(clone.y() + 20)
      const layerName = node.getLayer()?.id() ?? 'annotations'
      cmds.push(new AddNodeCommand(layerName, clone))
      newIds.add(clone.id())
      clone.destroy()
    }

    selectedObjectIds.value = newIds
    this._deps.history.execute(new BatchCommand(cmds), engine)
  }

  copyToClipboard(): void {
    const nodes = this.getSelectedNodes()
    if (nodes.length === 0) return
    this._deps.setClipboard(JSON.stringify(nodes.map((node) => serializeNode(node))))
  }

  pasteFromClipboard(engine: CanvasEngine): void {
    const rawClipboard = this._deps.getClipboard()
    if (!rawClipboard) return

    let items: ReturnType<typeof serializeNode>[]
    try {
      items = JSON.parse(rawClipboard)
    } catch {
      return
    }

    if (items.length === 0) return

    const cmds: AddNodeCommand[] = []
    const newIds = new Set<string>()

    for (const item of items) {
      const id = crypto.randomUUID()
      item.attrs.id = id
      item.attrs.x = ((item.attrs.x as number) || 0) + 20
      item.attrs.y = ((item.attrs.y as number) || 0) + 20

      const node = recreateNode(item)
      let layerName = 'zones'
      if (node.hasName('plant-group')) layerName = 'plants'
      else if (node.hasName('annotation-text') || node.hasName('measure-label')) layerName = 'annotations'
      else if (node.getClassName() === 'Text') layerName = 'annotations'

      cmds.push(new AddNodeCommand(layerName, node))
      newIds.add(id)
      node.destroy()
    }

    if (cmds.length > 0) {
      this._deps.history.execute(new BatchCommand(cmds), engine)
    }

    selectedObjectIds.value = newIds
  }

  bringToFront(): void {
    const nodes = this.getSelectedNodes()
    if (nodes.length === 0) return
    const affectedLayers = new Set<Konva.Layer>()
    for (const node of nodes) {
      node.moveToTop()
      const layer = node.getLayer()
      if (layer) affectedLayers.add(layer)
    }
    for (const layer of affectedLayers) layer.batchDraw()
  }

  sendToBack(): void {
    const nodes = this.getSelectedNodes()
    if (nodes.length === 0) return
    const affectedLayers = new Set<Konva.Layer>()
    for (const node of nodes) {
      node.moveToBottom()
      const layer = node.getLayer()
      if (layer) affectedLayers.add(layer)
    }
    for (const layer of affectedLayers) layer.batchDraw()
  }

  lockSelected(): void {
    const ids = selectedObjectIds.value
    if (ids.size === 0) return

    const locked = new Set(lockedObjectIds.value)
    for (const id of ids) {
      locked.add(id)
      for (const layer of this._deps.layers.values()) {
        const node = layer.findOne('#' + id)
        if (node) {
          node.draggable(false)
          break
        }
      }
    }

    lockedObjectIds.value = locked
    selectedObjectIds.value = new Set()
  }

  unlockSelected(): void {
    const locked = lockedObjectIds.value
    for (const id of locked) {
      for (const layer of this._deps.layers.values()) {
        const node = layer.findOne('#' + id)
        if (node) {
          node.draggable(activeTool.value === 'select')
          break
        }
      }
    }
    lockedObjectIds.value = new Set()
  }

  selectAll(): void {
    const locked = lockedObjectIds.value
    const ids = new Set<string>()
    for (const layer of this._deps.layers.values()) {
      if (!layer.visible()) continue
      layer.find('.shape').forEach((node) => {
        if (!locked.has(node.id())) ids.add(node.id())
      })
    }
    selectedObjectIds.value = ids
  }

  alignSelected(alignment: Alignment, engine: CanvasEngine): void {
    const cmd = alignNodes(this.getSelectedNodes(), alignment)
    if (!cmd) return
    this._deps.history.record(cmd, engine)
    this.batchDrawAllLayers()
  }

  distributeSelected(axis: DistributeAxis, engine: CanvasEngine): void {
    const cmd = distributeNodes(this.getSelectedNodes(), axis)
    if (!cmd) return
    this._deps.history.record(cmd, engine)
    this.batchDrawAllLayers()
  }

  groupSelectedNodes(engine: CanvasEngine): void {
    this._deps.history.execute(new GroupCommand(), engine)
  }

  ungroupSelectedNodes(engine: CanvasEngine): void {
    this._deps.history.execute(new UngroupCommand(), engine)
  }

  getPlacedPlants(): PlacedPlant[] {
    const plantsLayer = this._deps.layers.get('plants')
    if (!plantsLayer) return []

    const result: PlacedPlant[] = []
    plantsLayer.find('.plant-group').forEach((node: Konva.Node) => {
      const group = node as Konva.Group
      const commonName = group.getAttr('data-common-name') as string || null
      result.push({
        id: group.id(),
        canonical_name: group.getAttr('data-canonical-name') as string || '',
        common_name: commonName || null,
        position: group.getAbsolutePosition(plantsLayer),
        rotation: group.rotation() !== 0 ? group.rotation() : null,
        scale: null,
        notes: group.getAttr('data-notes') ?? null,
        planted_date: group.getAttr('data-planted-date') ?? null,
        quantity: group.getAttr('data-quantity') ?? null,
      })
    })
    return result
  }

  getObjectGroups(engine: CanvasEngine): ObjectGroup[] {
    return extractGroups(engine)
  }

  restoreObjectGroups(groups: ObjectGroup[], engine: CanvasEngine): void {
    restoreGroups(groups, engine)
  }

  private batchDrawAllLayers(): void {
    for (const layer of this._deps.layers.values()) layer.batchDraw()
  }
}
