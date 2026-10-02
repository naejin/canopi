import type { SceneStateReader } from '../scene'
import type { ViewFrame } from '../view/types'
import { planarCameraOf } from '../view/view-transform'
import type { SceneCommandAdmission, SceneRuntimeEditCoordinator } from './transactions'

interface SceneRuntimeReoriginOptions {
  readonly sceneState: Pick<SceneStateReader, 'sessionPlane'>
  readonly authority: Pick<SceneRuntimeEditCoordinator, 'reoriginSessionPlane'>
  readonly commandAdmission: SceneCommandAdmission
}

/** What the controller last looked at: a frame that keeps all of it (a hydration, an inset change) is not observed. */
interface ObservedFrame {
  readonly x: number
  readonly y: number
  readonly scale: number
  readonly bearingDeg: number
  readonly width: number
  readonly height: number
  readonly mode: ViewFrame['mode']
}

/**
 * Decides when to rebuild the session plane: once a settled site-scale view
 * centre is more than 10 km from the plane origin. The Settled Scene Authority
 * performs the plane change; while it does, `reoriginating` is true, so the
 * runtime's plane effect moves the camera into the new plane with its ground
 * kept. The clipboard remaps itself on paste.
 */
export class SceneRuntimeReoriginController {
  private scheduled = false
  private disposed = false
  private _reoriginating = false
  private last: ObservedFrame | null = null

  constructor(private readonly options: SceneRuntimeReoriginOptions) {}

  /** True while the authority commits a re-origin's plane. */
  get reoriginating(): boolean {
    return this._reoriginating
  }

  observe(frame: ViewFrame): void {
    if (this.disposed || this.unchanged(frame) || this.scheduled || frame.mode !== 'site') return
    const { screen } = frame.view
    // The ground under the screen centre, whatever the bearing.
    const centre = frame.view.screenToWorld({ x: screen.width / 2, y: screen.height / 2 })
    if (!centre || ![centre.x, centre.y].every(Number.isFinite)) return
    if (!this.options.sceneState.sessionPlane.needsReorigin(centre)) return
    this.scheduled = true
    queueMicrotask(() => {
      this.scheduled = false
      if (this.disposed) return
      this.options.commandAdmission.runWhenSettled(() => this.reoriginAt(centre), undefined)
    })
  }

  dispose(): void {
    this.disposed = true
  }

  /** Records the frame and says whether it keeps the placement, screen size and mode of the last one seen. */
  private unchanged(frame: ViewFrame): boolean {
    const { x, y, scale, bearingDeg } = planarCameraOf(frame.view)
    const { width, height } = frame.view.screen
    const next: ObservedFrame = { x, y, scale, bearingDeg, width, height, mode: frame.mode }
    const last = this.last
    this.last = next
    return last !== null
      && last.x === next.x
      && last.y === next.y
      && last.scale === next.scale
      && last.bearingDeg === next.bearingDeg
      && last.width === next.width
      && last.height === next.height
      && last.mode === next.mode
  }

  private reoriginAt(centre: { readonly x: number; readonly y: number }): void {
    const plane = this.options.sceneState.sessionPlane
    if (!plane.needsReorigin(centre)) return
    this._reoriginating = true
    try {
      this.options.authority.reoriginSessionPlane(plane.toGeo(centre))
    } finally {
      this._reoriginating = false
    }
  }
}
