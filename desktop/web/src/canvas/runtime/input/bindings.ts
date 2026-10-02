// canvas/runtime/input/bindings.ts  (data: the single phase switch)
//
// Owns the binding constants: which physical input means what in each phase (spec §1.2 table). Phase 0 and F run under
// LEGACY_BINDINGS, today's behaviour; each later phase adds its constant here and points CURRENT_BINDINGS at it
// (ROTATION_BINDINGS in phase 1, V2_BINDINGS in phase 2, TOUCH_BINDINGS in phase 3). describeBindings is written in
// phase 2 with F1, its first reader.

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
  /** A button-less move over owned chrome, the text entry or a handle (§2.2 "Hover"): 'legacy' keeps today's split, 'end' ends
   *  the hover; the Unlock affordance keeps it under both. */
  readonly ownedHover: 'legacy' | 'end'
}

/**
 * Today's input. The right button is inert and the native contextmenu opens the canvas menu at once; a middle drag pans
 * (Shift too); the Pan tool and overview pan on a primary drag; no touch gestures, pen barrel or trackpad gesture events.
 * Slop 0 on every pointer: with `d >= slop && d > 0`, any movement is a drag, as today (the tools keep their own
 * thresholds, measured at release).
 */
export const LEGACY_BINDINGS: Bindings = Object.freeze({
  secondary: Object.freeze({ click: 'menu-on-native', drag: 'none', shiftDrag: 'none' }),
  auxiliaryShiftDrag: 'pan',
  primaryDragPansIn: Object.freeze(['hand-tool', 'overview'] as const),
  macCtrlClick: 'primary',
  touch: Object.freeze({ gestures: false, longPressMenu: false, hostTouchActionNone: false }),
  penBarrel: 'ignore',
  trackpadGestures: false,
  dragSlopPx: Object.freeze({ mouse: 0, pen: 0, touch: 0 }),
  ownedHover: 'legacy',
})

/** The one constant each phase changes. */
export const CURRENT_BINDINGS: Bindings = LEGACY_BINDINGS
