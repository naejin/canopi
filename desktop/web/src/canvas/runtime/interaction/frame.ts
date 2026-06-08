export interface SceneInteractionFrameHandlers {
  readonly pointerDown: (event: PointerEvent) => void
  readonly pointerLeave: (event: PointerEvent) => void
  readonly pointerMove: (event: PointerEvent) => void
  readonly pointerUp: (event: PointerEvent) => void
  readonly keyDown: (event: KeyboardEvent) => void
  readonly keyUp: (event: KeyboardEvent) => void
  readonly wheel: (event: WheelEvent) => void
  readonly dragOver: (event: DragEvent) => void
  readonly dragLeave: (event: DragEvent) => void
  readonly drop: (event: DragEvent) => void
}

export interface SceneInteractionFrameOptions {
  readonly container: HTMLElement
  readonly handlers: SceneInteractionFrameHandlers
}

export interface SceneInteractionToolTransition {
  readonly toolName: string
  readonly transition: (toolName: string) => void
  readonly updateCursor: (toolName: string) => void
}

export interface SceneInteractionTransientCleanupOptions {
  readonly preserveActiveDraft?: boolean
}

export interface SceneInteractionTransientCleanup {
  readonly clearPointerGesture: () => void
  readonly cancelSharedGestures: () => void
  readonly cancelToolTransient: (options: SceneInteractionTransientCleanupOptions) => void
  readonly clearHover: () => void
  readonly resetCursor: () => void
}

export interface SceneInteractionFrame {
  attach(): void
  detach(): void
  transitionTool(transition: SceneInteractionToolTransition): void
  cleanupTransient(
    options: SceneInteractionTransientCleanupOptions,
    cleanup: SceneInteractionTransientCleanup,
  ): void
  dispose(cleanup: () => void): void
}

export function createSceneInteractionFrame(options: SceneInteractionFrameOptions): SceneInteractionFrame {
  return new DefaultSceneInteractionFrame(options)
}

class DefaultSceneInteractionFrame implements SceneInteractionFrame {
  private attached = false
  private disposed = false

  constructor(private readonly options: SceneInteractionFrameOptions) {}

  attach(): void {
    if (this.attached || this.disposed) return
    const { container, handlers } = this.options
    container.addEventListener('pointerdown', handlers.pointerDown)
    container.addEventListener('pointerleave', handlers.pointerLeave)
    window.addEventListener('pointermove', handlers.pointerMove)
    window.addEventListener('pointerup', handlers.pointerUp)
    window.addEventListener('keydown', handlers.keyDown)
    window.addEventListener('keyup', handlers.keyUp)
    container.addEventListener('wheel', handlers.wheel, { passive: false })
    container.addEventListener('dragover', handlers.dragOver)
    container.addEventListener('dragleave', handlers.dragLeave)
    container.addEventListener('drop', handlers.drop)
    this.attached = true
  }

  detach(): void {
    if (!this.attached) return
    const { container, handlers } = this.options
    container.removeEventListener('pointerdown', handlers.pointerDown)
    container.removeEventListener('pointerleave', handlers.pointerLeave)
    window.removeEventListener('pointermove', handlers.pointerMove)
    window.removeEventListener('pointerup', handlers.pointerUp)
    window.removeEventListener('keydown', handlers.keyDown)
    window.removeEventListener('keyup', handlers.keyUp)
    container.removeEventListener('wheel', handlers.wheel)
    container.removeEventListener('dragover', handlers.dragOver)
    container.removeEventListener('dragleave', handlers.dragLeave)
    container.removeEventListener('drop', handlers.drop)
    this.attached = false
  }

  transitionTool(transition: SceneInteractionToolTransition): void {
    if (this.disposed) return
    transition.transition(transition.toolName)
    transition.updateCursor(transition.toolName)
  }

  cleanupTransient(
    options: SceneInteractionTransientCleanupOptions,
    cleanup: SceneInteractionTransientCleanup,
  ): void {
    if (this.disposed) return
    cleanup.clearPointerGesture()
    cleanup.cancelSharedGestures()
    cleanup.cancelToolTransient(options)
    cleanup.clearHover()
    cleanup.resetCursor()
  }

  dispose(cleanup: () => void): void {
    if (this.disposed) return
    this.detach()
    cleanup()
    this.disposed = true
  }
}
