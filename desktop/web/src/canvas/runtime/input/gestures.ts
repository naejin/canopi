// canvas/runtime/input/gestures.ts

import type { CancelReason, CanvasDropPayload, Modifiers, PointerKind, ToolHandleId } from '../interaction-types'
import type { ScreenPoint } from '../view/types'
import type { TargetClass } from './raw-input'

export type NavigationSource =
  | 'secondary-drag' | 'auxiliary-drag' | 'space-drag' | 'primary-drag'   // primary-drag: the Pan tool (and legacy overview)
  | 'wheel' | 'trackpad-pinch' | 'trackpad-twist' | 'touch-two-finger'

export type MenuSource = 'mouse' | 'ctrl-click' | 'pen-barrel' | 'long-press' | 'keyboard' | 'native'
// CancelReason, PointerKind, Modifiers, ToolHandleId, CanvasDropPayload: from ../interaction-types.ts (§1.2a); TargetClass: from ./raw-input.ts (§1.2)

export type PressTarget =
  | { readonly kind: 'surface' }
  | { readonly kind: 'handle'; readonly id: ToolHandleId }
  | { readonly kind: 'ruler'; readonly axis: 'h' | 'v' }

export type Gesture =
  // editing: primary role only; the ToolHost converts to world space
  /** target: the class the recogniser saw under the pointer; the host publishes to subscribePointerWorld only for 'surface'. */
  | { kind: 'hover'; at: ScreenPoint; pointer: PointerKind; mods: Modifiers; target: TargetClass }
  | { kind: 'hover-end' }
  | { kind: 'press'; id: number; at: ScreenPoint; pointer: PointerKind; mods: Modifiers; clickCount: number; target: PressTarget }
  | { kind: 'tap'; id: number; at: ScreenPoint; pointer: PointerKind; mods: Modifiers; clickCount: number; target: PressTarget }
  | { kind: 'drag-start'; id: number; from: ScreenPoint; at: ScreenPoint; pointer: PointerKind; mods: Modifiers; target: PressTarget }
  | { kind: 'drag-move'; id: number; at: ScreenPoint; mods: Modifiers }
  | { kind: 'drag-end'; id: number; at: ScreenPoint; mods: Modifiers }
  | { kind: 'drop'; phase: 'over' | 'leave' | 'drop'; at: ScreenPoint; payload: CanvasDropPayload }
  // navigation: never reaches tools
  /** deltaPx is content movement (the ground follows the pointer). at: the pointer's screen point for a pointer source (every
   *  source but 'wheel'), which the router hands to ToolHost.notePointer; absent for a wheel pan. */
  | { kind: 'pan'; phase: 'start' | 'move' | 'end'; deltaPx: ScreenPoint; source: NavigationSource; at?: ScreenPoint }
  | { kind: 'zoom'; anchorPx: ScreenPoint; factor: number; source: NavigationSource }
  | { kind: 'rotate'; phase: 'start' | 'move' | 'end' | 'cancel'; anchorPx: ScreenPoint; totalDeltaDeg: number; step: boolean; source: NavigationSource }
  // requests
  | { kind: 'menu-request'; at: ScreenPoint | 'selection'; source: MenuSource }
  | { kind: 'cancel'; reason: CancelReason }
