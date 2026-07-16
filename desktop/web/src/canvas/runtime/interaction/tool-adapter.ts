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

export interface SceneToolTransientOptions {
  readonly preserveActiveDraft?: boolean
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
  readonly hasActiveSceneEdit?: () => boolean
  readonly shouldIgnorePointerEvent?: (target: EventTarget | null) => boolean
  readonly shouldIgnorePointerUpWithoutCapture?: () => boolean
  readonly shouldPreserveTransientOnPan?: () => boolean
  readonly shouldSuppressHover?: () => boolean
  readonly shouldSuppressSharedKeyboard?: (event: KeyboardEvent) => boolean
  readonly pointerDown?: (context: SceneToolPointerDownContext) => boolean
  readonly pointerMoveWithoutCapture?: (context: SceneToolPointerEvent) => boolean
  readonly pointerMoveWithCapture?: (context: SceneToolCapturedPointerContext) => boolean
  readonly keyDown?: (event: KeyboardEvent) => boolean
  readonly canUndoTransientHistory?: () => boolean
  readonly canRedoTransientHistory?: () => boolean
  readonly undoTransientHistory?: () => boolean
  readonly redoTransientHistory?: () => boolean
  readonly cancelTransient?: (options?: SceneToolTransientOptions) => void
  readonly refreshViewportDependent?: () => boolean | void
  readonly refreshSelectionDependent?: () => void
  readonly refreshTranslations?: () => void
  readonly dispose?: () => void
}
