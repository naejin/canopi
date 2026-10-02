// canvas/runtime/tools/draft.ts  (world-space presentations)

import type { ToolHandleId } from '../interaction-types'
import type { ScreenPoint, WorldPoint, WorldQuad } from '../view/types'
import type { GhostEntity } from './tool'

export type DraftShape =
  | { readonly kind: 'polyline'; readonly points: readonly WorldPoint[]; readonly style: DraftStroke }
  | { readonly kind: 'polygon'; readonly points: readonly WorldPoint[]; readonly style: DraftStroke; readonly fill?: DraftFill }
  | { readonly kind: 'quad'; readonly corners: WorldQuad; readonly style: DraftStroke; readonly fill?: DraftFill }   // band select
  | { readonly kind: 'ellipse'; readonly center: WorldPoint; readonly radiusX: number; readonly radiusY: number; readonly rotationDeg: number; readonly style: DraftStroke; readonly fill?: DraftFill }
  | { readonly kind: 'circle-px'; readonly center: WorldPoint; readonly radiusPx: number; readonly style: DraftStroke }
  | { readonly kind: 'ghost'; readonly entity: GhostEntity; readonly opacity: number }
  | { readonly kind: 'label'; readonly anchor: WorldPoint; readonly offsetPx: ScreenPoint; readonly text: string; readonly tone: 'measure' | 'measure-quiet' | 'hint' | 'hint-primary' | 'warning' }  // upright chip
// A label is today's UI chip, drawn upright in Pixi; its tone carries the whole chip style (spec §1.4): 'measure' centred mono,
// 'measure-quiet' the same at weight 400, 'hint' bottom-centre sans, 'hint-primary' the same in the primary colour, 'warning' as 'hint'.
/** widthPx and dash (dash, gap, … lengths) are CSS px at every scale; the casing is widthPx + OVERLAY_CASING_EXTRA_PX. The renderer converts them
 *  to world units at the scale it draws with and re-traces when that scale changes (plan 0D1 "Transform until 0D2"). */
export type DraftStroke = { readonly token: 'draft' | 'draft-muted' | 'selection' | 'warning'; readonly widthPx: number; readonly dash?: readonly number[] }
export type DraftFill = { readonly token: 'draft-fill' | 'selection-fill' | 'warning-fill' }
// Draft tokens resolve to canvas colours in canvas/runtime/scene-visuals.ts (getDraftVisual, beside the overlay visuals; plan 0D1).
export interface DraftPresentation { readonly shapes: readonly DraftShape[] }

export interface ToolHandle {
  readonly id: ToolHandleId              // unique across objects: 'rotate', 'vertex:<zone id>:<index>', 'rect-corner:<id>:ne', 'guide-end:<id>:a', 'edge-mid:<zone id>:<index>'
  readonly anchor: WorldPoint
  readonly offsetPx?: ScreenPoint        // rotate handle: 42 px above the selection's projected hull
  readonly hitRadiusPx: number           // 10 today; 22 on touch (44 px target, ADR 0010)
  readonly glyph: 'vertex' | 'corner' | 'rotate' | 'midpoint'
  readonly label: string                 // aria-label: the rotate handle's is translated; zone and guide points keep today's literal English (phase 0)
  readonly readout?: string              // live chip beside the handle (the rotate handle's '+15°'); the host marks the dragged handle active
}
