import { CANVAS_CHROME_FONT_FAMILY } from '../chrome-fonts'
import {
  buildPlantPresentationEntries,
  getStackBadgeOffsetPx,
  layoutPlantPresentation,
  STACK_BADGE_RADIUS_PX,
  type PlantPresentationEntry,
} from './plant-presentation'
import {
  getPlantSymbolShapes,
  ROUND_PLANT_SYMBOL_RADIUS,
  tracePlantSymbolContour,
} from './plant-symbol-recipes'
import type { SceneRendererSnapshot } from './renderers/scene-types'
import type { SceneViewportState, SceneZoneEntity } from './scene'
import {
  getCanvasInteractionStrokeVisual,
  getPlantSymbolEdgeColor,
  getPlantSymbolEdgeWidth,
  getSceneLayerStyle,
  getStackBadgeBackgroundColor,
  getStackBadgeTextColor,
  OVERLAY_CASING_EXTRA_PX,
  resolveZoneVisual,
} from './scene-visuals'
import { getRectangularZoneCorners } from './zone-geometry'

const ZONE_STROKE_PX = 2

export interface InspectionLensDrawOptions {
  readonly widthPx: number
  readonly heightPx: number
  readonly dpr?: number
}

/**
 * Paints the inspection lens preview: Zones and Plant Symbols of a lens
 * snapshot on a Canvas2D context. This is renderer-neutral preview output
 * (ADR 0004), not a scene renderer; it never mounts on the workspace.
 */
export function drawInspectionLensScene(
  ctx: CanvasRenderingContext2D,
  snapshot: SceneRendererSnapshot,
  options: InspectionLensDrawOptions,
): void {
  const dpr = Math.max(options.dpr ?? 1, 1)
  const widthPx = Math.max(1, options.widthPx)
  const heightPx = Math.max(1, options.heightPx)

  applyScreenSpaceTransform(ctx, dpr)
  ctx.clearRect(0, 0, widthPx, heightPx)
  applyViewport(ctx, snapshot.viewport)
  drawZones(ctx, snapshot)
  drawPlants(ctx, snapshot, dpr, widthPx, heightPx)
}

function drawZones(ctx: CanvasRenderingContext2D, snapshot: SceneRendererSnapshot): void {
  const layer = getSceneLayerStyle(snapshot.scene, 'zones')
  if (!layer.visible) return

  for (const zone of snapshot.scene.zones) {
    const visual = resolveZoneVisual(zone)
    ctx.beginPath()
    traceZonePath(ctx, zone)
    ctx.fillStyle = visual.fill
    ctx.globalAlpha = 0.2 * layer.opacity
    if (zone.zoneType !== 'line') ctx.fill()
    ctx.globalAlpha = layer.opacity
    ctx.strokeStyle = visual.casing
    ctx.lineWidth = (ZONE_STROKE_PX + OVERLAY_CASING_EXTRA_PX) / snapshot.viewport.scale
    ctx.stroke()
    ctx.strokeStyle = visual.stroke
    ctx.lineWidth = ZONE_STROKE_PX / snapshot.viewport.scale
    ctx.stroke()
  }

  ctx.globalAlpha = 1
}

function traceZonePath(ctx: CanvasRenderingContext2D, zone: SceneZoneEntity): void {
  if (zone.zoneType === 'rect' && zone.points.length >= 4) {
    if (Math.abs(zone.rotationDeg) > 0.000001) {
      const corners = getRectangularZoneCorners(zone)
      if (corners) traceClosedPath(ctx, corners)
      return
    }

    const start = zone.points[0]!
    const end = zone.points[2]!
    ctx.rect(start.x, start.y, end.x - start.x, end.y - start.y)
    return
  }

  if (zone.zoneType === 'ellipse' && zone.points.length >= 2) {
    const center = zone.points[0]!
    const radii = zone.points[1]!
    ctx.ellipse(
      center.x,
      center.y,
      Math.abs(radii.x),
      Math.abs(radii.y),
      (zone.rotationDeg * Math.PI) / 180,
      0,
      Math.PI * 2,
    )
    return
  }

  const first = zone.points[0]
  if (!first) return
  ctx.moveTo(first.x, first.y)
  for (let i = 1; i < zone.points.length; i += 1) {
    const point = zone.points[i]!
    ctx.lineTo(point.x, point.y)
  }
  if (zone.zoneType !== 'line') ctx.closePath()
}

function traceClosedPath(ctx: CanvasRenderingContext2D, points: readonly { x: number; y: number }[]): void {
  const first = points[0]
  if (!first) return
  ctx.moveTo(first.x, first.y)
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]!
    ctx.lineTo(point.x, point.y)
  }
  ctx.closePath()
}

function drawPlants(
  ctx: CanvasRenderingContext2D,
  snapshot: SceneRendererSnapshot,
  dpr: number,
  widthPx: number,
  heightPx: number,
): void {
  const layer = getSceneLayerStyle(snapshot.scene, 'plants')
  if (!layer.visible) return

  // Symbolic footprints are bounded in CSS pixels; include rings and stack badges.
  const margin = 32
  const visiblePlants = snapshot.scene.plants.filter((plant) => {
    const x = plant.position.x * snapshot.viewport.scale + snapshot.viewport.x
    const y = plant.position.y * snapshot.viewport.scale + snapshot.viewport.y
    return x >= -margin && y >= -margin && x <= widthPx + margin && y <= heightPx + margin
  })
  const entries = buildPlantPresentationEntries(visiblePlants, {
    plants: snapshot.scene.plants,
    viewport: snapshot.viewport,
    speciesCache: snapshot.speciesCache,
    plantSpeciesSymbols: snapshot.scene.plantSpeciesSymbols,
    localizedCommonNames: snapshot.localizedCommonNames,
  }, new Set())
  const layout = layoutPlantPresentation(entries, snapshot.viewport.scale)
  const hoverTarget = snapshot.hoverTarget
  const hoveredPlantId = hoverTarget?.kind === 'plant' ? hoverTarget.id : null

  for (const entry of entries) {
    drawPlantSymbolGlyph(ctx, entry, layer.opacity, snapshot.viewport.scale)

    if (hoverTarget && entry.plant.id === hoveredPlantId) {
      const ring = getCanvasInteractionStrokeVisual(hoverTarget.state)
      ctx.beginPath()
      ctx.arc(entry.plant.position.x, entry.plant.position.y, entry.radiusWorld * 1.4, 0, Math.PI * 2)
      ctx.globalAlpha = ring.alpha * layer.opacity
      ctx.strokeStyle = ring.casingColor
      ctx.lineWidth = ring.casingWidthPx / snapshot.viewport.scale
      ctx.stroke()
      ctx.strokeStyle = ring.color
      ctx.lineWidth = ring.widthPx / snapshot.viewport.scale
      ctx.stroke()
    }

    const stackCount = layout.stackCounts.get(entry.plant.id)
    if (stackCount) drawStackBadge(ctx, entry, stackCount, layer.opacity, dpr)
  }

  ctx.globalAlpha = 1
}

function drawPlantSymbolGlyph(
  ctx: CanvasRenderingContext2D,
  entry: PlantPresentationEntry,
  opacity: number,
  viewportScale: number,
): void {
  const symbol = entry.lod === 'dot' || entry.usesCanopyRadius ? 'round' : entry.symbol
  const { x, y } = entry.plant.position
  const r = entry.radiusWorld
  ctx.globalAlpha = opacity
  ctx.fillStyle = entry.color
  if (entry.lod === 'dot' || symbol === 'round') {
    ctx.beginPath()
    ctx.arc(x, y, entry.lod === 'dot' ? r : r * ROUND_PLANT_SYMBOL_RADIUS, 0, Math.PI * 2)
    ctx.fill()
    if (entry.lod !== 'dot') {
      ctx.strokeStyle = getPlantSymbolEdgeColor(entry.color)
      ctx.lineWidth = getPlantSymbolEdgeWidth(entry.radiusScreenPx * 2) / viewportScale
      ctx.stroke()
    }
    return
  }
  ctx.strokeStyle = getPlantSymbolEdgeColor(entry.color)
  ctx.lineWidth = getPlantSymbolEdgeWidth(entry.radiusScreenPx * 2) / viewportScale
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const shape of getPlantSymbolShapes(symbol, entry.radiusScreenPx * 2)) {
    ctx.beginPath()
    tracePlantSymbolContour(ctx, shape.outline, x, y, r)
    ctx.stroke()
    for (const hole of shape.holes ?? []) tracePlantSymbolContour(ctx, hole, x, y, r)
    ctx.fill()
  }
}

function drawStackBadge(
  ctx: CanvasRenderingContext2D,
  entry: PlantPresentationEntry,
  count: number,
  opacity: number,
  dpr: number,
): void {
  ctx.save()
  applyScreenSpaceTransform(ctx, dpr)
  const offset = getStackBadgeOffsetPx(entry.radiusScreenPx)
  const x = entry.screenPoint.x + offset.x
  const y = entry.screenPoint.y + offset.y
  ctx.globalAlpha = opacity
  ctx.fillStyle = getStackBadgeBackgroundColor()
  ctx.beginPath()
  ctx.arc(x, y, STACK_BADGE_RADIUS_PX, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = getStackBadgeTextColor()
  ctx.font = `9px ${CANVAS_CHROME_FONT_FAMILY}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(count), x, y)
  ctx.restore()
}

function applyViewport(ctx: CanvasRenderingContext2D, viewport: SceneViewportState): void {
  const current = ctx.getTransform()
  ctx.setTransform(current.a, current.b, current.c, current.d, 0, 0)
  ctx.translate(viewport.x, viewport.y)
  ctx.scale(viewport.scale, viewport.scale)
}

function applyScreenSpaceTransform(ctx: CanvasRenderingContext2D, dpr: number): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}
