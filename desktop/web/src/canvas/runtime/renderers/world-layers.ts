/**
 * The scene's world root (spec §1.5): zones and measurement guides in world
 * metres under the view's affine. A frame writes the affine and nothing else;
 * the strokes, which are CSS px wide at every scale, are traced again only when
 * the scale changes (policy P12's behavioural half, `world-layers.test.ts`).
 */

// Production CSP rejects Pixi's generated functions; its shim avoids eval.
import 'pixi.js/unsafe-eval'
import { Container, Graphics } from 'pixi.js'
import {
  createMeasurementGuidePresentation,
  MEASUREMENT_GUIDE_DASH_PX,
  MEASUREMENT_GUIDE_GAP_PX,
  MEASUREMENT_GUIDE_TICK_HALF_PX,
} from '../measurement-guides'
import type { SceneMeasurementGuideEntity, ScenePoint, SceneZoneEntity } from '../scene'
import {
  getCanvasInteractionStrokeVisual,
  getGuideLineVisual,
  getSceneLayerStyle,
  resolveZoneVisual,
} from '../scene-visuals'
import type { ViewTransform } from '../view/types'
import { getEllipticalZonePolygon, getRectangularZoneCorners } from '../zone-geometry'
import {
  cssColorAlpha,
  destroyEntriesNotIn,
  drawClosedPath,
  hoverStateForTarget,
  resolveCasedStroke,
  resolveInteractionState,
  reuseGeometry,
  screenPxToWorldPx,
  toPixiColor,
  writeWorldAffine,
} from './scene-paint'
import type { SceneRendererHoverState, SceneRendererSnapshot } from './scene-types'

export const ZONE_STROKE_PX = 2
const MEASUREMENT_GUIDE_STROKE_PX = 1.5

export interface WorldLayers {
  /** Zones, then measurement guides; its transform is the view's affine. */
  readonly root: Container
  syncScene(snapshot: SceneRendererSnapshot): void
  setView(view: ViewTransform): void
}

export function createWorldLayers(): WorldLayers {
  const root = new Container()
  const zonesLayer = new Container()
  const measurementGuideLayer = new Container()
  root.addChild(zonesLayer)
  root.addChild(measurementGuideLayer)
  const zoneGraphicsById = new Map<string, Graphics>()
  const measurementGuideGraphicsById = new Map<string, Graphics>()
  let snapshot: SceneRendererSnapshot | null = null
  /** The latest view's scale; null before the first view. */
  let viewPixelsPerMetre: number | null = null
  /** The scale the strokes were traced at; null until a scene and a view have both arrived. */
  let tracedPixelsPerMetre: number | null = null

  function trace(reconcileRemoved: boolean): void {
    if (!snapshot || viewPixelsPerMetre === null) return
    syncZones(zonesLayer, zoneGraphicsById, snapshot, viewPixelsPerMetre, reconcileRemoved)
    syncMeasurementGuides(measurementGuideLayer, measurementGuideGraphicsById, snapshot, viewPixelsPerMetre, reconcileRemoved)
    tracedPixelsPerMetre = viewPixelsPerMetre
  }

  return {
    root,
    syncScene(next) {
      snapshot = next
      trace(true)
    },
    setView(view) {
      writeWorldAffine(root, view)
      viewPixelsPerMetre = view.pixelsPerMetre
      if (viewPixelsPerMetre === tracedPixelsPerMetre) return
      // The first view after a scene that arrived without one reconciles it.
      trace(tracedPixelsPerMetre === null)
    },
  }
}

function syncZones(
  layer: Container,
  graphicsById: Map<string, Graphics>,
  snapshot: SceneRendererSnapshot,
  pixelsPerMetre: number,
  reconcileRemoved: boolean,
): void {
  const style = getSceneLayerStyle(snapshot.scene, 'zones')
  layer.visible = style.visible
  layer.alpha = style.opacity
  if (!style.visible) {
    if (reconcileRemoved) destroyEntriesNotIn(graphicsById, new Set(snapshot.scene.zones.map((zone) => zone.id)))
    return
  }

  const nextZoneIds = new Set<string>()
  for (const zone of snapshot.scene.zones) {
    nextZoneIds.add(zone.id)
    const graphics = graphicsById.get(zone.id) ?? new Graphics()
    if (!graphicsById.has(zone.id)) {
      graphicsById.set(zone.id, graphics)
      layer.addChild(graphics)
    }
    drawZone(
      graphics,
      zone,
      snapshot.selectedZoneIds.has(zone.id),
      snapshot.highlightedZoneIds.has(zone.id),
      hoverStateForTarget(snapshot, 'zone', zone.id),
      pixelsPerMetre,
    )
    graphics.visible = true
  }

  if (!reconcileRemoved) return
  for (const [zoneId, graphics] of graphicsById) {
    if (nextZoneIds.has(zoneId)) continue
    graphics.removeFromParent()
    graphics.destroy()
    graphicsById.delete(zoneId)
  }
}

function drawZone(
  graphics: Graphics,
  zone: SceneZoneEntity,
  selected: boolean,
  highlighted: boolean,
  hoverState: SceneRendererHoverState | null,
  pixelsPerMetre: number,
): void {
  const visual = resolveZoneVisual(zone)
  const fillColor = toPixiColor(visual.fill, 0)
  const fillAlpha = 0.2 * cssColorAlpha(visual.fill)
  const interactionState = resolveInteractionState(selected, highlighted, hoverState)
  const interactionVisual = interactionState ? getCanvasInteractionStrokeVisual(interactionState) : null
  const stroke = resolveCasedStroke(interactionVisual, { color: visual.stroke, casing: visual.casing }, ZONE_STROKE_PX, pixelsPerMetre)

  if (reuseGeometry(graphics, [zone.zoneType, zone.points, zone.rotationDeg, fillColor, fillAlpha, stroke])) return
  graphics.clear()

  if (!traceZonePath(graphics, zone)) return
  if (zone.zoneType !== 'line') graphics.fill({ color: fillColor, alpha: fillAlpha })
  graphics.stroke(stroke.casing)
  traceZonePath(graphics, zone)
  graphics.stroke(stroke.stroke)
}

/** Traces the zone outline in world metres; the caller fills and strokes it. Returns false when nothing is drawable. */
export function traceZonePath(graphics: Graphics, zone: SceneZoneEntity): boolean {
  if (zone.zoneType === 'rect' && zone.points.length >= 4) {
    if (Math.abs(zone.rotationDeg) > 0.000001) {
      const corners = getRectangularZoneCorners(zone)
      if (!corners) return false
      drawClosedPath(graphics, corners)
      return true
    }

    const start = zone.points[0]!
    const end = zone.points[2]!
    graphics.rect(start.x, start.y, end.x - start.x, end.y - start.y)
    return true
  }

  if (zone.zoneType === 'ellipse' && zone.points.length >= 2) {
    if (Math.abs(zone.rotationDeg) > 0.000001) {
      const polygon = getEllipticalZonePolygon(zone)
      if (!polygon) return false
      drawClosedPath(graphics, polygon)
      return true
    }

    const center = zone.points[0]!
    const radii = zone.points[1]!
    graphics.ellipse(center.x, center.y, radii.x, radii.y)
    return true
  }

  if (zone.points.length < 2) return false

  const first = zone.points[0]!
  graphics.moveTo(first.x, first.y)
  for (let i = 1; i < zone.points.length; i += 1) {
    const point = zone.points[i]!
    graphics.lineTo(point.x, point.y)
  }
  if (zone.zoneType !== 'line') graphics.closePath()
  return true
}

function syncMeasurementGuides(
  layer: Container,
  graphicsById: Map<string, Graphics>,
  snapshot: SceneRendererSnapshot,
  pixelsPerMetre: number,
  reconcileRemoved: boolean,
): void {
  const style = getSceneLayerStyle(snapshot.scene, 'measurement-guides')
  layer.visible = style.visible
  layer.alpha = style.opacity
  if (!style.visible) {
    if (reconcileRemoved) destroyEntriesNotIn(graphicsById, new Set(snapshot.scene.measurementGuides.map((guide) => guide.id)))
    return
  }

  const nextIds = new Set<string>()
  for (const guide of snapshot.scene.measurementGuides) {
    if (!drawMeasurementGuide(graphicsById, layer, guide, snapshot, pixelsPerMetre)) continue
    nextIds.add(guide.id)
  }

  for (const [guideId, graphics] of graphicsById) {
    if (nextIds.has(guideId)) continue
    if (reconcileRemoved) {
      graphics.removeFromParent()
      graphics.destroy()
      graphicsById.delete(guideId)
    } else {
      graphics.visible = false
    }
  }
}

/** Draws a guide too short to measure as nothing and returns false. */
function drawMeasurementGuide(
  graphicsById: Map<string, Graphics>,
  layer: Container,
  guide: SceneMeasurementGuideEntity,
  snapshot: SceneRendererSnapshot,
  pixelsPerMetre: number,
): boolean {
  const presentation = createMeasurementGuidePresentation(guide, { x: 0, y: 0, scale: pixelsPerMetre })
  if (!presentation) return false
  let graphics = graphicsById.get(guide.id)
  if (!graphics) {
    graphics = new Graphics()
    graphicsById.set(guide.id, graphics)
    layer.addChild(graphics)
  }
  graphics.visible = true

  const interactionState = resolveInteractionState(
    snapshot.selectedMeasurementGuideIds.has(guide.id),
    false,
    hoverStateForTarget(snapshot, 'measurement-guide', guide.id),
  )
  const interactionVisual = interactionState ? getCanvasInteractionStrokeVisual(interactionState) : null
  const stroke = resolveCasedStroke(interactionVisual, getGuideLineVisual(), MEASUREMENT_GUIDE_STROKE_PX, pixelsPerMetre)
  if (reuseGeometry(graphics, [guide.start, guide.end, stroke, pixelsPerMetre])) return true
  graphics.clear()
  const units = (px: number) => screenPxToWorldPx(px, pixelsPerMetre)
  const trace = () => {
    drawDashedLine(graphics, guide.start, guide.end, units(MEASUREMENT_GUIDE_DASH_PX), units(MEASUREMENT_GUIDE_GAP_PX))
    drawTick(graphics, guide.start, presentation.normalWorld, units(MEASUREMENT_GUIDE_TICK_HALF_PX))
    drawTick(graphics, guide.end, presentation.normalWorld, units(MEASUREMENT_GUIDE_TICK_HALF_PX))
  }
  trace()
  graphics.stroke(stroke.casing)
  trace()
  graphics.stroke(stroke.stroke)
  return true
}

function drawDashedLine(graphics: Graphics, start: ScenePoint, end: ScenePoint, dashLength: number, gapLength: number): void {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  if (length <= 0) return

  const unit = { x: dx / length, y: dy / length }
  let cursor = 0
  while (cursor < length) {
    const segmentEnd = Math.min(cursor + dashLength, length)
    if (segmentEnd > cursor) {
      graphics.moveTo(start.x + unit.x * cursor, start.y + unit.y * cursor)
        .lineTo(start.x + unit.x * segmentEnd, start.y + unit.y * segmentEnd)
    }
    cursor += dashLength + gapLength
  }
}

function drawTick(graphics: Graphics, point: ScenePoint, normal: ScenePoint, halfLength: number): void {
  graphics.moveTo(point.x - normal.x * halfLength, point.y - normal.y * halfLength)
    .lineTo(point.x + normal.x * halfLength, point.y + normal.y * halfLength)
}
