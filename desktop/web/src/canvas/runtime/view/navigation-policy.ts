// canvas/runtime/view/navigation-policy.ts  (pure; shared by both drivers)
//
// Owns the navigation limits both camera drivers apply: the policy values, the one constrain function
// (zoom range, the single-world floor for a bearing arc, the one-world hold of the rotated screen), and the
// bearing arithmetic (normalising, snapping, steps, shortest arcs).

import type { ReadonlySignal } from '@preact/signals'
import { MAPLIBRE_WORLD_TILE_SIZE, mercatorToGeo } from '../../projection'
import { singleWorldEffectiveMinimumZoom, type WorkspaceCameraPolicy } from '../../workspace-camera-policy'
import type { ViewCamera, ViewScreen } from './types'

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

export const ROTATE_DEG_PER_PX = 0.8                                  // MapLibre's rate
export const SNAP_TO_NORTH_DEG = 7
export const VIEW_EASE_MS = 300

/** 100 % zoom: today's CameraController reference scale. */
const REFERENCE_PIXELS_PER_METRE = 20
/** Bearings this close to a whole multiple of 360 read as north. */
const FULL_TURN_EPSILON_DEG = 1e-9
/** A step count this close to a whole number is that multiple (bearings arrive through float arithmetic). */
const STEP_EPSILON = 1e-9
const DEGREES_TO_RADIANS = Math.PI / 180

export function createNavigationPolicy(base: WorkspaceCameraPolicy, reducedMotion: ReadonlySignal<boolean>): NavigationPolicy {
  return Object.freeze({
    referenceLatitudeDeg: base.referenceLatitudeDeg,
    minZoom: base.minimumMapZoom,
    maxZoom: base.maximumMapZoom,
    overviewPixelsPerMetre: base.overviewScaleThreshold,
    referencePixelsPerMetre: REFERENCE_PIXELS_PER_METRE,
    reducedMotion,
  })
}

/**
 * Clamp zoom to [max(policy.minZoom, zoomFloorForArc(screen, policy, arc)), policy.maxZoom], the floor keeping one world copy
 * under the viewport rotated by every bearing in `bearingArc` (renderWorldCopies:false), then hold the rotated screen quad inside
 * one world: latitude inside ±85.05° and longitude inside ±180°. It replaces all of MapLibre's defaultConstrain (setConstrainOverride
 * replaces the zoom range and the longitude hold too). Idempotent. The zoom floor depends on the screen and the arc, never on the
 * centre, because MapLibre calls the guard on intermediate (old centre, new zoom) states.
 *
 * The arc defaults to the camera's own bearing, and the camera's bearing is always covered. The hold keeps the screen's bounding
 * box at every bearing of the arc inside the Mercator square; its limits are computed in degrees from the zoom, screen and arc
 * alone, so a second call finds nothing to move. A camera that needs no change is returned as the same object.
 */
export function constrainCamera(camera: ViewCamera, screen: ViewScreen, policy: NavigationPolicy,
  bearingArc?: { readonly fromDeg: number; readonly toDeg: number }): ViewCamera {
  const fromDeg = bearingArc?.fromDeg ?? camera.bearingDeg
  const toDeg = bearingArc?.toDeg ?? camera.bearingDeg
  const floor = Math.max(
    zoomFloorForArc(screen, policy, fromDeg, toDeg),
    zoomFloorForArc(screen, policy, camera.bearingDeg, camera.bearingDeg),
  )
  const minimum = Math.min(policy.maxZoom, Math.max(policy.minZoom, floor))
  const zoom = Math.min(policy.maxZoom, Math.max(minimum, camera.zoom))

  const extent = maximumRotatedExtent(screen, fromDeg, toDeg, camera.bearingDeg)
  const worldSize = MAPLIBRE_WORLD_TILE_SIZE * 2 ** zoom
  const halfWidth = extent.width / 2 / worldSize
  const halfHeight = extent.height / 2 / worldSize
  const west = halfWidth <= 0.5 ? mercatorToGeo(halfWidth, 0.5).lng : 0
  const east = halfWidth <= 0.5 ? mercatorToGeo(1 - halfWidth, 0.5).lng : 0
  const north = halfHeight <= 0.5 ? mercatorToGeo(0.5, halfHeight).lat : 0
  const south = halfHeight <= 0.5 ? mercatorToGeo(0.5, 1 - halfHeight).lat : 0
  const lon = Math.min(east, Math.max(west, camera.center.lon))
  const lat = Math.min(north, Math.max(south, camera.center.lat))

  if (zoom === camera.zoom && lon === camera.center.lon && lat === camera.center.lat) return camera
  const center = lon === camera.center.lon && lat === camera.center.lat ? camera.center : { lon, lat }
  return { center, zoom, bearingDeg: camera.bearingDeg, pitchDeg: 0 }
}

/** Zoom floor for a bearing arc: the maximum over the arc (largest near 45° + k·90°); for the arc [0, 0] it equals singleWorldEffectiveMinimumZoom. */
export function zoomFloorForArc(screen: ViewScreen, policy: NavigationPolicy, fromDeg: number, toDeg: number): number {
  const extent = maximumRotatedExtent(screen, fromDeg, toDeg)
  return singleWorldEffectiveMinimumZoom(extent.width, extent.height, policy.minZoom)
}

/** Any angle to [0, 360); results ≥ 360 − 1e-9 become 0 (so normaliseBearing(-1e-14) === 0). */
export function normaliseBearing(deg: number): number {
  let bearing = deg % 360
  if (bearing < 0) bearing += 360
  return bearing >= 360 - FULL_TURN_EPSILON_DEG || bearing === 0 ? 0 : bearing
}

/** min(b mod 360, 360 − b mod 360): the one test for "near north". */
export function angularDistanceToNorth(deg: number): number {
  const bearing = normaliseBearing(deg)
  return Math.min(bearing, 360 - bearing)
}

/** End of a free gesture: angularDistanceToNorth(deg) ≤ 7 → 0, else deg. */
export function snapBearing(deg: number): number {
  return angularDistanceToNorth(deg) <= SNAP_TO_NORTH_DEG ? 0 : deg
}

/** Absolute 15° multiples: round(deg / 15) * 15, normalised. */
export function roundToStep(deg: number, stepDeg: 15): number {
  return normaliseBearing(Math.round(deg / stepDeg) * stepDeg)
}

/** Key and compass steps: the next absolute multiple of 15 strictly in `direction` (22 → 15 → 0; 0 → 345). */
export function nextStep(deg: number, direction: 1 | -1, stepDeg: 15): number {
  const steps = normaliseBearing(deg) / stepDeg
  const whole = Math.round(steps)
  const from = Math.abs(steps - whole) < STEP_EPSILON ? whole : steps
  const next = direction > 0 ? Math.floor(from) + 1 : Math.ceil(from) - 1
  return normaliseBearing(next * stepDeg)
}

/** Shortest signed arc from a to b, in (-180, 180]. */
export function shortestArc(fromDeg: number, toDeg: number): number {
  const arc = normaliseBearing(toDeg - fromDeg)
  return arc > 180 ? arc - 360 : arc
}

/**
 * cos and sin of a bearing, exact at the four right angles (so bearing 0 is today's arithmetic bit for bit). Screen and plane
 * rotations in view/ all go through it.
 */
export function bearingCosSin(deg: number): readonly [number, number] {
  const bearing = normaliseBearing(deg)
  if (bearing === 0) return [1, 0]
  if (bearing === 90) return [0, 1]
  if (bearing === 180) return [-1, 0]
  if (bearing === 270) return [0, -1]
  const radians = bearing * DEGREES_TO_RADIANS
  return [Math.cos(radians), Math.sin(radians)]
}

/** Width and height of the screen's axis-aligned bounding box on the map, the largest over the arc (and any extra bearings). */
function maximumRotatedExtent(screen: ViewScreen, fromDeg: number, toDeg: number, ...alsoDeg: readonly number[]): { width: number; height: number } {
  const width = finiteSize(screen.width)
  const height = finiteSize(screen.height)
  const start = normaliseBearing(fromDeg)
  const sweep = shortestArc(fromDeg, toDeg)
  const bearings = [start, start + sweep, ...alsoDeg]
  if (sweep !== 0 && width > 0 && height > 0) {
    // Within each quarter turn the box's width peaks at atan2(h, w) and its height at atan2(w, h); between them it only falls
    // or rises, so the arc's maximum is at an end or at one of these angles.
    const low = Math.min(start, start + sweep)
    const high = Math.max(start, start + sweep)
    const widest = Math.atan2(height, width) / DEGREES_TO_RADIANS
    for (const peak of [widest, 90 - widest]) {
      for (let angle = peak + Math.ceil((low - peak) / 90) * 90; angle < high; angle += 90) {
        if (angle > low) bearings.push(angle)
      }
    }
  }
  let widestBox = 0
  let tallestBox = 0
  for (const bearing of bearings) {
    const [cos, sin] = bearingCosSin(bearing)
    widestBox = Math.max(widestBox, width * Math.abs(cos) + height * Math.abs(sin))
    tallestBox = Math.max(tallestBox, width * Math.abs(sin) + height * Math.abs(cos))
  }
  return { width: widestBox, height: tallestBox }
}

function finiteSize(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}
