import Konva from 'konva'
import type { CanvasCommandEngine, Command } from '../contracts'
import { groupSelected, ungroupSelected } from '../grouping'
import { selectedObjectIds } from '../../state/canvas'

/**
 * Group selected nodes — undoable.
 * Stores the group ID and member IDs so it can be reversed.
 */
export class GroupCommand implements Command {
  readonly type = 'group'
  readonly dirtyPasses = ['overlays', 'density', 'stacking'] as const
  private _groupId: string | null = null
  private _memberIds: string[] = []
  private _memberPositions: Map<string, { x: number; y: number }> = new Map()
  private _layerName: string | null = null

  execute(engine: CanvasCommandEngine): void {
    // Store pre-group positions for undo
    const nodes = engine.getSelectedNodes()
    for (const node of nodes) {
      this._memberIds.push(node.id())
      this._memberPositions.set(node.id(), { x: node.x(), y: node.y() })
      const layer = node.getLayer()
      if (layer) {
        for (const [name, l] of engine.layers) {
          if (l === layer) { this._layerName = name; break }
        }
      }
    }

    const group = groupSelected(engine)
    if (group) {
      this._groupId = group.id()
    }
  }

  undo(engine: CanvasCommandEngine): void {
    if (!this._groupId || !this._layerName) return

    const layer = engine.layers.get(this._layerName)
    if (!layer) return

    const group = layer.findOne('#' + this._groupId) as Konva.Group | null
    if (!group) return

    // Select the group first so ungroupSelected can find it
    selectedObjectIds.value = new Set([this._groupId])
    ungroupSelected(engine)

    // Restore original positions
    for (const [id, pos] of this._memberPositions) {
      const node = layer.findOne('#' + id)
      if (node) node.position(pos)
    }

    layer.batchDraw()
  }
}

/**
 * Ungroup selected groups — undoable.
 * Stores the group structure so it can be re-created on undo.
 */
export class UngroupCommand implements Command {
  readonly type = 'ungroup'
  readonly dirtyPasses = ['overlays', 'density', 'stacking'] as const
  private _groups: Array<{
    id: string
    pos: { x: number; y: number }
    rotation: number
    memberIds: string[]
    memberRelPositions: Map<string, { x: number; y: number }>
    layerName: string
  }> = []

  execute(engine: CanvasCommandEngine): void {
    const nodes = engine.getSelectedNodes()
    const groups = nodes.filter((n) => n.hasName('object-group'))

    for (const group of groups) {
      const layer = group.getLayer()
      if (!layer) continue

      let layerName = ''
      for (const [name, l] of engine.layers) {
        if (l === layer) { layerName = name; break }
      }

      const memberIds: string[] = []
      const memberRelPositions = new Map<string, { x: number; y: number }>()

      for (const child of (group as Konva.Group).getChildren()) {
        memberIds.push(child.id())
        memberRelPositions.set(child.id(), { x: child.x(), y: child.y() })
      }

      this._groups.push({
        id: group.id(),
        pos: group.position(),
        rotation: group.rotation(),
        memberIds,
        memberRelPositions,
        layerName,
      })
    }

    ungroupSelected(engine)
  }

  undo(engine: CanvasCommandEngine): void {
    for (const saved of this._groups) {
      const layer = engine.layers.get(saved.layerName)
      if (!layer) continue

      const group = new Konva.Group({
        id: saved.id,
        x: saved.pos.x,
        y: saved.pos.y,
        draggable: false,
        name: 'shape object-group',
      })
      if (saved.rotation !== 0) group.rotation(saved.rotation)

      for (const memberId of saved.memberIds) {
        const node = layer.findOne('#' + memberId)
        if (!node) continue

        const relPos = saved.memberRelPositions.get(memberId)
        node.moveTo(group)
        if (relPos) node.position(relPos)

        // Remove 'shape' name from children
        const names = node.name().split(' ').filter((n: string) => n !== 'shape')
        node.name(names.join(' '))
      }

      layer.add(group)
      selectedObjectIds.value = new Set([saved.id])
    }

    for (const layer of engine.layers.values()) layer.batchDraw()
  }
}
