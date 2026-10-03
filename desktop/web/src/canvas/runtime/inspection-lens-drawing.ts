import { CANVAS_CHROME_FONT_FAMILY } from '../chrome-fonts'
import {
  buildPlantPresentationEntries,
  getStackBadgeOffsetPx,
  layoutPlantPresentation,
  STACK_BADGE_FONT_SIZE_PX,
  getStackBadgeSizePx,
  type PlantPresentationEntry,
} from './plant-presentation'
import {
  getPlantSymbolArt,
  ROUND_PLANT_SYMBOL_RADIUS,
  tracePlantSymbolContours,
} from './plant-symbol-recipes'
import type { SceneRendererSnapshot } from './renderers/scene-types'
import type { SceneZoneEntity } from './scene'
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
import type { ViewTransform } from './view/types'
import { getRectangularZoneCorners } from './zone-geometry'
import { getCanvasColor } from '../theme-refresh'

const ZONE_STROKE_PX = 2

/** The lens preview sits on the themed paper (`--canvas-bg`), not on the map. */
function lensPaper(): string {
  return getCanvasColor('background')
}

export interface InspectionLensDrawOptions {
  readonly widthPx: number
  readonly heightPx: number
  readonly dpr?: number
  /**
   * An offscreen context of the given backing size, for a translucent Plants layer: its symbols and hover ring are
   * drawn opaque there and composited once, so overlaps are no darker than one plant. Null draws them per shape.
   */
  scratch(widthPx: number, heightPx: number): CanvasRenderingContext2D | null
}

/**
 * Paints the inspection lens preview: Zones and Plant Symbols of a lens
 * snapshot on a Canvas2D context, through the lens's own view. This is
 * renderer-neutral preview output (ADR 0004), not a scene renderer; it never
 * mounts on the workspace.
 */
export function drawInspectionLensScene(
  ctx: CanvasRenderingContext2D,
  snapshot: SceneRendererSnapshot,
  view: ViewTransform,
  options: InspectionLensDrawOptions,
): void {
  const dpr = Math.max(options.dpr ?? 1, 1)
  const widthPx = Math.max(1, options.widthPx)
  const heightPx = Math.max(1, options.heightPx)

  applyScreenSpaceTransform(ctx, dpr)
  ctx.clearRect(0, 0, widthPx, heightPx)
  applyView(ctx, view)
  drawZones(ctx, snapshot, view.pixelsPerMetre)
  drawPlants(ctx, snapshot, view, dpr, widthPx, heightPx, options.scratch)
}

function drawZones(ctx: CanvasRenderingContext2D, snapshot: SceneRendererSnapshot, pixelsPerMetre: number): void {
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
    ctx.lineWidth = (ZONE_STROKE_PX + OVERLAY_CASING_EXTRA_PX) / pixelsPerMetre
    ctx.stroke()
    ctx.strokeStyle = visual.stroke
    ctx.lineWidth = ZONE_STROKE_PX / pixelsPerMetre
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
  view: ViewTransform,
  dpr: number,
  widthPx: number,
  heightPx: number,
  createScratch: InspectionLensDrawOptions['scratch'],
): void {
  const layer = getSceneLayerStyle(snapshot.scene, 'plants')
  if (!layer.visible) return
  // The Plants opacity applies once to the layer, as on the map: opaque symbols on a scratch, one drawImage at it.
  const backingWidth = Math.round(widthPx * dpr), backingHeight = Math.round(heightPx * dpr)
  const scratch = layer.opacity < 1 ? createScratch(backingWidth, backingHeight) : null
  const target = scratch ?? ctx
  const symbolOpacity = scratch ? 1 : layer.opacity
  if (scratch) {
    applyScreenSpaceTransform(scratch, dpr)
    scratch.clearRect(0, 0, widthPx, heightPx)
    applyView(scratch, view)
  }

  // Symbolic footprints are bounded in CSS pixels; include rings and stack badges.
  const margin = 32
  const scale = view.pixelsPerMetre
  const visiblePlants = snapshot.scene.plants.filter((plant) => {
    const { x, y } = view.worldToScreen(plant.position)
    return x >= -margin && y >= -margin && x <= widthPx + margin && y <= heightPx + margin
  })
  const entries = buildPlantPresentationEntries(visiblePlants, {
    plants: snapshot.scene.plants,
    pixelsPerMetre: scale,
    speciesCache: snapshot.speciesCache,
    plantSpeciesSymbols: snapshot.scene.plantSpeciesSymbols,
    localizedCommonNames: snapshot.localizedCommonNames,
  }, new Set())
  const layout = layoutPlantPresentation(entries, scale)
  const hoverTarget = snapshot.hoverTarget
  const hoveredPlantId = hoverTarget?.kind === 'plant' ? hoverTarget.id : null
  // Plant glyphs are side-view pictograms: on a lens turned with the map they stay upright on screen (spec §4.8, §4.13).
  const uprightRad = (view.camera.bearingDeg * Math.PI) / 180

  for (const entry of entries) {
    const turned = uprightRad !== 0
    if (turned) {
      // Undo the view's turn about the plant: the glyph is drawn level at worldToScreen(position), still in metres.
      const { x, y } = entry.plant.position
      target.save()
      target.translate(x, y)
      target.rotate(uprightRad)
      target.translate(-x, -y)
    }
    drawPlantSymbolGlyph(target, entry, symbolOpacity, scale)

    if (hoverTarget && entry.plant.id === hoveredPlantId) {
      const ring = getCanvasInteractionStrokeVisual(hoverTarget.state)
      target.beginPath()
      target.arc(entry.plant.position.x, entry.plant.position.y, entry.radiusWorld * 1.4, 0, Math.PI * 2)
      target.globalAlpha = ring.alpha * symbolOpacity
      target.strokeStyle = ring.casingColor
      target.lineWidth = ring.casingWidthPx / scale
      target.stroke()
      target.strokeStyle = ring.color
      target.lineWidth = ring.widthPx / scale
      target.stroke()
    }
    if (turned) target.restore()
  }

  if (scratch) {
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = layer.opacity
    ctx.drawImage(scratch.canvas, 0, 0)
    ctx.restore()
  }
  // Stack badges stay per shape, above every symbol.
  for (const entry of entries) {
    const stackCount = layout.stackCounts.get(entry.plant.id)
    if (stackCount) drawStackBadge(ctx, entry, view.worldToScreen(entry.plant.position), stackCount, layer.opacity, dpr)
  }

  target.globalAlpha = 1
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
    const edgeWidth = getPlantSymbolEdgeWidth(entry.radiusScreenPx * 2)
    if (entry.lod !== 'dot' && edgeWidth > 0) {
      ctx.strokeStyle = getPlantSymbolEdgeColor(entry.color, lensPaper())
      ctx.lineWidth = edgeWidth / viewportScale
      ctx.stroke()
    }
    return
  }
  const edge = getPlantSymbolEdgeColor(entry.color, lensPaper())
  const art = getPlantSymbolArt(symbol, entry.radiusScreenPx * 2)
  const edgeWidth = getPlantSymbolEdgeWidth(entry.radiusScreenPx * 2)
  ctx.strokeStyle = edge
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  tracePlantSymbolContours(ctx, art.body, x, y, r)
  // A zero line width is ignored by Canvas2D, so Outline off skips the stroke.
  if (edgeWidth > 0) {
    ctx.lineWidth = edgeWidth / viewportScale
    ctx.stroke()
  }
  ctx.fill('nonzero')
  if (art.cutouts.length === 0) return
  ctx.fillStyle = edge
  ctx.beginPath()
  tracePlantSymbolContours(ctx, art.cutouts, x, y, r)
  ctx.fill('nonzero')
}

function drawStackBadge(
  ctx: CanvasRenderingContext2D,
  entry: PlantPresentationEntry,
  at: { readonly x: number; readonly y: number },
  count: number,
  opacity: number,
  dpr: number,
): void {
  ctx.save()
  applyScreenSpaceTransform(ctx, dpr)
  const offset = getStackBadgeOffsetPx(entry.radiusScreenPx)
  const x = at.x + offset.x
  const y = at.y + offset.y
  ctx.globalAlpha = opacity
  ctx.fillStyle = getStackBadgeBackgroundColor(lensPaper())
  const size = getStackBadgeSizePx(String(count))
  ctx.beginPath()
  ctx.roundRect(x - size.width / 2, y - size.height / 2, size.width, size.height, size.height / 2)
  ctx.fill()
  ctx.fillStyle = getStackBadgeTextColor(lensPaper())
  ctx.font = `${STACK_BADGE_FONT_SIZE_PX}px ${CANVAS_CHROME_FONT_FAMILY}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(count), x, y)
  ctx.restore()
}

/** World metres to the backing store: the device-pixel scale already set, then the view's affine. */
function applyView(ctx: CanvasRenderingContext2D, view: ViewTransform): void {
  const { affine } = view.planar
  const current = ctx.getTransform()
  ctx.setTransform(current.a, current.b, current.c, current.d, 0, 0)
  ctx.transform(affine[0], affine[1], affine[2], affine[3], affine[4], affine[5])
}

function applyScreenSpaceTransform(ctx: CanvasRenderingContext2D, dpr: number): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}
