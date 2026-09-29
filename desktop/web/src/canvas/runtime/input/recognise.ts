// canvas/runtime/input/recognise.ts  (the recogniser: its three state types and its two functions; the seams commit
// writes the types, 0B Input the functions. raw-input.ts holds no function.)
// PointerSession, NestedNavigation and TouchPair: type exports imported only inside input/.
// The seams commit writes them as below, from the field comments above; 0B Input may reshape them (RecogniserState is opaque to callers).
// raw-input.ts and recognise.ts import each other's types with `import type` only (no runtime cycle).

import type { PointerKind } from '../interaction-types'
import type { ScreenPoint } from '../view/types'
import type { ButtonRole, TargetClass } from './raw-input'

export interface PointerSession {
  readonly pointerId: number
  readonly pointer: PointerKind
  readonly role: ButtonRole
  readonly mode: 'pending' | 'primary' | 'pan' | 'rotate' | 'ignored'
  readonly start: ScreenPoint
  readonly last: ScreenPoint
  readonly target: TargetClass
  readonly slopPassed: boolean
  readonly captured: boolean
}

export interface NestedNavigation {
  readonly pointerId: number
  readonly role: ButtonRole
  readonly mode: 'pending' | 'pan' | 'rotate'
  readonly start: ScreenPoint
  readonly last: ScreenPoint
  readonly frozenPrimary: ScreenPoint
}

export interface TouchPair {
  readonly ids: readonly [number, number]
  readonly startCentroid: ScreenPoint
  readonly startDistancePx: number
  readonly startAngleDeg: number
  readonly twistDeg: number
}
