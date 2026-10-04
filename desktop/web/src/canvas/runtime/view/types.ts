// canvas/runtime/view/types.ts  (pure: no DOM, MapLibre, Pixi)

import type { ReadonlySignal } from '@preact/signals'

/** Session-plane metres: x east, y south (ADR 0001). */
export interface WorldPoint { readonly x: number; readonly y: number }
export interface WorldVector { readonly x: number; readonly y: number }
/** CSS px relative to the map canvas' top-left corner. */
export interface ScreenPoint { readonly x: number; readonly y: number }
/** Screen TL, TR, BR, BL order. */
export type WorldQuad = readonly [WorldPoint, WorldPoint, WorldPoint, WorldPoint]
export interface ScreenInsets { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number }
export interface GeoPoint { readonly lon: number; readonly lat: number }

/** World-axis box in plane metres. */
export interface SceneBounds { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }
export interface SceneBoundsOptions {
  /** The scene's extent at a candidate scale: corner points of every plant, zone and note footprint, in plane metres.
   *  Notes and default-mode plants are screen-sized, so the extent depends on the scale. The runtime supplies it
   *  (command-surface.ts, document-surface.ts) through canvas/runtime/scene-extent.ts, from plant-presentation.ts,
   *  annotation-layout.ts and zone-geometry.ts, so view/ imports none of them (P4). Without it a fit sees an empty scene. */
  readonly extentPoints?: (pixelsPerMetre: number) => readonly WorldPoint[]
  /** Scale that frames an empty Design, centred on the session plane origin. */
  readonly emptySceneScale?: number
}
export interface TemporaryBoundsFocusOptions {
  /** Symmetric CSS-pixel padding reserved by the caller's presentation. */
  readonly paddingCssPx: number
  /** Optional external ceiling, such as a MapLibre zoom-limit equivalent. */
  readonly maximumScale?: number
}
// This file uses no scene type. A view/ file that needs one (navigation.ts: ScenePersistedState) imports it type-only from
// '../scene/types' (P4 allows it), never the barrel '../scene' (P4 would reject it); files outside view/ keep today's barrel imports.

/**
 * The geographic camera in MapLibre's terms. bearingDeg: the compass direction that is
 * up on screen, degrees clockwise from true north, normalised to [0, 360)
 * (common-types views.rs validates [0, 360]).
 */
export interface ViewCamera {
  readonly center: GeoPoint          // ground point under the screen centre
  readonly zoom: number              // MapLibre zoom
  readonly bearingDeg: number
  /** Literal 0 until the pitch phase widens it to number; the compiler then lists every consumer. */
  readonly pitchDeg: 0
}

/**
 * A plane placement: a plane point p lands on screen at turn(p × scale, bearingDeg) + { x, y }: scaled, turned counter-clockwise
 * on screen by bearingDeg about the screen origin (so the compass direction bearingDeg points up), then translated, so { x, y } is
 * the plane origin's screen point; at bearing 0 it is today's CameraController viewport. No driver holds one (both hold a
 * ViewCamera): it is what a fit computes (fit.ts), what planarCameraOf reads off a transform for the chrome, and how tests place
 * the test view. A placement read back from a camera matches within 1e-6 px, not bit for bit.
 */
export interface PlanarCamera { readonly x: number; readonly y: number; readonly scale: number; readonly bearingDeg: number }

export interface ViewScreen { readonly width: number; readonly height: number; readonly devicePixelRatio: number }

/** Renderer and bulk-projection fast path. Pitch re-derives a nullable one (spec §6). */
export interface PlanarProjection {
  /** 2x3 affine in Pixi order [a, b, c, d, tx, ty]. */
  readonly affine: readonly [number, number, number, number, number, number]
}

export interface ViewTransform {
  readonly planeRevision: number     // session-plane identity; stale transforms are refused after re-origin
  readonly camera: ViewCamera
  readonly screen: ViewScreen
  readonly planar: PlanarProjection

  worldToScreen(p: WorldPoint): ScreenPoint
  /** The ground under a screen point. Pitch widens it to null above the horizon (spec §6). */
  screenToWorld(s: ScreenPoint): WorldPoint
  /** Bulk billboard projection: reads [x0,y0,x1,y1,…] metres, writes CSS px. No allocation. */
  projectAnchors(world: Float64Array, out: Float32Array, count: number): void

  /** Local ground resolution at a world point (view centre if omitted). Replaces `1 / viewport.scale` and the scale-bar value. */
  metresPerPixelAt(p?: WorldPoint): number
  screenDistance(a: WorldPoint, b: WorldPoint): number
  /** Unit world vectors of screen-right and screen-down at a point (view centre if omitted). */
  screenAxesInWorld(at?: WorldPoint): { readonly right: WorldVector; readonly down: WorldVector }

  visibleWorldQuad(insets?: ScreenInsets): WorldQuad
  /** Four projected corners, never two (rotation-handle anchor, menu anchor). */
  worldQuadToScreen(q: WorldQuad): readonly [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint]

  readonly pixelsPerMetre: number            // at the plane origin: today's `viewport.scale` (zoom bands, policy)
  readonly northUp: boolean                  // angularDistanceToNorth(bearing) < 0.05° and pitch 0
}

/** Everything the runtime publishes per camera change. Runtime-only (policy P10). */
export interface ViewFrame {
  readonly view: ViewTransform
  readonly mode: 'site' | 'overview'         // overview below 0.1 px/m (canvas/workspace-camera-policy.ts)
  readonly scaleBounds: { readonly min: number; readonly max: number }   // the effective bounds: policy zooms with the single-world floor at the live bearing (§1.1b)
  readonly insets: ScreenInsets              // from the visible-map-area seam
  readonly attached: boolean
  readonly revision: number
}

export type FramePhase = 'tools' | 'overlays'   // run in this order inside the `move` handler

export interface ViewFrameSource {
  readonly viewFrame: ReadonlySignal<ViewFrame>
  /** The frame after 150 ms without camera change (re-origin, last view, label admission, coverage). */
  readonly settledViewFrame: ReadonlySignal<ViewFrame>
  /** Synchronous per-frame callbacks; never effects, so per-frame work cannot fan out into Preact. */
  onViewFrame(phase: FramePhase, listener: (frame: ViewFrame) => void): () => void
}

/**
 * A driver's own frames: nobody reads a driver's settled frame or its overlays phase (only the host's own frame source, which
 * relays 'tools' and keeps its own settle, is read for either), so a driver publishes one unphased listener list and no settle.
 */
export interface DriverFrameSource {
  readonly viewFrame: ReadonlySignal<ViewFrame>
  onViewFrame(listener: (frame: ViewFrame) => void): () => void
}

/**
 * Dev diagnostics published with the map contributions and the surface state. Replaces `MapFrame`
 * and its `diagnostics` (canvas/maplibre-camera.ts, deleted end of 0A); `viewportCenterWorld` is renamed `centreWorld`.
 */
export interface ViewDiagnostics {
  readonly camera: ViewCamera
  readonly centreWorld: WorldPoint
  /** Ground under the four screen corners, TL, TR, BR, BL (was viewportCornerGeo). */
  readonly groundQuadGeo: readonly [GeoPoint, GeoPoint, GeoPoint, GeoPoint]
}
