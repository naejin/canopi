// canvas/runtime/input/thresholds.ts  (plain numbers; tests may pass others)

export interface Thresholds {
  readonly longPressMs: number               // 500
  readonly multiClickMs: number              // today's double-click interval
  readonly multiClickSlopPx: number          // 6 (today's DOUBLE_CLICK_DISTANCE_PX)
  readonly menuEchoMs: number                // 500: keyboard-menu echo
  readonly windowsMenuTrailMs: number        // 250: WebView2 trailing contextmenu
  readonly twistStartArcPx: number           // 25: touch twist
  readonly trackpadTwistStartDeg: number     // 10: WebKit gesture rotation before any rotate is emitted
}
