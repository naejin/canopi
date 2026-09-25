import { viewportCenterWorld } from '../../projection'
import type { CameraViewportSnapshot, WorkspaceCameraNavigation } from '../camera'
import type { SceneStateReader } from '../scene'
import type { SceneCommandAdmission, SceneRuntimeEditCoordinator } from './transactions'
import type { SceneRuntimeMutationController } from './mutations'

interface SceneRuntimeReoriginOptions {
  readonly sceneState: Pick<SceneStateReader, 'sessionPlane'>
  readonly authority: Pick<SceneRuntimeEditCoordinator, 'reoriginSessionPlane'>
  readonly commandAdmission: SceneCommandAdmission
  readonly clipboard: Pick<SceneRuntimeMutationController, 'remapClipboard'>
  readonly cameraNavigation: Pick<WorkspaceCameraNavigation, 'reprojectViewport'>
}

/**
 * Decides when to rebuild the session plane: once a settled site-scale view
 * centre is more than 10 km from the plane origin. The Settled Scene Authority
 * performs the plane change; this owner only supplies the view centre and
 * keeps its caller-held metre state (clipboard, viewport) in the new plane.
 */
export class SceneRuntimeReoriginController {
  private scheduled = false
  private disposed = false

  constructor(private readonly options: SceneRuntimeReoriginOptions) {}

  observe(frame: CameraViewportSnapshot): void {
    if (this.disposed || this.scheduled || frame.mode !== 'site') return
    const centre = viewportCenterWorld(frame.viewport, frame.screenSize)
    if (![centre.x, centre.y].every(Number.isFinite)) return
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

  private reoriginAt(centre: { readonly x: number; readonly y: number }): void {
    const plane = this.options.sceneState.sessionPlane
    if (!plane.needsReorigin(centre)) return
    const transform = this.options.authority.reoriginSessionPlane(
      plane.toGeo(centre),
      (reproject) => this.options.clipboard.remapClipboard(reproject),
    )
    if (transform) this.options.cameraNavigation.reprojectViewport(transform)
  }
}
