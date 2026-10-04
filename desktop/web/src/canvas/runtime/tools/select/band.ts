// canvas/runtime/tools/select/band.ts
//
// Owns Select's band (today's (a4c86d39) shared-gestures.ts 'band' mode): a press on empty ground clears the selection unless the
// press is additive, and the drag draws a screen-aligned box from the press to the pointer (the band's `quad` draft:
// the selection stroke at 2 px over the selection fill). The release selects every object the box touches, tested
// against its world quad (turned with the view, never widened to its world box; spec §4.9), the locked ones left out,
// added to the selection when the press was additive; a release within 2 px of the press selects nothing. The release
// runs when the scene is settled (CanvasTool.settledRelease).

import { isSceneDesignObjectLocked } from '../../scene/locks'
import { sceneTargetKey, type SceneDesignObjectTarget } from '../../scene/design-object-targets'
import type { WorldPoint, WorldQuad } from '../../view/types'
import type { DraftPresentation } from '../draft'
import type { ToolContext, ToolView } from '../tool'

/** A band shorter than this on screen is a click. */
const BAND_THRESHOLD_PX = 2

export interface Band {
  readonly start: WorldPoint
  readonly additive: boolean
}

/** The band from its press to `end`, as the renderer draws it. */
export function bandDraft(view: ToolView, band: Band, end: WorldPoint): DraftPresentation {
  return {
    shapes: [{
      kind: 'quad',
      corners: screenAlignedQuad(view, band.start, end),
      style: { token: 'selection', widthPx: 2 },
      fill: { token: 'selection-fill' },
    }],
  }
}

/** What the band released at `end` selects, or null when the pointer stayed within the threshold (nothing changes). */
export function bandSelection(ctx: ToolContext, band: Band, end: WorldPoint): SceneDesignObjectTarget[] | null {
  if (ctx.view.screenDistance(band.start, end) <= BAND_THRESHOLD_PX) return null
  const scene = ctx.scene.persisted
  const selected = new Map<string, SceneDesignObjectTarget>(
    band.additive ? ctx.scene.selection().map((target) => [sceneTargetKey(target), target]) : [],
  )
  for (const hit of ctx.scene.hitInQuad(screenAlignedQuad(ctx.view, band.start, end))) {
    if (hit.kind !== 'object' || isSceneDesignObjectLocked(scene, hit.target)) continue
    selected.set(sceneTargetKey(hit.target), hit.target)
  }
  return [...selected.values()]
}

/** The box with `a` and `b` as opposite corners, its sides along the screen's axes (the world's at bearing 0). */
function screenAlignedQuad(view: ToolView, a: WorldPoint, b: WorldPoint): WorldQuad {
  const { right } = view.screenAxesInWorld(a)
  const across = (b.x - a.x) * right.x + (b.y - a.y) * right.y
  return [
    a,
    { x: a.x + right.x * across, y: a.y + right.y * across },
    b,
    { x: b.x - right.x * across, y: b.y - right.y * across },
  ]
}
