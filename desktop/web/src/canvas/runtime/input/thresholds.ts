// canvas/runtime/input/thresholds.ts  (plain numbers; tests may pass others)
//
// Owns the recogniser's timing and distance thresholds (ADR 0017: rules are code, thresholds are data). The drag slop is
// the one rule that tells a tap from a drag, per pointer kind; the compass reads it too (U17).

import type { PointerKind } from '../interaction-types'

export interface Thresholds {
  /** A primary press is a drag once it moves this far (`d >= slop && d > 0`): mouse and pen 3 px (U6), so a click with a
   *  little jitter stays a click. */
  readonly dragSlopPx: Readonly<Record<PointerKind, number>>
  readonly longPressMs: number               // 500
  readonly multiClickMs: number              // 500: a primary press this soon after the last one counts as its next click
  readonly multiClickSlopPx: number          // 6: and this close to it
  readonly twistStartArcPx: number           // 25: touch twist
  readonly trackpadTwistStartDeg: number     // 10: WebKit gesture rotation before any rotate is emitted
}

export const DEFAULT_THRESHOLDS: Thresholds = Object.freeze({
  dragSlopPx: Object.freeze({ mouse: 3, pen: 3, touch: 0 }),
  longPressMs: 500,
  multiClickMs: 500,
  multiClickSlopPx: 6,
  twistStartArcPx: 25,
  trackpadTwistStartDeg: 10,
})
