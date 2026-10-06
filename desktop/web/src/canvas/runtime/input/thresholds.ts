// canvas/runtime/input/thresholds.ts  (plain numbers; tests may pass others)
//
// Owns the recogniser's timing and distance thresholds. Tools keep their own (the band and handles act past 2 px at
// release; Plant a row runs at slop 0 and measures its own 4 px); the recogniser's drag slop is per binding
// (`Bindings.dragSlopPx`).

export interface Thresholds {
  readonly longPressMs: number               // 500
  readonly multiClickMs: number              // 500: a primary press this soon after the last one counts as its next click
  readonly multiClickSlopPx: number          // 6: and this close to it
  readonly twistStartArcPx: number           // 25: touch twist
  readonly trackpadTwistStartDeg: number     // 10: WebKit gesture rotation before any rotate is emitted
}

export const DEFAULT_THRESHOLDS: Thresholds = Object.freeze({
  longPressMs: 500,
  multiClickMs: 500,
  multiClickSlopPx: 6,
  twistStartArcPx: 25,
  trackpadTwistStartDeg: 10,
})
