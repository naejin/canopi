// canvas/runtime/tools/select/handle-size.ts  (pure)
//
// Owns the hit radii of Select's handles for the pointer kind that last pressed or hovered (U41, Q1–Q4). A mouse or pen
// gets 20 px point targets, 16 px midpoint dots and the 28 px rotate button; a finger gets 44 px targets for all of them
// (ADR 0010), the rotate button keeping its 28 px look inside its 44 px box (chrome/handle-layer.ts). A midpoint dot
// shows on an edge with room for the two corners' targets, the dot's and as much free outline again, so a dot never
// covers a corner and an edge keeps outline that moves the zone (spec §3.2): 52 px with a mouse, 132 px with a finger.

import type { PointerKind } from '../../interaction-types'

export interface HandleSize {
  /** A corner, vertex, axis end or guide end. */
  readonly pointRadiusPx: number
  readonly midpointRadiusPx: number
  readonly rotateRadiusPx: number
  /** The shortest edge on screen that shows its midpoint dot. */
  readonly minMidpointEdgePx: number
}

const FINE = handleSize(10, 8, 14)
const TOUCH = handleSize(22, 22, 22)

export function handleSizeFor(pointer: PointerKind): HandleSize {
  return pointer === 'touch' ? TOUCH : FINE
}

function handleSize(pointRadiusPx: number, midpointRadiusPx: number, rotateRadiusPx: number): HandleSize {
  return Object.freeze({
    pointRadiusPx,
    midpointRadiusPx,
    rotateRadiusPx,
    minMidpointEdgePx: 2 * pointRadiusPx + 4 * midpointRadiusPx,
  })
}
