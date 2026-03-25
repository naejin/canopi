import Konva from 'konva'

// ---------------------------------------------------------------------------
// DimensionManager — tracks attached dimension lines and updates them
// when source/target nodes move.
// ---------------------------------------------------------------------------

const DIMENSION_STROKE = '#64748B'
const DIMENSION_LABEL_BG = 'rgba(255, 255, 255, 0.85)'
const TICK_LENGTH = 8 // screen pixels
const LABEL_FONT_SIZE = 11

export interface DimensionAttachment {
  dimensionId: string
  sourceId: string | null // node ID or null for free point
  targetId: string | null
  sourcePoint: { x: number; y: number } // fallback if no sourceId
  targetPoint: { x: number; y: number }
}

const _attachments = new Map<string, DimensionAttachment>()

export function registerDimension(attachment: DimensionAttachment): void {
  _attachments.set(attachment.dimensionId, attachment)
}

export function unregisterDimension(dimensionId: string): void {
  _attachments.delete(dimensionId)
}

/**
 * Create a dimension line group: two ticks + connecting line + distance label.
 * Counter-scaled so it appears at constant screen size.
 */
export function createDimensionGroup(
  id: string,
  start: { x: number; y: number },
  end: { x: number; y: number },
  stageScale: number,
): Konva.Group {
  const inv = 1 / stageScale
  const dist = Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2)
  const angle = Math.atan2(end.y - start.y, end.x - start.x)

  const midX = (start.x + end.x) / 2
  const midY = (start.y + end.y) / 2

  const group = new Konva.Group({
    id,
    x: midX,
    y: midY,
    draggable: true,
    name: 'shape annotation-dimension',
    scaleX: inv,
    scaleY: inv,
  })

  // The dimension line is drawn in local coordinates centered at (0,0)
  const halfLen = (dist * stageScale) / 2

  // Main connecting line
  const line = new Konva.Line({
    points: [-halfLen, 0, halfLen, 0],
    stroke: DIMENSION_STROKE,
    strokeWidth: 1,
    listening: false,
    rotation: (angle * 180) / Math.PI,
  })
  group.add(line)

  // Start tick
  const perpAngle = angle + Math.PI / 2
  const tickDx = Math.cos(perpAngle) * TICK_LENGTH / 2
  const tickDy = Math.sin(perpAngle) * TICK_LENGTH / 2
  // Transform start/end to local coords
  const localStartX = (start.x - midX) * stageScale
  const localStartY = (start.y - midY) * stageScale
  const localEndX = (end.x - midX) * stageScale
  const localEndY = (end.y - midY) * stageScale

  const startTick = new Konva.Line({
    points: [localStartX - tickDx, localStartY - tickDy, localStartX + tickDx, localStartY + tickDy],
    stroke: DIMENSION_STROKE,
    strokeWidth: 1.5,
    listening: false,
  })
  group.add(startTick)

  const endTick = new Konva.Line({
    points: [localEndX - tickDx, localEndY - tickDy, localEndX + tickDx, localEndY + tickDy],
    stroke: DIMENSION_STROKE,
    strokeWidth: 1.5,
    listening: false,
  })
  group.add(endTick)

  // Distance label
  const label = new Konva.Text({
    text: `${dist.toFixed(2)}m`,
    fontSize: LABEL_FONT_SIZE,
    fontFamily: 'system-ui, sans-serif',
    fill: DIMENSION_STROKE,
    listening: false,
    name: 'dimension-label',
  })
  // Center label above the line
  label.x(-label.width() / 2)
  label.y(-LABEL_FONT_SIZE - 4)

  // Label background
  const labelBg = new Konva.Rect({
    x: label.x() - 3,
    y: label.y() - 1,
    width: label.width() + 6,
    height: label.height() + 2,
    fill: DIMENSION_LABEL_BG,
    cornerRadius: 2,
    listening: false,
  })

  group.add(labelBg)
  group.add(label)

  return group
}

/**
 * Update all dimension lines whose source or target matches the moved node.
 * Call from dragend/transformend handlers.
 */
export function updateDimensionsForNode(
  nodeId: string,
  layers: Map<string, Konva.Layer>,
  stageScale: number,
): void {
  for (const [dimId, att] of _attachments) {
    if (att.sourceId !== nodeId && att.targetId !== nodeId) continue

    // Resolve current positions of attached nodes
    let startPos = att.sourcePoint
    let endPos = att.targetPoint

    if (att.sourceId) {
      for (const layer of layers.values()) {
        const node = layer.findOne('#' + att.sourceId)
        if (node) { startPos = { x: node.x(), y: node.y() }; break }
      }
    }
    if (att.targetId) {
      for (const layer of layers.values()) {
        const node = layer.findOne('#' + att.targetId)
        if (node) { endPos = { x: node.x(), y: node.y() }; break }
      }
    }

    // Update stored positions
    att.sourcePoint = { ...startPos }
    att.targetPoint = { ...endPos }

    // Find the existing dimension group and rebuild its children
    for (const layer of layers.values()) {
      const dimNode = layer.findOne('#' + dimId) as Konva.Group | null
      if (!dimNode) continue

      // Preserve custom attrs
      const attachSource = dimNode.getAttr('data-attach-source')
      const attachTarget = dimNode.getAttr('data-attach-target')

      // Rebuild: destroy old group, create new one at updated position
      const newGroup = createDimensionGroup(dimId, startPos, endPos, stageScale)
      newGroup.setAttr('data-attach-source', attachSource ?? null)
      newGroup.setAttr('data-attach-target', attachTarget ?? null)
      newGroup.draggable(true)
      newGroup.name(dimNode.name())

      dimNode.destroy()
      layer.add(newGroup)
      layer.batchDraw()
      break
    }
  }
}
