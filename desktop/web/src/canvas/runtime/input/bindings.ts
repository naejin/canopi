// canvas/runtime/input/bindings.ts  (data: the single phase switch)

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
  /** A secondary or auxiliary button added during a primary drag opens a nested navigation sub-session. */
  readonly navigateDuringPrimaryDrag: boolean
  readonly touch: { readonly gestures: boolean; readonly longPressMenu: boolean; readonly hostTouchActionNone: boolean }
  readonly penBarrel: 'ignore' | 'secondary'
  readonly trackpadGestures: boolean                       // WebKit gesture* rotate and scale
  readonly dragSlopPx: Readonly<Record<PointerKind, number>>
}

/** Help rows for F1 and tool cards, generated from the bindings (never hand-written). */
export interface GestureHelpRow { readonly inputKey: string; readonly actionKey: string; readonly platformNote?: string }
