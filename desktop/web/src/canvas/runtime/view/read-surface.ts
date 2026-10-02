// canvas/runtime/view/read-surface.ts  (types; the app-facing side, exposed on the canvas session)

import type { ReadonlySignal } from '@preact/signals'
import type {
  GeoBounds,
  GeoPoint,
  SceneBounds,
  ScreenInsets,
  ScreenPoint,
  TemporaryBoundsFocusOptions,
  ViewCamera,
  ViewScreen,
} from './types'

/** Returned by ViewCommandSurface.beginRotation (the compass) and ViewNavigation.beginRotation; here so app code can name it (P10). */
export interface RotationSession {
  /**
   * totalDeltaDeg: rotation since begin. With step, the published bearing is
   * roundToStep(start + totalDeltaDeg, 15): absolute multiples of 15°, not start + 15k.
   */
  update(totalDeltaDeg: number, options: { readonly step: boolean }): void
  /** snapBearing: within 7° of north tweens to 0 in 300 ms about the session pivot; else keeps. */
  end(): void
  /** Restores the full starting ViewCamera with animation 'none' (Esc during a rotate). */
  cancel(): void
}

/** What app code and components may observe. Each signal changes only when its own value changes. */
export interface ViewReadSurface {
  readonly mode: ReadonlySignal<'site' | 'overview'>
  readonly zoomBand: ReadonlySignal<number>              // floor(log(pixelsPerMetre) / log(1.25)): LOD key
  readonly bearingDeg: ReadonlySignal<number>            // rounded to 0.1° (compass needle, PDF "As on screen")
  readonly northUp: ReadonlySignal<boolean>              // rulers and their hint; never hides the compass
  readonly groundMetresPerPixel: ReadonlySignal<number>  // at the screen centre, 3 significant figures (scale bar, ratio)
  readonly zoomLimit: ReadonlySignal<'min' | 'max' | null>
  /** Overview only: the Design origin's screen point, rounded to whole pixels, or null in site mode or within 24 px of an edge.
   *  The one read that changes during a pan (the overview pin must track the Design); it updates per frame only in overview,
   *  where nothing else re-renders, and is the named exception to the coarse-signal rule (P10). */
  readonly designPin: ReadonlySignal<ScreenPoint | null>
  /** The camera after 150 ms without change (the settled frame's camera): last view, map contributions. Never a user-triggered capture (captureView). */
  readonly settledCamera: ReadonlySignal<ViewCamera>
  /** The settled frame's revision: changes once per settle, whatever settled (camera, screen, insets, re-origin). The labels count. */
  readonly settledRevision: ReadonlySignal<number>
  /**
   * Saved-view capture, saved-view snapshot, PDF capture, story restore point: the LIVE frame's camera (viewFrame.peek(),
   * not the settled one), its four-corner ground extent and the screen it was seen on. User-triggered captures record what
   * is on screen now, as today's `queries.viewport` reads do (current-view.ts:49, :86, snapshot.ts:64, controller.ts:102),
   * so a capture within 150 ms of a pan, zoom or key pan, or during a flight, never records the previous camera. The last
   * view (settings) keeps `settledCamera`, as today.
   */
  captureView(): { readonly camera: ViewCamera; readonly extent: GeoBounds; readonly screen: ViewScreen }
}

/** What app code and components may command. Implemented by ViewNavigation; nothing else is exposed. */
export interface ViewCommandSurface {
  zoomIn(): void
  zoomOut(): void
  zoomBy(factor: number): void                         // kept from today's viewport surface (zoom slider)
  zoomToFit(): void                                    // Fit to Design, Home
  zoomToSelection(): void                              // Shift+2
  returnToDesign(): void                               // kept: "Back to my Design"
  focusTemporaryBounds(bounds: SceneBounds, options: TemporaryBoundsFocusOptions): boolean          // kept: plant finder, LiDAR
  returnFromTemporaryFocus(): boolean                  // kept
  setFramingInsets(insets: ScreenInsets): void         // kept: the visible-map-area seam
  resetNorth(): void
  rotateBy(direction: 1 | -1): void                    // next absolute 15° multiple in that direction
  beginRotation(pivot: 'centre'): RotationSession      // compass drag
  showCamera(camera: ViewCamera, options?: { readonly motion?: 'fly' | 'jump' }): void   // saved views, stories
  /** Place search. Returns false when the place cannot be shown (today's boolean `showPlace`). */
  showPlace(place: GeoPoint, zoom: number, options?: { readonly motion?: 'fly' | 'jump' }): boolean
}
