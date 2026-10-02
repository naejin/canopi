// canvas/runtime/input/bindings.ts  (data: the single phase switch)
//
// Owns CURRENT_BINDINGS, the one constant saying which physical input means what (spec §1.2 table). Each phase that
// changes a field rewrites its value here and the fixture expectations it changes; no earlier constant is kept beside
// it. describeBindings is written in phase 2 with F1, its first reader.

import type { PointerKind } from '../interaction-types'

export type PanContext = 'hand-tool' | 'overview'
export interface Bindings {
  readonly secondary: {
    readonly click: 'menu-on-native' | 'menu-on-release'   // legacy: native contextmenu opens at once
    readonly drag: 'none' | 'pan'
    readonly shiftDrag: 'none' | 'rotate'
  }
  /** Shift+middle-drag. Plain middle-drag always pans. */
  readonly auxiliaryShiftDrag: 'pan' | 'rotate'
  /** Contexts in which a primary drag pans. */
  readonly primaryDragPansIn: readonly PanContext[]
  readonly macCtrlClick: 'primary' | 'secondary'
  readonly touch: { readonly gestures: boolean; readonly longPressMenu: boolean; readonly hostTouchActionNone: boolean }
  readonly penBarrel: 'ignore' | 'secondary'
  readonly trackpadGestures: boolean                       // WebKit gesture* rotate and scale
  readonly dragSlopPx: Readonly<Record<PointerKind, number>>
}

/**
 * The right button is inert and the native contextmenu opens the canvas menu at once; a middle drag pans (Shift too);
 * the Pan tool and overview pan on a primary drag; no touch gestures, pen barrel or trackpad gesture events. Slop 0 on
 * every pointer: with `d >= slop && d > 0`, any movement is a drag (the tools keep their own thresholds, measured at
 * release).
 */
export const CURRENT_BINDINGS: Bindings = Object.freeze({
  secondary: Object.freeze({ click: 'menu-on-native', drag: 'none', shiftDrag: 'none' }),
  auxiliaryShiftDrag: 'pan',
  primaryDragPansIn: Object.freeze(['hand-tool', 'overview'] as const),
  macCtrlClick: 'primary',
  touch: Object.freeze({ gestures: false, longPressMenu: false, hostTouchActionNone: false }),
  penBarrel: 'ignore',
  trackpadGestures: false,
  dragSlopPx: Object.freeze({ mouse: 0, pen: 0, touch: 0 }),
})
