// maplibre/workspace-camera.ts  (0A to the end of 0D2)
//
// Owns today's MapLibre workspace camera surface over the view (plan §4 0A "Legacy surface", spec §1.1b): the
// MapLibreWorkspaceCameraOwner shim, re-expressing the attached map's frame in the session plane on a re-origin. It extends the
// facade's CameraController shim; the workspace activation attaches and detaches the driver itself, directly on `host`
// (workspace-activation.ts), and reads camera failure from `host.failure`, so this shim calls no map method.

import type { MapLibreMapInstance } from './loader'
import { CameraController } from '../canvas/runtime/legacy-camera-facade'
import { createWorkspaceCameraPolicy, type WorkspaceCameraPolicy } from '../canvas/workspace-camera-policy'

/** The map operations the camera driver needs: the camera read-backs describe one camera (spec §1.1 driver rules). */
export type MapLibreWorkspaceCameraMap = Required<Pick<MapLibreMapInstance,
  | 'jumpTo'
  | 'resize'
  | 'on'
  | 'off'
  | 'getCenter'
  | 'getZoom'
  | 'getBearing'
  | 'getPitch'
  | 'getCanvas'
>> & Pick<MapLibreMapInstance, 'flyTo' | 'stop' | 'setTransformConstrain'>

/**
 * The workspace lifecycle receives only this narrow map-lifetime control.
 * It never owns or replaces the camera's stable frame signal.
 */
interface WorkspaceCameraAttachmentControl {
  /** Re-expresses the frame in the session plane after its origin changed; the map stays put. */
  refreshOrigin(): void
}

/** The workspace camera: the facade's headless camera while detached, and one attached MapLibre map's camera through its driver. */
export class MapLibreWorkspaceCameraOwner extends CameraController {
  readonly attachment: WorkspaceCameraAttachmentControl = {
    refreshOrigin: () => this.refreshOrigin(),
  }

  constructor(policy?: WorkspaceCameraPolicy) {
    super(policy ?? createWorkspaceCameraPolicy())
  }

  /** Re-expresses the attached map's frame in the session plane after the Scene's plane changed; the map stays put. */
  refreshOrigin(): void {
    const scenePlane = this.followedScenePlane
    if (!(scenePlane && this.frameNow().attached)) return
    // A re-origin keeps the temporary focus; reprojectViewport moves it into the new plane. A Document load clears it through its
    // own surface. The scale bounds follow the plane's latitude through the host's policy.
    this.withOneSnapshot(() => this.driver().planeChanged(scenePlane))
  }
}
