// canvas/runtime/input/thresholds.ts  (plain numbers; tests may pass others)
//
// Owns the recogniser's timing and distance thresholds (ADR 0017: rules are code, thresholds are data). The drag slop is
// the one rule that tells a tap from a drag, per pointer kind; the compass reads it too (U17).

import type { PointerKind } from '../interaction-types'

export interface Thresholds {
  /** A primary press is a drag once it moves this far (`d >= slop && d > 0`): mouse and pen 3 px (U6), so a click with a
   *  little jitter stays a click; touch 8 px, within which the recogniser holds a finger's press (spec §2.2 "Touch"). */
  readonly dragSlopPx: Readonly<Record<PointerKind, number>>
  readonly longPressMs: number               // 500
  readonly multiClickMs: number              // 500: a primary press this soon after the last one counts as its next click
  /** And this close to it: 6 px, a finger 30 px (MapLibre 6.10.0 tap_recognizer.ts MAX_DIST, BSD-3-Clause, Copyright (c)
   *  2023 MapLibre contributors), so a sloppy double tap still finishes a polygon. */
  readonly multiClickSlopPx: Readonly<Record<PointerKind, number>>
  readonly twistStartArcPx: number           // 25 px of arc over the smallest finger diameter seen (MapLibre's ROTATION_THRESHOLD)
  readonly pinchZoomStartLevels: number      // 0.1: a touch pinch zooms only past this zoom-level change (MapLibre's defaultZoomThreshold)
  readonly trackpadTwistStartDeg: number     // 10: WebKit gesture rotation before any rotate is emitted
}

export const DEFAULT_THRESHOLDS: Thresholds = Object.freeze({
  dragSlopPx: Object.freeze({ mouse: 3, pen: 3, touch: 8 }),
  longPressMs: 500,
  multiClickMs: 500,
  multiClickSlopPx: Object.freeze({ mouse: 6, pen: 6, touch: 30 }),
  twistStartArcPx: 25,
  pinchZoomStartLevels: 0.1,
  trackpadTwistStartDeg: 10,
})
