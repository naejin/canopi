import type { ScenePoint } from '../scene'

export interface SceneToolPointerEvent {
  readonly event: PointerEvent
  readonly screen: ScenePoint
  readonly rawWorld: ScenePoint
}

export interface SceneToolPointerDrag {
  readonly update: (context: SceneToolPointerEvent) => void
  readonly commit: (context: SceneToolPointerEvent) => void
}

export interface SceneToolPointerDownContext extends SceneToolPointerEvent {
  readonly beginDrag: (drag: SceneToolPointerDrag) => void
  readonly clearPointerGesture: () => void
}

export interface SceneToolCapturedPointerContext extends SceneToolPointerEvent {
  readonly startScreen: ScenePoint
  readonly startWorld: ScenePoint
  readonly beginDrag: (drag: SceneToolPointerDrag) => void
  readonly clearPointerGesture: () => void
}

export interface SceneToolAdapter {
  readonly onActivate?: () => void
  readonly onDeactivate?: () => void
  readonly shouldIgnorePointerEvent?: (target: EventTarget | null) => boolean
  readonly shouldSuppressHover?: () => boolean
  readonly shouldSuppressSharedKeyboard?: (event: KeyboardEvent) => boolean
  readonly pointerDown?: (context: SceneToolPointerDownContext) => boolean
  readonly pointerMoveWithoutCapture?: (context: SceneToolPointerEvent) => boolean
  readonly pointerMoveWithCapture?: (context: SceneToolCapturedPointerContext) => boolean
  readonly keyDown?: (event: KeyboardEvent) => boolean
  readonly refreshViewportDependent?: () => void
  readonly dispose?: () => void
}
