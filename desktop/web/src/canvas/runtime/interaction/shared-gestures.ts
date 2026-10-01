// canvas/runtime/interaction/shared-gestures.ts
//
// The legacy bridge's pan (0B only, plan §4 0B): a middle-button, Space-held or overview press pans the map under a
// bridged tool until its release, with today's grabbing cursor. Select's clicks, band and move-drag run on the ToolHost
// (tools/select/**); this module goes with scene-interaction.ts at the end of 0B.

import type { WorkspaceCameraNavigation } from '../camera'
import type { ScenePoint } from '../scene'

export interface SceneInteractionSharedGestureContext {
  readonly container: HTMLElement
  readonly cameraNavigation: Pick<WorkspaceCameraNavigation, 'panBy'>
  readonly render: (kind: 'scene' | 'viewport') => void
  readonly refreshViewportDependent: () => void
}

interface SharedGesturePointerDownContext {
  readonly event: PointerEvent
  readonly screen: ScenePoint
  readonly tool: string
  readonly spaceHeld: boolean
}

interface SharedGesturePointerMoveContext {
  readonly screen: ScenePoint
}

interface SharedGesturePointerUpContext {
  /** The armed tool keeps its draft through a pan (a polygon in progress). */
  readonly preserveActiveDraft: boolean
}

interface SharedGesturePointerUpResult {
  readonly preserveActiveDraft: boolean
}

export interface SceneInteractionSharedGestures {
  readonly panning: boolean
  /** True when the press pans: the middle button, the Pan tool, or Space held. */
  beginPan(context: SharedGesturePointerDownContext): boolean
  /** True when a pan took the move. */
  pointerMove(context: SharedGesturePointerMoveContext): boolean
  pointerUp(context: SharedGesturePointerUpContext): SharedGesturePointerUpResult
  cancel(): void
  dispose(): void
}

export function createSceneInteractionSharedGestures(
  context: SceneInteractionSharedGestureContext,
): SceneInteractionSharedGestures {
  return new DefaultSceneInteractionSharedGestures(context)
}

class DefaultSceneInteractionSharedGestures implements SceneInteractionSharedGestures {
  private lastScreen: ScenePoint | null = null

  constructor(private readonly context: SceneInteractionSharedGestureContext) {}

  get panning(): boolean {
    return this.lastScreen !== null
  }

  beginPan({ event, screen, tool, spaceHeld }: SharedGesturePointerDownContext): boolean {
    if (event.button !== 1 && tool !== 'hand' && !spaceHeld) return false
    event.preventDefault()
    this.lastScreen = screen
    this.context.container.style.cursor = 'grabbing'
    return true
  }

  pointerMove({ screen }: SharedGesturePointerMoveContext): boolean {
    const lastScreen = this.lastScreen
    if (!lastScreen) return false
    this.context.cameraNavigation.panBy({
      x: screen.x - lastScreen.x,
      y: screen.y - lastScreen.y,
    })
    this.lastScreen = screen
    this.context.render('viewport')
    this.context.refreshViewportDependent()
    return true
  }

  pointerUp({ preserveActiveDraft }: SharedGesturePointerUpContext): SharedGesturePointerUpResult {
    return { preserveActiveDraft: this.panning && preserveActiveDraft }
  }

  cancel(): void {
    this.lastScreen = null
  }

  dispose(): void {
    this.cancel()
  }
}
