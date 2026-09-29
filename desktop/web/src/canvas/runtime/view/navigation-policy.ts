// canvas/runtime/view/navigation-policy.ts  (pure; shared by both drivers)

import type { ReadonlySignal } from '@preact/signals'

/**
 * Built by createNavigationPolicy(base, reducedMotion) from today's WorkspaceCameraPolicy (canvas/workspace-camera-policy.ts,
 * kept: pure, and P4 lets view/ import it). The reference latitude turns zooms into px/m (cameraScaleBoundsForPolicy → ViewFrame.scaleBounds).
 */
export interface NavigationPolicy {
  readonly referenceLatitudeDeg: number    // the session plane's latitude; replacePolicy changes it
  readonly minZoom: number                 // 0
  readonly maxZoom: number                 // 27
  readonly overviewPixelsPerMetre: number  // 0.1
  readonly referencePixelsPerMetre: number // 20 px/m = 100 %
  /** prefers-reduced-motion: reduce. Read by the platform (platform/desktop.ts, platform/browser.ts) and injected; view/ never calls matchMedia (P4). Eases and tweens become 'none' moves while true. */
  readonly reducedMotion: ReadonlySignal<boolean>
}
