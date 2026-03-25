import Konva from 'konva'
import type { CanvasEngine } from './engine'
import type { ObjectGroup } from '../types/design'
import { selectedObjectIds } from '../state/canvas'

// ---------------------------------------------------------------------------
// Grouping — wraps selected nodes into a Konva.Group (same layer, one level)
// Groupable types in Phase 3: zones (.shape) and plant groups (.plant-group)
// ---------------------------------------------------------------------------

/**
 * Group the currently selected nodes into a Konva.Group.
 * All nodes must be on the same layer. Returns the new group node, or null.
 */
export function groupSelected(engine: CanvasEngine): Konva.Group | null {
  const nodes = engine.getSelectedNodes()
  if (nodes.length < 2) return null

  // All nodes must be on the same layer
  const layer = nodes[0]!.getLayer()
  if (!layer) return null
  if (!nodes.every((n) => n.getLayer() === layer)) return null

  const groupId = crypto.randomUUID()
  const group = new Konva.Group({
    id: groupId,
    draggable: true,
    name: 'shape object-group',
  })

  // Compute group position as the top-left of the bounding box
  const rects = nodes.map((n) => n.getClientRect({ relativeTo: layer }))
  const minX = Math.min(...rects.map((r) => r.x))
  const minY = Math.min(...rects.map((r) => r.y))
  group.position({ x: minX, y: minY })

  // Reparent nodes into the group, adjusting positions to be relative to group origin
  for (const node of nodes) {
    const absX = node.x()
    const absY = node.y()
    node.moveTo(group)
    node.position({ x: absX - minX, y: absY - minY })
    // Remove 'shape' name and disable dragging so children aren't independent
    _removeShapeName(node)
    node.draggable(false)
  }

  layer.add(group)
  layer.batchDraw()

  // Select the new group
  selectedObjectIds.value = new Set([groupId])

  return group
}

/**
 * Ungroup a selected object group — extract children back to the layer.
 * Returns the extracted child nodes, or null.
 */
export function ungroupSelected(engine: CanvasEngine): Konva.Node[] | null {
  const nodes = engine.getSelectedNodes()
  const groups = nodes.filter((n) => n.hasName('object-group'))
  if (groups.length === 0) return null

  const extracted: Konva.Node[] = []

  for (const group of groups) {
    const layer = group.getLayer()
    if (!layer) continue

    const groupPos = group.position()
    const children = [...(group as Konva.Group).getChildren()]

    for (const child of children) {
      // Restore absolute position
      child.position({
        x: child.x() + groupPos.x,
        y: child.y() + groupPos.y,
      })
      child.moveTo(layer)
      // Restore 'shape' name and draggable so the node is selectable again
      _addShapeName(child)
      child.draggable(true)
      extracted.push(child)
    }

    group.destroy()
  }

  if (extracted.length > 0) {
    const layer = extracted[0]!.getLayer()
    layer?.batchDraw()
    selectedObjectIds.value = new Set(extracted.map((n) => n.id()))
  }

  return extracted.length > 0 ? extracted : null
}

/**
 * Extract ObjectGroup records from the canvas for serialization.
 */
export function extractGroups(engine: CanvasEngine): ObjectGroup[] {
  const groups: ObjectGroup[] = []

  for (const [layerName, layer] of engine.layers) {
    layer.find('.object-group').forEach((node: Konva.Node) => {
      const group = node as Konva.Group
      const memberIds: string[] = []

      for (const child of group.getChildren()) {
        if (child.hasName('plant-group')) {
          memberIds.push(child.id()) // persistent plant ID from 3-pre
        } else if (child.id()) {
          memberIds.push(child.id()) // zone name as ID
        }
      }

      if (memberIds.length > 0) {
        groups.push({
          id: group.id(),
          name: group.getAttr('data-group-name') ?? null,
          layer: layerName,
          position: { x: group.x(), y: group.y() },
          rotation: group.rotation() !== 0 ? group.rotation() : null,
          member_ids: memberIds,
        })
      }
    })
  }

  return groups
}

/**
 * Restore groups from loaded ObjectGroup records by finding member nodes by ID.
 */
export function restoreGroups(
  groupDefs: ObjectGroup[],
  engine: CanvasEngine,
): void {
  for (const def of groupDefs) {
    const layer = engine.layers.get(def.layer)
    if (!layer) continue

    // Find member nodes by ID
    const members: Konva.Node[] = []
    for (const memberId of def.member_ids) {
      const node = layer.findOne('#' + memberId)
      if (node) members.push(node)
    }

    if (members.length < 2) continue // Don't create group for 0-1 members

    const group = new Konva.Group({
      id: def.id,
      x: def.position.x,
      y: def.position.y,
      draggable: true,
      name: 'shape object-group',
    })
    if (def.rotation != null) group.rotation(def.rotation)
    if (def.name) group.setAttr('data-group-name', def.name)

    // Reparent members — adjust positions to be relative to group origin
    for (const node of members) {
      const absX = node.x()
      const absY = node.y()
      node.moveTo(group)
      node.position({ x: absX - def.position.x, y: absY - def.position.y })
      _removeShapeName(node)
      node.draggable(false)
    }

    layer.add(group)
  }
}

// ---------------------------------------------------------------------------
// Helpers — manage 'shape' name for selectability
// ---------------------------------------------------------------------------

function _removeShapeName(node: Konva.Node): void {
  const names = node.name().split(' ').filter((n) => n !== 'shape')
  node.name(names.join(' '))
}

function _addShapeName(node: Konva.Node): void {
  const names = node.name().split(' ').filter(Boolean)
  if (!names.includes('shape')) {
    names.push('shape')
  }
  node.name(names.join(' '))
}
