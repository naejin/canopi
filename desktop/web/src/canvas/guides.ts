import Konva from 'konva'
import { guides, snapToGuidesEnabled } from '../state/canvas'

// ---------------------------------------------------------------------------
// Guide lines — dragged from rulers, persisted in .canopi `extra.guides`
// ---------------------------------------------------------------------------

export interface Guide {
  id: string
  axis: 'h' | 'v'
  position: number // world coordinate
}

// Snap threshold in screen pixels — shapes within this distance snap to a guide
const SNAP_THRESHOLD_PX = 8

// Smart guide snap threshold in screen pixels
const SMART_SNAP_THRESHOLD_PX = 12

// Guide line visual style
const GUIDE_COLOR = 'rgba(45, 95, 63, 0.6)'
const GUIDE_WIDTH = 1
const SMART_GUIDE_COLOR = 'rgba(255, 90, 90, 0.7)'
const SMART_GUIDE_WIDTH = 1

// ---------------------------------------------------------------------------
// Guide snapping — called from engine._setupSnapToDrag
// ---------------------------------------------------------------------------

/**
 * Snap a world-coordinate position to nearby guide lines.
 * Returns the snapped position. Only snaps axes that are within threshold.
 */
export function snapToGuides(
  x: number,
  y: number,
  stageScale: number,
): { x: number; y: number } {
  if (!snapToGuidesEnabled.value) return { x, y }

  const threshold = SNAP_THRESHOLD_PX / stageScale
  let snappedX = x
  let snappedY = y

  for (const g of guides.value) {
    if (g.axis === 'v') {
      if (Math.abs(x - g.position) < threshold) {
        snappedX = g.position
      }
    } else {
      if (Math.abs(y - g.position) < threshold) {
        snappedY = g.position
      }
    }
  }

  return { x: snappedX, y: snappedY }
}

// ---------------------------------------------------------------------------
// Guide line Konva rendering — persistent lines on the annotations layer
// ---------------------------------------------------------------------------

/**
 * Create a visual Konva.Line for a guide. Guides extend across the full
 * visible viewport and are redrawn on pan/zoom.
 */
export function createGuideLine(
  guide: Guide,
  stage: Konva.Stage,
): Konva.Line {
  const line = _buildLine(guide, stage)
  line.setAttr('data-guide-id', guide.id)
  return line
}

/** Update all guide line positions after pan/zoom. */
export function updateGuideLines(
  layer: Konva.Layer,
  stage: Konva.Stage,
): void {
  const scale = stage.scaleX()
  const pos = stage.position()
  const w = stage.width()
  const h = stage.height()

  // Viewport in world coordinates
  const left = -pos.x / scale
  const top = -pos.y / scale
  const right = left + w / scale
  const bottom = top + h / scale

  // Extend beyond viewport for smooth scroll
  const margin = 1000 / scale

  layer.find('.guide-line').forEach((node: Konva.Node) => {
    const gid = node.getAttr('data-guide-id') as string
    const guide = guides.value.find((g) => g.id === gid)
    if (!guide) { node.destroy(); return }

    const line = node as Konva.Line
    if (guide.axis === 'v') {
      line.points([guide.position, top - margin, guide.position, bottom + margin])
    } else {
      line.points([left - margin, guide.position, right + margin, guide.position])
    }
  })

  layer.batchDraw()
}

function _buildLine(guide: Guide, stage: Konva.Stage): Konva.Line {
  const scale = stage.scaleX()
  const pos = stage.position()
  const w = stage.width()
  const h = stage.height()

  const left = -pos.x / scale
  const top = -pos.y / scale
  const right = left + w / scale
  const bottom = top + h / scale
  const margin = 1000 / scale

  const points =
    guide.axis === 'v'
      ? [guide.position, top - margin, guide.position, bottom + margin]
      : [left - margin, guide.position, right + margin, guide.position]

  return new Konva.Line({
    points,
    stroke: GUIDE_COLOR,
    strokeWidth: GUIDE_WIDTH,
    strokeScaleEnabled: false,
    dash: [6, 4],
    listening: false,
    name: 'guide-line',
    perfectDrawEnabled: false,
  })
}

// ---------------------------------------------------------------------------
// Smart guides — temporary alignment indicators during drag
// ---------------------------------------------------------------------------

interface SmartGuideResult {
  snappedX: number
  snappedY: number
  lines: Konva.Line[]
}

/**
 * Compute smart guide alignment for a dragged node against nearby shapes.
 * Returns snapped position and temporary Konva.Line indicators.
 */
export function computeSmartGuides(
  draggedNode: Konva.Node,
  candidates: Konva.Node[],
  stageScale: number,
): SmartGuideResult {
  const threshold = SMART_SNAP_THRESHOLD_PX / stageScale
  const rect = draggedNode.getClientRect({ relativeTo: draggedNode.getLayer() ?? undefined })
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2

  const edges = {
    left: rect.x,
    right: rect.x + rect.width,
    top: rect.y,
    bottom: rect.y + rect.height,
    cx,
    cy,
  }

  let bestDx: number | null = null
  let bestSnapX: number | null = null
  let bestDy: number | null = null
  let bestSnapY: number | null = null
  let snapTargetX: { from: number; to: number } | null = null
  let snapTargetY: { from: number; to: number } | null = null

  for (const cand of candidates) {
    if (cand === draggedNode) continue
    if (cand.id() === draggedNode.id()) continue

    const cr = cand.getClientRect({ relativeTo: cand.getLayer() ?? undefined })
    const ccx = cr.x + cr.width / 2
    const ccy = cr.y + cr.height / 2

    // Check vertical alignment (x-axis snapping)
    const xChecks = [
      { src: edges.left, tgt: cr.x },         // left-to-left
      { src: edges.right, tgt: cr.x + cr.width }, // right-to-right
      { src: edges.cx, tgt: ccx },             // center-to-center
      { src: edges.left, tgt: cr.x + cr.width }, // left-to-right
      { src: edges.right, tgt: cr.x },         // right-to-left
    ]
    for (const { src, tgt } of xChecks) {
      const d = Math.abs(src - tgt)
      if (d < threshold && (bestDx === null || d < bestDx)) {
        bestDx = d
        bestSnapX = tgt - (src - edges.left) + rect.x === src ? tgt : tgt - (src - rect.x)
        // Actually: we want to shift the node so `src` aligns with `tgt`
        bestSnapX = draggedNode.x() + (tgt - src)
        snapTargetX = {
          from: Math.min(edges.cy, ccy),
          to: Math.max(edges.cy, ccy),
        }
      }
    }

    // Check horizontal alignment (y-axis snapping)
    const yChecks = [
      { src: edges.top, tgt: cr.y },           // top-to-top
      { src: edges.bottom, tgt: cr.y + cr.height }, // bottom-to-bottom
      { src: edges.cy, tgt: ccy },             // center-to-center
      { src: edges.top, tgt: cr.y + cr.height }, // top-to-bottom
      { src: edges.bottom, tgt: cr.y },        // bottom-to-top
    ]
    for (const { src, tgt } of yChecks) {
      const d = Math.abs(src - tgt)
      if (d < threshold && (bestDy === null || d < bestDy)) {
        bestDy = d
        bestSnapY = draggedNode.y() + (tgt - src)
        snapTargetY = {
          from: Math.min(edges.cx, ccx),
          to: Math.max(edges.cx, ccx),
        }
      }
    }
  }

  const snappedX = bestSnapX ?? draggedNode.x()
  const snappedY = bestSnapY ?? draggedNode.y()

  // Build visual indicator lines
  const lines: Konva.Line[] = []

  if (bestSnapX !== null && snapTargetX) {
    const gx = rect.x + (bestSnapX - draggedNode.x())
    lines.push(
      new Konva.Line({
        points: [gx, snapTargetX.from - 20 / stageScale, gx, snapTargetX.to + 20 / stageScale],
        stroke: SMART_GUIDE_COLOR,
        strokeWidth: SMART_GUIDE_WIDTH,
        strokeScaleEnabled: false,
        listening: false,
        name: 'smart-guide',
        perfectDrawEnabled: false,
      }),
    )
  }

  if (bestSnapY !== null && snapTargetY) {
    const gy = rect.y + (bestSnapY - draggedNode.y())
    lines.push(
      new Konva.Line({
        points: [snapTargetY.from - 20 / stageScale, gy, snapTargetY.to + 20 / stageScale, gy],
        stroke: SMART_GUIDE_COLOR,
        strokeWidth: SMART_GUIDE_WIDTH,
        strokeScaleEnabled: false,
        listening: false,
        name: 'smart-guide',
        perfectDrawEnabled: false,
      }),
    )
  }

  return { snappedX, snappedY, lines }
}

/** Remove all temporary smart guide lines from a layer. */
export function clearSmartGuides(layer: Konva.Layer): void {
  layer.find('.smart-guide').forEach((n: Konva.Node) => n.destroy())
  layer.batchDraw()
}
