// canvas/runtime/view/navigation.ts  (the camera policy; the only user of CameraDriver; implements RotationSession from read-surface.ts)

import type { ScenePersistedState } from '../scene/types'
import type { CameraDriverHost } from './camera-driver'
import type { NavigationPolicy } from './navigation-policy'
import type { RotationSession, ViewCommandSurface } from './read-surface'
import type {
  SceneBounds,
  SceneBoundsOptions,
  ScreenPoint,
  TemporaryBoundsFocusOptions,
  WorldPoint,
} from './types'

export interface ViewNavigationDeps {
  readonly driver: CameraDriverHost                   // the only CameraDriver user
  readonly policy: () => NavigationPolicy
  readonly clock: () => number
  /** The scene for zoomToFit, returnToDesign and zoomToSelection without arguments. */
  readonly readScene: () => { readonly persisted: ScenePersistedState; readonly selection: readonly WorldPoint[]; readonly bounds: SceneBoundsOptions }
}

export interface ViewNavigation extends ViewCommandSurface {
  /** Without arguments (the surface call) the navigation reads the current scene from its construction deps. */
  zoomToFit(scene?: ScenePersistedState, options?: SceneBoundsOptions): void   // keeps the bearing
  returnToDesign(scene?: ScenePersistedState, options?: SceneBoundsOptions): void
  /** Oriented at the current bearing: the box's four corners are fitted, not the box on screen axes. */
  focusTemporaryBounds(bounds: SceneBounds, options: TemporaryBoundsFocusOptions): boolean
  returnFromTemporaryFocus(): boolean        // bookmark is a ViewCamera: re-origin cannot invalidate it
  clearTemporaryFocus(): void
  centerOn(point: WorldPoint, pixelsPerMetre: number, options?: { readonly animate?: boolean; readonly bearingDeg?: number | 'keep' }): void
  /** Opening a Design: oriented fit at the given bearing. */
  openAt(scene: ScenePersistedState, bearingDeg: number): void

  // rotation
  turnToEdge(a: WorldPoint, b: WorldPoint): void   // smaller turn that makes a→b horizontal; never snapped
  beginRotation(pivot: ScreenPoint | 'centre'): RotationSession

  // gesture sinks (InputRouter only)
  panByPx(deltaPx: ScreenPoint): void
  zoomAroundPx(anchor: ScreenPoint, factor: number): void
}
