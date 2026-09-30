// The legacy camera surface (0A to the end of 0D2): the names that files outside the View stream import from this module, kept
// with today's signatures over the view (canvas/runtime/legacy-camera-facade.ts, plan §4 0A "Legacy surface").
export {
  CameraController,
  cameraFramingRect,
  fitCameraViewport,
  type CameraFrameInsets,
  type CameraViewportSnapshot,
  type WorkspaceCameraFrameReader,
  type WorkspaceCameraNavigation,
  type WorkspaceCameraOwner,
} from './legacy-camera-facade'
export type { SceneBounds, SceneBoundsOptions, TemporaryBoundsFocusOptions } from './view/types'
