import { snapToGuidesEnabled } from '../app/canvas-settings/signals'
import { guides } from './scene-metadata-state'

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

// ---------------------------------------------------------------------------
// Guide snapping — pure arithmetic against guide positions
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
