// canvas/runtime/input/normalise.ts
//
// Owns the translation of one DOM event (as the fields it reads, `DomEventLike`) into one `RawInput`: button roles per
// pointer kind and binding, physical modifiers, wheel units, drop payloads. No state and no browser: the DOM source
// converts client points to host-relative CSS px and classifies the target before calling it, and fixtures pass literals.

import type { CanvasDropPayload, Modifiers, PointerKind } from '../interaction-types'
import type { Bindings } from './bindings'
import type { InputPlatform } from './platform'
import type { ButtonRole, RawInput, TargetClass } from './raw-input'

/** The fields normalise reads; a DOM event satisfies it structurally, and fixtures pass literals. */
export interface DomEventLike {
  readonly type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel' | 'lostpointercapture' | 'pointerleave'
    | 'wheel' | 'gesturestart' | 'gesturechange' | 'gestureend' | 'dragover' | 'dragleave' | 'drop'
  readonly timeStamp: number
  readonly clientX: number; readonly clientY: number          // converted to host-relative CSS px by the source before normalise
  readonly pointerId?: number; readonly pointerType?: string; readonly button?: number; readonly buttons?: number; readonly detail?: number
  readonly shiftKey: boolean; readonly ctrlKey: boolean; readonly altKey: boolean; readonly metaKey: boolean
  readonly deltaX?: number; readonly deltaY?: number; readonly deltaMode?: number
  readonly rotation?: number                                    // WebKit GestureEvent (its scale is never read: the pinch arrives as Ctrl+wheel)
  readonly target: TargetClass                                  // classified by the source from data attributes
  readonly dropPayload?: CanvasDropPayload                      // drag events: read by the source from dataTransfer
}

/** Wheel deltaMode 1 (lines) in CSS px: today's 16. */
const WHEEL_LINE_PX = 16
const DOM_DELTA_LINE = 1
const DOM_DELTA_PAGE = 2

/** Pointer button numbers (PointerEvent.button) and bits (PointerEvent.buttons). */
const BUTTON_PRIMARY = 0
const BUTTON_AUXILIARY = 1
const BUTTON_SECONDARY = 2
const BIT_PRIMARY = 1
const BIT_SECONDARY = 2
const BIT_AUXILIARY = 4

export function normalise(
  e: DomEventLike,
  platform: InputPlatform,
  bindings: Bindings,
  host: { readonly width: number; readonly height: number },
): RawInput | null {
  const t = e.timeStamp
  const at = { x: e.clientX, y: e.clientY }
  switch (e.type) {
    case 'pointerdown': {
      const pointer = pointerKindOf(e.pointerType)
      const press = pressRole(e, pointer, platform, bindings)
      if (!press) return null
      return {
        kind: 'down',
        t,
        id: e.pointerId ?? 0,
        pointer,
        role: press.role,
        at,
        mods: modifiersOf(e),
        target: e.target,
        detail: e.detail ?? 0,
        ctrlConsumed: press.ctrlConsumed,
      }
    }
    case 'pointermove': {
      const pointer = pointerKindOf(e.pointerType)
      return {
        kind: 'move',
        t,
        id: e.pointerId ?? 0,
        pointer,
        at,
        mods: modifiersOf(e),
        buttons: buttonRoles(e.buttons ?? 0, pointer, bindings),
        target: e.target,
        buttonMask: e.buttons ?? 0,
      }
    }
    case 'pointerup': {
      const pointer = pointerKindOf(e.pointerType)
      const release = pressRole(e, pointer, platform, bindings)
      // An up is never dropped: it ends its pointer's session whatever the button, as today's pointerup did. A button no
      // press takes reads as primary: a mouse's back and forward, and a pen's eraser or its barrel under 'ignore' (a drag
      // whose tip lifted before the barrel).
      return {
        kind: 'up',
        t,
        id: e.pointerId ?? 0,
        pointer,
        role: release?.role ?? 'primary',
        at,
        mods: modifiersOf(e),
        target: e.target,
      }
    }
    case 'pointercancel':
      return { kind: 'cancel', t, id: e.pointerId ?? 0, reason: 'pointercancel' }
    case 'lostpointercapture':
      return { kind: 'cancel', t, id: e.pointerId ?? 0, reason: 'lost-capture' }
    case 'pointerleave':
      return { kind: 'leave', t }
    case 'wheel': {
      // deltaMode is read before the deltas: a page is the host width for deltaX and its height for deltaY.
      const mode = e.deltaMode ?? 0
      const xUnit = mode === DOM_DELTA_LINE ? WHEEL_LINE_PX : mode === DOM_DELTA_PAGE ? host.width : 1
      const yUnit = mode === DOM_DELTA_LINE ? WHEEL_LINE_PX : mode === DOM_DELTA_PAGE ? host.height : 1
      return {
        kind: 'wheel',
        t,
        at,
        dxPx: (e.deltaX ?? 0) * xUnit,
        dyPx: (e.deltaY ?? 0) * yUnit,
        mods: modifiersOf(e),
        target: e.target,
      }
    }
    case 'gesturestart':
    case 'gesturechange':
    case 'gestureend':
      return {
        kind: 'platform-gesture',
        t,
        phase: e.type === 'gesturestart' ? 'start' : e.type === 'gesturechange' ? 'change' : 'end',
        at,
        rotationDeg: e.rotation ?? 0,
      }
    case 'dragover':
    case 'dragleave':
    case 'drop':
      return {
        kind: 'drop',
        t,
        phase: e.type === 'dragover' ? 'over' : e.type === 'dragleave' ? 'leave' : 'drop',
        at,
        payload: e.dropPayload ?? { kind: 'unknown' },
      }
  }
}

function pointerKindOf(pointerType: string | undefined): PointerKind {
  if (pointerType === 'pen') return 'pen'
  if (pointerType === 'touch') return 'touch'
  return 'mouse'
}

/** Physical keys as delivered: a Mac's Ctrl is ctrl and its Cmd meta; the ToolHost resolves "mod" per platform (§2.3). */
function modifiersOf(e: Pick<DomEventLike, 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey'>): Modifiers {
  return { shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey }
}

function pressRole(
  e: DomEventLike,
  pointer: PointerKind,
  platform: InputPlatform,
  bindings: Bindings,
): { readonly role: ButtonRole; readonly ctrlConsumed: boolean } | null {
  const button = e.button ?? BUTTON_PRIMARY
  if (pointer === 'touch') return { role: 'primary', ctrlConsumed: false }
  if (pointer === 'pen') {
    if (button === BUTTON_PRIMARY) return { role: 'primary', ctrlConsumed: false }
    if (button === BUTTON_SECONDARY && bindings.penBarrel === 'secondary') return { role: 'secondary', ctrlConsumed: false }
    return null   // barrel under 'ignore', eraser (5) and any other pen button
  }
  if (button === BUTTON_PRIMARY) {
    if (platform.os === 'mac' && bindings.macCtrlClick === 'secondary' && e.ctrlKey && !e.metaKey) {
      return { role: 'secondary', ctrlConsumed: true }
    }
    return { role: 'primary', ctrlConsumed: false }
  }
  if (button === BUTTON_AUXILIARY) return { role: 'auxiliary', ctrlConsumed: false }
  if (button === BUTTON_SECONDARY) return { role: 'secondary', ctrlConsumed: false }
  return null   // back and forward (3, 4)
}

function buttonRoles(buttons: number, pointer: PointerKind, bindings: Bindings): ReadonlySet<ButtonRole> {
  const roles = new Set<ButtonRole>()
  if (buttons & BIT_PRIMARY) roles.add('primary')
  if (pointer === 'touch') return roles
  if (buttons & BIT_SECONDARY && (pointer === 'mouse' || bindings.penBarrel === 'secondary')) roles.add('secondary')
  if (buttons & BIT_AUXILIARY && pointer === 'mouse') roles.add('auxiliary')
  return roles
}
