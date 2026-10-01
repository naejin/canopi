// canvas/runtime/input/thresholds.ts  (plain numbers; tests may pass others)
//
// Owns the recogniser's timing and distance thresholds. Tools keep their own (the band and handles act past 2 px at
// release; Plant a row runs at slop 0 and measures its own 4 px); the recogniser's drag slop is per binding
// (`Bindings.dragSlopPx`).

export interface Thresholds {
  readonly longPressMs: number               // 500
  readonly multiClickMs: number              // today's double-click interval
  readonly multiClickSlopPx: number          // 6 (today's DOUBLE_CLICK_DISTANCE_PX)
  readonly menuEchoMs: number                // 500: keyboard-menu echo
  readonly windowsMenuTrailMs: number        // 250: WebView2 trailing contextmenu
  readonly twistStartArcPx: number           // 25: touch twist
  readonly trackpadTwistStartDeg: number     // 10: WebKit gesture rotation before any rotate is emitted
}

export const DEFAULT_THRESHOLDS: Thresholds = Object.freeze({
  longPressMs: 500,
  // today's (a4c86d39) interaction/shared-gestures.ts DOUBLE_CLICK_INTERVAL_MS and DOUBLE_CLICK_DISTANCE_PX (Select's
  // note-edit rule).
  multiClickMs: 500,
  multiClickSlopPx: 6,
  // scene-interaction.ts KEYBOARD_CONTEXT_MENU_ECHO_MS.
  menuEchoMs: 500,
  windowsMenuTrailMs: 250,
  twistStartArcPx: 25,
  trackpadTwistStartDeg: 10,
})
