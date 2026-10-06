// canvas/runtime/input/bindings.ts  (data: the single phase switch)
//
// Owns CURRENT_BINDINGS, the one constant saying which physical input means what (spec §1.2 table). Each phase that
// changes a field rewrites its value here and the fixture expectations it changes; no earlier constant is kept beside
// it.

import type { PointerKind } from '../interaction-types'

export interface Bindings {
  readonly touch: { readonly gestures: boolean; readonly longPressMenu: boolean; readonly hostTouchActionNone: boolean }
  readonly dragSlopPx: Readonly<Record<PointerKind, number>>
}

/**
 * The values phase 3 changes (touch); every value final in phase 2 is hard-coded where it is read (A19). A mouse or pen
 * press starts a drag once it moves 3 px (U6), so a click with a little jitter stays a click; touch keeps slop 0 until
 * phase 3 (with `d >= slop && d > 0`, any movement is a drag); the tools keep their own thresholds, measured at release.
 */
export const CURRENT_BINDINGS: Bindings = Object.freeze({
  touch: Object.freeze({ gestures: false, longPressMenu: false, hostTouchActionNone: false }),
  dragSlopPx: Object.freeze({ mouse: 3, pen: 3, touch: 0 }),
})
