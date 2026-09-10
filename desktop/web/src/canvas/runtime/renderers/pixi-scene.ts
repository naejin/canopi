import { speciesFocusOpacity } from '../species-key'
import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js'
import {
  getAnnotationVisualWorldCorners,
  getAnnotationPresentation,
  worldToScreen,
} from '../annotation-layout'
import {
  createMeasurementGuidePresentation,
  MEASUREMENT_GUIDE_DASH_PX,
  MEASUREMENT_GUIDE_GAP_PX,
  MEASUREMENT_GUIDE_LABEL_FONT_SIZE_PX,
  MEASUREMENT_GUIDE_TICK_HALF_PX,
} from '../measurement-guides'
import {
  buildPlantPresentationEntries,
  getStackBadgeOffsetPx,
  layoutPlantPresentation,
  STACK_BADGE_RADIUS_PX,
  type PlantPresentationEntry,
} from '../plant-presentation'
import {
  getPlantSymbolShapes,
  ROUND_PLANT_SYMBOL_RADIUS,
  tracePlantSymbolContour,
} from '../plant-symbol-recipes'
import { computePinnedPlantNameLabels, computeSelectionLabels } from '../selection-labels'
import { getCanvasDetailLayout, getCanvasPlantNameLabels, isMeasurementLabelVisible } from '../automatic-detail'
import {
  getAnnotationTextColor,
  getCanvasInteractionStrokeVisual,
  getPlantSymbolEdgeColor,
  getPlantSymbolEdgeWidth,
  getPlantLabelColor,
  getSceneLayerStyle,
  getStackBadgeBackgroundColor,
  getStackBadgeTextColor,
  resolveZoneVisual,
  type CanvasInteractionVisualState,
} from '../scene-visuals'
import type { SceneRendererDefinition, SceneRendererHoverState, SceneRendererInstance, SceneRendererSnapshot } from './scene-types'
import { getEllipticalZonePolygon, getRectangularZoneCorners } from '../zone-geometry'
import type { PlantSymbolId, SceneAnnotationEntity, SceneMeasurementGuideEntity, ScenePoint, SceneZoneEntity } from '../scene'
import { isSceneObjectGroupMemberTarget } from '../scene'

const BACKGROUND_COLOR = 0x000000
const ZONE_STROKE_PX = 2
const PLANT_STROKE_PX = 1.5

export function createPixiSceneRenderer(): SceneRendererDefinition {
  return {
    id: 'pixi',
    supports(capabilities) {
      return capabilities.webgl || capabilities.webgl2
    },
    async initialize(context, backendContext) {
      const app = new Application()
      const resolution = Math.max(1, backendContext.capabilities.devicePixelRatio ?? 1)
      // Textures need extra samples to retain glyph edges at fractional screen
      // positions. Keep this text-only density independent of camera zoom.
      const createText = () => new Text({ resolution: resolution * 2 })
      await app.init({
        width: Math.max(1, context.container.clientWidth),
        height: Math.max(1, context.container.clientHeight),
        antialias: true,
        resolution,
        autoDensity: true,
        autoStart: false,
        backgroundAlpha: 0,
        clearBeforeRender: true,
        backgroundColor: BACKGROUND_COLOR,
        preference: 'webgl',
      })

      const canvas = app.canvas as HTMLCanvasElement
      canvas.style.position = 'absolute'
      canvas.style.inset = '0'
      canvas.style.width = '100%'
      canvas.style.height = '100%'
      canvas.style.background = 'transparent'
      canvas.style.zIndex = '1'
      context.container.appendChild(canvas)

      const world = new Container()
      const zonesLayer = new Container()
      const measurementGuideLayer = new Container()
      const plantsLayer = new Container()
      const plantsOverlayLayer = new Container()
      const annotationTextLayer = new Container()
      const annotationHighlightLayer = new Container()
      world.addChild(zonesLayer)
      world.addChild(measurementGuideLayer)
      // Rasterize text and tessellate symbols at their readable CSS-pixel size.
      // Tiny world-unit primitives lose detail before the camera enlarges them.
      const screen = new Container()
      screen.addChild(plantsLayer)
      screen.addChild(plantsOverlayLayer)
      screen.addChild(annotationTextLayer)
      screen.addChild(annotationHighlightLayer)
      const measurementGuideLabelLayer = new Container()
      const pinnedPlantNameLabelLayer = new Container()
      const selectionLabelLayer = new Container()
      app.stage.addChild(world)
      app.stage.addChild(screen)
      app.stage.addChild(measurementGuideLabelLayer)
      app.stage.addChild(pinnedPlantNameLabelLayer)
      app.stage.addChild(selectionLabelLayer)

      let snapshot: SceneRendererSnapshot | null = null
      const zoneGraphicsByName = new Map<string, Graphics>()
      const measurementGuideGraphicsById = new Map<string, Graphics>()
      const measurementGuideLabelById = new Map<string, Text>()
      const plantGraphicsById = new Map<string, Graphics>()
      const plantBadgeGraphicsById = new Map<string, Graphics>()
      const plantBadgeTextById = new Map<string, Text>()
      const annotationTextById = new Map<string, Text>()
      const annotationHighlightById = new Map<string, Graphics>()
      const pinnedPlantNameLabelById = new Map<string, Text>()
      const selectionLabelBySpecies = new Map<string, Text>()

      const instance: SceneRendererInstance = {
        id: 'pixi',
        dispose() {
          app.destroy({ removeView: false })
          canvas.remove()
        },
        resize(width, height) {
          app.renderer.resize(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)))
          if (snapshot) {
            world.position.set(snapshot.viewport.x, snapshot.viewport.y)
            world.scale.set(snapshot.viewport.scale)
            app.render()
          }
        },
        renderScene(nextSnapshot) {
          snapshot = nextSnapshot
          syncZones(zonesLayer, zoneGraphicsByName, nextSnapshot, true)
          syncMeasurementGuides(
            createText,
            measurementGuideLayer,
            measurementGuideLabelLayer,
            measurementGuideGraphicsById,
            measurementGuideLabelById,
            nextSnapshot,
            true,
          )
          syncPlants(
            createText,
            plantsLayer,
            plantsOverlayLayer,
            plantGraphicsById,
            plantBadgeGraphicsById,
            plantBadgeTextById,
            nextSnapshot,
            true,
          )
          syncAnnotations(
            createText,
            annotationTextLayer,
            annotationHighlightLayer,
            annotationTextById,
            annotationHighlightById,
            nextSnapshot,
            true,
          )
          syncPinnedPlantNameLabels(createText, pinnedPlantNameLabelLayer, pinnedPlantNameLabelById, nextSnapshot)
          syncSelectionLabels(createText, selectionLabelLayer, selectionLabelBySpecies, nextSnapshot)
          world.position.set(nextSnapshot.viewport.x, nextSnapshot.viewport.y)
          world.scale.set(nextSnapshot.viewport.scale)
          app.render()
        },
        setViewport(viewport) {
          if (!snapshot) return
          const labels = computeSelectionLabels(
            snapshot.scene.plants,
            snapshot.selectionLabelPlantIds,
            viewport,
            snapshot.localizedCommonNames,
            {
              plantContext: {
                viewport,
                speciesCache: snapshot.speciesCache,
                localizedCommonNames: snapshot.localizedCommonNames,
              },
            },
          )
          const pinnedPlantNameLabels = computePinnedPlantNameLabels(
            snapshot.scene.plants,
            viewport,
            snapshot.localizedCommonNames,
            {
              selectionLabelPlantIds: snapshot.selectionLabelPlantIds,
              plantContext: {
                viewport,
                speciesCache: snapshot.speciesCache,
                localizedCommonNames: snapshot.localizedCommonNames,
              },
            },
          )
          snapshot = { ...snapshot, viewport, pinnedPlantNameLabels, selectionLabels: labels }
          syncZones(zonesLayer, zoneGraphicsByName, snapshot, false)
          syncMeasurementGuides(
            createText,
            measurementGuideLayer,
            measurementGuideLabelLayer,
            measurementGuideGraphicsById,
            measurementGuideLabelById,
            snapshot,
            false,
          )
          syncPlants(
            createText,
            plantsLayer,
            plantsOverlayLayer,
            plantGraphicsById,
            plantBadgeGraphicsById,
            plantBadgeTextById,
            snapshot,
            false,
          )
          syncAnnotations(
            createText,
            annotationTextLayer,
            annotationHighlightLayer,
            annotationTextById,
            annotationHighlightById,
            snapshot,
            false,
          )
          syncPinnedPlantNameLabels(createText, pinnedPlantNameLabelLayer, pinnedPlantNameLabelById, snapshot)
          syncSelectionLabels(createText, selectionLabelLayer, selectionLabelBySpecies, snapshot)
          world.position.set(viewport.x, viewport.y)
          world.scale.set(viewport.scale)
          app.render()
        },
      }

      return instance
    },
  }
}

function syncMeasurementGuides(
  createText: () => Text,
  worldLayer: Container,
  labelLayer: Container,
  graphicsById: Map<string, Graphics>,
  labelById: Map<string, Text>,
  snapshot: SceneRendererSnapshot,
  reconcileRemoved: boolean,
): void {
  const layer = getSceneLayerStyle(snapshot.scene, 'measurement-guides')
  worldLayer.visible = layer.visible
  worldLayer.alpha = layer.opacity
  labelLayer.visible = layer.visible
  labelLayer.alpha = layer.opacity
  if (!layer.visible) return

  const nextIds = new Set<string>()
  for (const guide of snapshot.scene.measurementGuides) {
    const presentation = createMeasurementGuidePresentation(guide, snapshot.viewport)
    if (!presentation) continue

    nextIds.add(guide.id)
    let graphics = graphicsById.get(guide.id)
    if (!graphics) {
      graphics = new Graphics()
      graphicsById.set(guide.id, graphics)
      worldLayer.addChild(graphics)
    }
    drawMeasurementGuide(
      graphics,
      guide,
      snapshot.selectedMeasurementGuideIds.has(guide.id),
      hoverStateForTarget(snapshot, 'measurement-guide', guide.id),
      snapshot.viewport.scale,
    )
    graphics.visible = true

    let text = labelById.get(guide.id)
    if (!text) {
      text = createText()
      labelById.set(guide.id, text)
      labelLayer.addChild(text)
    }
    text.text = presentation.text
    const interactionState = resolveInteractionState(
      snapshot.selectedMeasurementGuideIds.has(guide.id),
      false,
      hoverStateForTarget(snapshot, 'measurement-guide', guide.id),
    )
    const interactionVisual = interactionState ? getCanvasInteractionStrokeVisual(interactionState) : null
    text.style = new TextStyle({
      fontFamily: 'Inter, sans-serif',
      fontSize: MEASUREMENT_GUIDE_LABEL_FONT_SIZE_PX,
      fill: toPixiColor(interactionVisual?.color ?? getAnnotationTextColor(), 0),
    })
    text.position.set(presentation.labelScreenPoint.x, presentation.labelScreenPoint.y)
    text.rotation = presentation.labelRotationRad
    text.anchor.set(0.5, 0.5)
    text.visible = isMeasurementLabelVisible(snapshot, guide.id)
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
  for (const [guideId, text] of labelById) {
    if (nextIds.has(guideId)) continue
    if (reconcileRemoved) {
      text.removeFromParent()
      text.destroy()
      labelById.delete(guideId)
    } else {
      text.visible = false
    }
  }
}

function drawMeasurementGuide(
  graphics: Graphics,
  guide: SceneMeasurementGuideEntity,
  selected: boolean,
  hoverState: SceneRendererHoverState | null,
  viewportScale: number,
): void {
  const presentation = createMeasurementGuidePresentation(guide, { x: 0, y: 0, scale: viewportScale })
  if (!presentation) return

  const interactionState = resolveInteractionState(selected, false, hoverState)
  const interactionVisual = interactionState ? getCanvasInteractionStrokeVisual(interactionState) : null
  const color = toPixiColor(interactionVisual?.color ?? getAnnotationTextColor(), 0)
  const strokeWidth = screenPxToWorldPx(interactionVisual?.widthPx ?? .8, viewportScale)
  const strokeAlpha = (interactionVisual?.alpha ?? .25) * cssColorAlpha(interactionVisual?.color ?? getAnnotationTextColor())
  graphics.clear()
  drawDashedMeasurementGuideLine(
    graphics,
    guide.start,
    guide.end,
    screenPxToWorldPx(MEASUREMENT_GUIDE_DASH_PX, viewportScale),
    screenPxToWorldPx(MEASUREMENT_GUIDE_GAP_PX, viewportScale),
  )
  drawMeasurementGuideTick(
    graphics,
    guide.start,
    presentation.normalWorld,
    screenPxToWorldPx(MEASUREMENT_GUIDE_TICK_HALF_PX, viewportScale),
  )
  drawMeasurementGuideTick(
    graphics,
    guide.end,
    presentation.normalWorld,
    screenPxToWorldPx(MEASUREMENT_GUIDE_TICK_HALF_PX, viewportScale),
  )
  graphics.stroke({ color, width: strokeWidth, alpha: strokeAlpha })
}

function drawDashedMeasurementGuideLine(
  graphics: Graphics,
  start: ScenePoint,
  end: ScenePoint,
  dashLength: number,
  gapLength: number,
): void {
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

function drawMeasurementGuideTick(
  graphics: Graphics,
  point: ScenePoint,
  normal: ScenePoint,
  halfLength: number,
): void {
  graphics.moveTo(point.x - normal.x * halfLength, point.y - normal.y * halfLength)
    .lineTo(point.x + normal.x * halfLength, point.y + normal.y * halfLength)
}

function syncZones(
  world: Container,
  zoneGraphicsByName: Map<string, Graphics>,
  snapshot: SceneRendererSnapshot,
  reconcileRemoved: boolean,
): void {
  const layer = getSceneLayerStyle(snapshot.scene, 'zones')
  world.visible = layer.visible
  world.alpha = layer.opacity
  if (!layer.visible) return

  const nextZoneNames = new Set<string>()
  for (const zone of snapshot.scene.zones) {
    nextZoneNames.add(zone.name)
    const graphics = zoneGraphicsByName.get(zone.name) ?? new Graphics()
    if (!zoneGraphicsByName.has(zone.name)) {
      zoneGraphicsByName.set(zone.name, graphics)
      world.addChild(graphics)
    }
    drawZone(
      graphics,
      zone,
      snapshot.selectedZoneIds.has(zone.name),
      snapshot.highlightedZoneIds.has(zone.name),
      hoverStateForTarget(snapshot, 'zone', zone.name),
      snapshot.viewport.scale,
    )
    graphics.visible = true
  }

  if (!reconcileRemoved) return
  for (const [zoneName, graphics] of zoneGraphicsByName) {
    if (nextZoneNames.has(zoneName)) continue
    graphics.removeFromParent()
    graphics.destroy()
    zoneGraphicsByName.delete(zoneName)
  }
}

function drawZone(
  graphics: Graphics,
  zone: SceneZoneEntity,
  selected: boolean,
  highlighted: boolean,
  hoverState: SceneRendererHoverState | null,
  viewportScale: number,
): void {
  const visual = resolveZoneVisual(zone)
  const fillColor = toPixiColor(visual.fill, 0)
  const fillAlpha = 0.2 * cssColorAlpha(visual.fill)
  const interactionState = resolveInteractionState(selected, highlighted, hoverState)
  const interactionVisual = interactionState ? getCanvasInteractionStrokeVisual(interactionState) : null
  const strokeColor = toPixiColor(interactionVisual?.color ?? visual.stroke, 0)
  const strokeWidth = screenPxToWorldPx(
    interactionVisual?.widthPx ?? ZONE_STROKE_PX,
    viewportScale,
  )
  const strokeAlpha = (interactionVisual?.alpha ?? 1) * cssColorAlpha(interactionVisual?.color ?? visual.stroke)

  graphics.clear()

  if (zone.zoneType === 'rect' && zone.points.length >= 4) {
    if (Math.abs(zone.rotationDeg) > 0.000001) {
      const corners = getRectangularZoneCorners(zone)
      if (!corners) return
      drawClosedZonePath(graphics, corners)
        .fill({ color: fillColor, alpha: fillAlpha })
        .stroke({ color: strokeColor, width: strokeWidth, alpha: strokeAlpha })
      return
    }

    const start = zone.points[0]!
    const end = zone.points[2]!
    graphics.rect(start.x, start.y, end.x - start.x, end.y - start.y)
      .fill({ color: fillColor, alpha: fillAlpha })
      .stroke({ color: strokeColor, width: strokeWidth, alpha: strokeAlpha })
    return
  }

  if (zone.zoneType === 'ellipse' && zone.points.length >= 2) {
    if (Math.abs(zone.rotationDeg) > 0.000001) {
      const polygon = getEllipticalZonePolygon(zone)
      if (!polygon) return
      drawClosedZonePath(graphics, polygon)
        .fill({ color: fillColor, alpha: fillAlpha })
        .stroke({ color: strokeColor, width: strokeWidth, alpha: strokeAlpha })
      return
    }

    const center = zone.points[0]!
    const radii = zone.points[1]!
    graphics.ellipse(center.x, center.y, radii.x, radii.y)
      .fill({ color: fillColor, alpha: fillAlpha })
      .stroke({ color: strokeColor, width: strokeWidth, alpha: strokeAlpha })
    return
  }

  if (zone.points.length < 2) return

  const first = zone.points[0]!
  graphics.moveTo(first.x, first.y)
  for (let i = 1; i < zone.points.length; i += 1) {
    const point = zone.points[i]!
    graphics.lineTo(point.x, point.y)
  }

  if (zone.zoneType !== 'line') {
    graphics.closePath().fill({ color: fillColor, alpha: fillAlpha })
  }

  graphics.stroke({ color: strokeColor, width: strokeWidth, alpha: strokeAlpha })
}

function drawClosedZonePath(graphics: Graphics, points: readonly { x: number; y: number }[]): Graphics {
  const first = points[0]
  if (!first) return graphics
  graphics.moveTo(first.x, first.y)
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]!
    graphics.lineTo(point.x, point.y)
  }
  return graphics.closePath()
}

function syncPlants(
  createText: () => Text,
  symbolLayer: Container,
  overlay: Container,
  plantGraphicsById: Map<string, Graphics>,
  plantBadgeGraphicsById: Map<string, Graphics>,
  plantBadgeTextById: Map<string, Text>,
  snapshot: SceneRendererSnapshot,
  reconcileRemoved: boolean,
): void {
  const layer = getSceneLayerStyle(snapshot.scene, 'plants')
  symbolLayer.visible = layer.visible
  symbolLayer.alpha = layer.opacity
  overlay.visible = layer.visible
  overlay.alpha = layer.opacity
  if (!layer.visible) return

  const entries = buildPlantPresentationEntries(snapshot.scene.plants, {
    viewport: snapshot.viewport,
    speciesCache: snapshot.speciesCache,
    plantSpeciesSymbols: snapshot.scene.plantSpeciesSymbols,
    localizedCommonNames: snapshot.localizedCommonNames,
  }, snapshot.selectedPlantIds)
  const layout = layoutPlantPresentation(entries, snapshot.viewport.scale)
  const nextIds = new Set(entries.map((entry) => entry.plant.id))

  for (const entry of entries) {
    const circle = plantGraphicsById.get(entry.plant.id) ?? new Graphics()
    if (!plantGraphicsById.has(entry.plant.id)) {
      plantGraphicsById.set(entry.plant.id, circle)
      symbolLayer.addChild(circle)
    }
    drawPlant(
      circle,
      entry,
      snapshot.hoveredCanonicalName,
      snapshot.highlightedPlantIds.has(entry.plant.id),
      hoverStateForTarget(snapshot, 'plant', entry.plant.id),
      speciesFocusOpacity(snapshot.speciesFocus, entry.plant.canonicalName),
    )
    circle.visible = true

    const stackCount = layout.stackCounts.get(entry.plant.id)
    if (stackCount) {
      const badge = plantBadgeGraphicsById.get(entry.plant.id) ?? new Graphics()
      if (!plantBadgeGraphicsById.has(entry.plant.id)) {
        plantBadgeGraphicsById.set(entry.plant.id, badge)
        overlay.addChild(badge)
      }
      drawStackBadge(badge, entry)
      badge.visible = true

      const badgeText = plantBadgeTextById.get(entry.plant.id) ?? createText()
      if (!plantBadgeTextById.has(entry.plant.id)) {
        plantBadgeTextById.set(entry.plant.id, badgeText)
        overlay.addChild(badgeText)
      }
      drawStackBadgeText(badgeText, entry, stackCount)
      badgeText.visible = true
    } else if (reconcileRemoved) {
      const badge = plantBadgeGraphicsById.get(entry.plant.id)
      if (badge) {
        badge.removeFromParent()
        badge.destroy()
      }
      plantBadgeGraphicsById.delete(entry.plant.id)
      const badgeText = plantBadgeTextById.get(entry.plant.id)
      if (badgeText) {
        badgeText.removeFromParent()
        badgeText.destroy()
      }
      plantBadgeTextById.delete(entry.plant.id)
    } else {
      const badge = plantBadgeGraphicsById.get(entry.plant.id)
      if (badge) badge.visible = false
      const badgeText = plantBadgeTextById.get(entry.plant.id)
      if (badgeText) badgeText.visible = false
    }
  }

  if (!reconcileRemoved) return
  for (const [plantId, graphics] of plantGraphicsById) {
    if (nextIds.has(plantId)) continue
    graphics.removeFromParent()
    graphics.destroy()
    plantGraphicsById.delete(plantId)
  }
  for (const [plantId, badge] of plantBadgeGraphicsById) {
    if (nextIds.has(plantId)) continue
    badge.removeFromParent()
    badge.destroy()
    plantBadgeGraphicsById.delete(plantId)
  }
  for (const [plantId, badgeText] of plantBadgeTextById) {
    if (nextIds.has(plantId)) continue
    badgeText.removeFromParent()
    badgeText.destroy()
    plantBadgeTextById.delete(plantId)
  }
}

function drawPlant(
  graphics: Graphics,
  entry: PlantPresentationEntry,
  hoveredCanonicalName: string | null,
  highlighted: boolean,
  hoverState: SceneRendererHoverState | null,
  glyphOpacity: number,
): void {
  const color = toPixiColor(entry.color, 0)
  const selected = entry.selected
  const sameSpeciesHover = Boolean(hoveredCanonicalName && entry.plant.canonicalName === hoveredCanonicalName)
  const interactionState = resolveInteractionState(selected, highlighted || sameSpeciesHover, hoverState)
  const interactionVisual = interactionState ? getCanvasInteractionStrokeVisual(interactionState) : null
  const x = entry.screenPoint.x
  const y = entry.screenPoint.y
  const r = entry.radiusScreenPx
  const renderedSymbol = resolveRenderedPlantSymbol(entry)
  const selectedStrokeColor = toPixiColor(interactionVisual?.color ?? entry.color, color)
  graphics.clear()
  drawPlantSymbolGlyph(graphics, renderedSymbol, entry, glyphOpacity)

  if (selected) {
    graphics.circle(x, y, r)
      .stroke({
        color: selectedStrokeColor,
        width: interactionVisual?.widthPx ?? PLANT_STROKE_PX,
        alpha: cssColorAlpha(interactionVisual?.color ?? entry.color),
      })
  }
  if (interactionState && !selected) {
    const ringVisual = getCanvasInteractionStrokeVisual(interactionState)
    graphics.circle(x, y, r * 1.4)
      .stroke({
        color: toPixiColor(ringVisual.color, 0),
        width: ringVisual.widthPx,
        alpha: ringVisual.alpha * cssColorAlpha(ringVisual.color),
      })
  }
}

function resolveRenderedPlantSymbol(entry: PlantPresentationEntry): PlantSymbolId {
  return entry.lod === 'dot' || entry.usesCanopyRadius ? 'round' : entry.symbol
}

function drawPlantSymbolGlyph(graphics: Graphics, symbol: PlantSymbolId, entry: PlantPresentationEntry, opacity: number): void {
  const { x, y } = entry.screenPoint
  const r = entry.radiusScreenPx
  const color = toPixiColor(entry.color, 0)
  if (entry.lod === 'dot' || symbol === 'round') {
    graphics.circle(x, y, entry.lod === 'dot' ? r : r * ROUND_PLANT_SYMBOL_RADIUS).fill({ color, alpha: opacity })
    if (entry.lod !== 'dot') graphics.stroke({ color: toPixiColor(getPlantSymbolEdgeColor(entry.color), 0), width: getPlantSymbolEdgeWidth(r * 2), alpha: opacity })
    return
  }
  const edge = toPixiColor(getPlantSymbolEdgeColor(entry.color), 0)
  const width = getPlantSymbolEdgeWidth(r * 2)
  for (const shape of getPlantSymbolShapes(symbol, r * 2)) {
    tracePlantSymbolContour(graphics, shape.outline, x, y, r)
    graphics.stroke({ color: edge, width, alpha: opacity, join: 'round', cap: 'round' }).fill({ color, alpha: opacity })
    for (const hole of shape.holes ?? []) {
      tracePlantSymbolContour(graphics, hole, x, y, r)
      graphics.cut()
    }
  }
}

function screenPxToWorldPx(px: number, viewportScale: number): number {
  return px / Math.max(viewportScale, 0.001)
}

function drawStackBadge(
  badge: Graphics,
  entry: ReturnType<typeof buildPlantPresentationEntries>[number],
): void {
  const offset = getStackBadgeOffsetPx(entry.radiusScreenPx)
  badge.clear()
  badge.circle(
    entry.screenPoint.x + offset.x,
    entry.screenPoint.y + offset.y,
    STACK_BADGE_RADIUS_PX,
  ).fill({ color: toPixiColor(getStackBadgeBackgroundColor(), 0), alpha: 1 })
}

function drawStackBadgeText(
  badgeText: Text,
  entry: ReturnType<typeof buildPlantPresentationEntries>[number],
  stackCount: number,
): void {
  const offset = getStackBadgeOffsetPx(entry.radiusScreenPx)
  badgeText.text = String(stackCount)
  badgeText.style = new TextStyle({
    fontFamily: 'Inter, sans-serif',
    fontSize: 9,
    fill: toPixiColor(getStackBadgeTextColor(), 0),
  })
  badgeText.position.set(
    entry.screenPoint.x + offset.x,
    entry.screenPoint.y + offset.y,
  )
  badgeText.anchor.set(0.5, 0.5)
}

function syncAnnotations(
  createText: () => Text,
  textLayer: Container,
  highlightLayer: Container,
  annotationTextById: Map<string, Text>,
  annotationHighlightById: Map<string, Graphics>,
  snapshot: SceneRendererSnapshot,
  reconcileRemoved: boolean,
): void {
  const layer = getSceneLayerStyle(snapshot.scene, 'annotations')
  textLayer.visible = layer.visible
  textLayer.alpha = layer.opacity
  highlightLayer.visible = layer.visible
  highlightLayer.alpha = layer.opacity
  if (!layer.visible) return

  const nextIds = new Set<string>()
  for (const annotation of snapshot.scene.annotations) {
    if (annotation.annotationType !== 'text') continue
    nextIds.add(annotation.id)
    const text = annotationTextById.get(annotation.id) ?? createText()
    if (!annotationTextById.has(annotation.id)) {
      annotationTextById.set(annotation.id, text)
      textLayer.addChild(text)
    }
    const revealText = annotation.id === snapshot.revealedAnnotationId
      || (snapshot.hoverTarget?.kind === 'annotation' && snapshot.hoverTarget.id === annotation.id)
    const textAllowed = getCanvasDetailLayout(snapshot.scene, snapshot.viewport.scale).annotationIds.has(annotation.id)
    const { textOpacity, markerOpacity } = getAnnotationPresentation(annotation, snapshot.viewport, revealText, textAllowed)
    drawAnnotationText(text, annotation, snapshot.viewport)
    text.alpha = textOpacity
    text.visible = textOpacity > 0

    const selected = snapshot.selectedAnnotationIds.has(annotation.id)
    const interactionState = resolveInteractionState(
      selected,
      false,
      hoverStateForTarget(snapshot, 'annotation', annotation.id),
    )
    const highlight = annotationHighlightById.get(annotation.id)
    if (interactionState || markerOpacity > 0) {
      const nextHighlight = highlight ?? new Graphics()
      if (!annotationHighlightById.has(annotation.id)) {
        annotationHighlightById.set(annotation.id, nextHighlight)
        highlightLayer.addChild(nextHighlight)
      }
      drawAnnotationDecoration(nextHighlight, annotation, snapshot.viewport, interactionState, revealText, textAllowed)
      nextHighlight.visible = true
    } else if (reconcileRemoved) {
      if (highlight) {
        highlight.removeFromParent()
        highlight.destroy()
      }
      annotationHighlightById.delete(annotation.id)
    } else if (highlight) {
      highlight.visible = false
    }
  }

  if (!reconcileRemoved) return
  for (const [annotationId, text] of annotationTextById) {
    if (nextIds.has(annotationId)) continue
    text.removeFromParent()
    text.destroy()
    annotationTextById.delete(annotationId)
  }
  for (const [annotationId, highlight] of annotationHighlightById) {
    if (nextIds.has(annotationId)) continue
    highlight.removeFromParent()
    highlight.destroy()
    annotationHighlightById.delete(annotationId)
  }
}

function drawAnnotationText(
  text: Text,
  annotation: SceneAnnotationEntity,
  viewport: SceneRendererSnapshot['viewport'],
): void {
  text.text = annotation.text
  text.style = new TextStyle({
    fontFamily: 'Inter, sans-serif',
    fontSize: annotation.fontSize,
    lineHeight: getAnnotationPresentation(annotation, viewport).textFrame.lineHeightPx,
    fill: getAnnotationTextColor(),
  })
  const origin = worldToScreen(annotation.position, viewport)
  text.position.set(origin.x, origin.y)
  text.rotation = ((annotation.rotationDeg ?? 0) * Math.PI) / 180
  text.anchor.set(0, 0)
}

function drawAnnotationDecoration(
  graphics: Graphics,
  annotation: SceneAnnotationEntity,
  viewport: SceneRendererSnapshot['viewport'],
  state: CanvasInteractionVisualState | null,
  revealText: boolean,
  textAllowed: boolean,
): void {
  const { markerOpacity, markerPaths, markerStrokePx } = getAnnotationPresentation(annotation, viewport, revealText, textAllowed)
  const origin = worldToScreen(annotation.position, viewport)
  graphics.clear()
  if (markerOpacity > 0) {
    for (const path of markerPaths) {
      path.forEach((point, index) => {
        const x = origin.x + point.x
        const y = origin.y + point.y
        if (index === 0) graphics.moveTo(x, y)
        else graphics.lineTo(x, y)
      })
    }
    graphics.stroke({ color: toPixiColor(getAnnotationTextColor(), 0),
      width: markerStrokePx, alpha: markerOpacity })
  }
  if (state) {
    const corners = getAnnotationVisualWorldCorners(annotation, viewport.scale, revealText, { x: 4, y: 2 }, textAllowed)
      .map((point) => worldToScreen(point, viewport))
    const visual = getCanvasInteractionStrokeVisual(state)
    drawClosedZonePath(graphics, corners).stroke({
      color: toPixiColor(visual.color, 0),
      width: visual.widthPx,
      alpha: visual.alpha * cssColorAlpha(visual.color),
    })
  }
}

function syncSelectionLabels(
  createText: () => Text,
  layer: Container,
  labelBySpecies: Map<string, Text>,
  snapshot: SceneRendererSnapshot,
): void {
  const nextSpecies = new Set(snapshot.selectionLabels.map((l) => l.canonicalName))

  for (const label of snapshot.selectionLabels) {
    let text = labelBySpecies.get(label.canonicalName)
    if (!text) {
      text = createText()
      labelBySpecies.set(label.canonicalName, text)
      layer.addChild(text)
    }
    text.text = label.text
    text.style = new TextStyle({
      fontFamily: 'Inter, sans-serif',
      fontSize: 12,
      fontWeight: '600',
      fontStyle: label.fontStyle,
      fill: toPixiColor(getPlantLabelColor(), 0),
    })
    text.position.set(label.screenPoint.x, label.screenPoint.y)
    text.anchor.set(0.5, 0)
    text.visible = true
  }

  for (const [species, text] of labelBySpecies) {
    if (nextSpecies.has(species)) continue
    text.removeFromParent()
    text.destroy()
    labelBySpecies.delete(species)
  }
}

function syncPinnedPlantNameLabels(
  createText: () => Text,
  layer: Container,
  labelByPlantId: Map<string, Text>,
  snapshot: SceneRendererSnapshot,
): void {
  const plantLayer = getSceneLayerStyle(snapshot.scene, 'plants')
  layer.visible = plantLayer.visible
  layer.alpha = plantLayer.opacity
  const labels = getCanvasPlantNameLabels(snapshot)
  const nextPlantIds = new Set(labels.map((label) => label.plantId))

  if (plantLayer.visible) {
    for (const label of labels) {
      let text = labelByPlantId.get(label.plantId)
      if (!text) {
        text = createText()
        labelByPlantId.set(label.plantId, text)
        layer.addChild(text)
      }
      text.text = label.text
      text.style = new TextStyle({
        fontFamily: 'Inter, sans-serif',
        fontSize: 12,
        fontWeight: '600',
        fontStyle: label.fontStyle,
        fill: toPixiColor(getPlantLabelColor(), 0),
      })
      text.position.set(label.screenPoint.x, label.screenPoint.y)
      text.anchor.set(0.5, 0)
      text.alpha = label.opacity
      text.visible = true
    }
  }

  for (const [plantId, text] of labelByPlantId) {
    if (plantLayer.visible && nextPlantIds.has(plantId)) continue
    text.removeFromParent()
    text.destroy()
    labelByPlantId.delete(plantId)
  }
}

function cssColorAlpha(color: string): number {
  const channels = color.match(/^rgba\(([^)]+)\)$/i)?.[1]?.split(',')
  return channels?.length === 4 ? Number.parseFloat(channels[3]!) : 1
}

function toPixiColor(color: string | null | undefined, fallback: string | number): number {
  const value = typeof fallback === 'number'
    ? fallback
    : Number.parseInt(String(fallback).replace('#', ''), 16)

  if (!color) return value

  const rgba = color.match(/rgba?\(([^)]+)\)/i)
  if (rgba) {
    const channels = rgba[1]!
      .split(',')
      .slice(0, 3)
      .map((channel) => Number.parseFloat(channel.trim()))
    if (channels.length === 3 && channels.every((channel) => Number.isFinite(channel))) {
      const [r, g, b] = channels.map((channel) => Math.max(0, Math.min(255, Math.round(channel)))) as [number, number, number]
      return (r << 16) + (g << 8) + b
    }
  }

  const normalized = color.replace('#', '')
  const parsed = Number.parseInt(normalized, 16)
  return Number.isFinite(parsed) ? parsed : value
}

function resolveInteractionState(
  selected: boolean,
  highlighted: boolean,
  hoverState: SceneRendererHoverState | null,
): CanvasInteractionVisualState | null {
  if (selected) return 'selected'
  if (hoverState) return hoverState
  return highlighted ? 'hover' : null
}

function hoverStateForTarget(
  snapshot: SceneRendererSnapshot,
  kind: 'plant' | 'zone' | 'annotation' | 'measurement-guide',
  id: string,
): SceneRendererHoverState | null {
  const hoverTarget = snapshot.hoverTarget
  if (!hoverTarget) return null
  if (hoverTarget.kind === kind && hoverTarget.id === id) return hoverTarget.state
  if (kind === 'measurement-guide') return null
  if (hoverTarget.kind !== 'group') return null
  const group = snapshot.scene.groups.find((entry) => entry.id === hoverTarget.id)
  return group?.members.some((member) => isSceneObjectGroupMemberTarget(member, { kind, id }))
    ? hoverTarget.state
    : null
}
