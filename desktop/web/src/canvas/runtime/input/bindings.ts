// canvas/runtime/input/bindings.ts  (data: the single phase switch)
//
// Owns CURRENT_BINDINGS, the one constant saying which physical input means what (spec §1.2 table). Each phase that
// changes a field rewrites its value here and the fixture expectations it changes; no earlier constant is kept beside
// it.

import type { PointerKind } from '../interaction-types'

export type PanContext = 'hand-tool' | 'overview'
export interface Bindings {
  /** Shift+middle-drag. Plain middle-drag always pans. */
  readonly auxiliaryShiftDrag: 'pan' | 'rotate'
  /** Contexts in which a primary drag pans. */
  readonly primaryDragPansIn: readonly PanContext[]
  readonly touch: { readonly gestures: boolean; readonly longPressMenu: boolean; readonly hostTouchActionNone: boolean }
  readonly penBarrel: 'ignore' | 'secondary'
  readonly trackpadGestures: boolean                       // WebKit gesture* rotation (the scale is ignored: the pinch arrives as Ctrl+wheel)
  readonly dragSlopPx: Readonly<Record<PointerKind, number>>
}

/**
 * A middle drag pans and a Shift+middle drag rotates, as does a WebKit trackpad twist; the Pan tool and overview pan on a primary drag; no touch
 * gestures or pen barrel. A mouse or pen press starts a drag once it moves 3 px (U6), so a click with a little jitter
 * stays a click; touch keeps slop 0 until phase 3 (with `d >= slop && d > 0`, any movement is a drag). A tool may
 * override the slop through `configure` (Plant a row: 0), and the tools keep their own thresholds, measured at release.
 */
export const CURRENT_BINDINGS: Bindings = Object.freeze({
  auxiliaryShiftDrag: 'rotate',
  primaryDragPansIn: Object.freeze(['hand-tool', 'overview'] as const),
  touch: Object.freeze({ gestures: false, longPressMenu: false, hostTouchActionNone: false }),
  penBarrel: 'ignore',
  trackpadGestures: true,
  dragSlopPx: Object.freeze({ mouse: 3, pen: 3, touch: 0 }),
})
