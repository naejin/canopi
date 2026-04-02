import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js'
import { getAnnotationScreenBounds, getAnnotationWorldBounds } from '../annotation-layout'
import {
  buildPlantPresentationEntries,
  layoutPlantPresentation,
  STACK_BADGE_OFFSET_X_PX,
  STACK_BADGE_OFFSET_Y_PX,
  STACK_BADGE_RADIUS_PX,
} from '../plant-presentation'
import {
  getAnnotationTextColor,
  getPlantLabelColor,
  getSceneLayerStyle,
  getSelectionStrokeColor,
  getStackBadgeBackgroundColor,
  getStackBadgeTextColor,
  resolveZoneVisual,
} from '../scene-visuals'
import type { SceneRendererDefinition, SceneRendererInstance, SceneRendererSnapshot } from './scene-types'
import type { SceneAnnotationEntity, SceneZoneEntity } from '../scene'

const BACKGROUND_COLOR = 0x000000

export function createPixiSceneRenderer(): SceneRendererDefinition {
  return {
    id: 'pixi',
    supports(capabilities) {
      return capabilities.webgl || capabilities.webgl2
    },
    async initialize(context) {
      const app = new Application()
      await app.init({
        width: Math.max(1, context.container.clientWidth),
        height: Math.max(1, context.container.clientHeight),
        antialias: true,
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
      canvas.style.zIndex = '1'
      context.container.appendChild(canvas)

      const world = new Container()
      const zonesLayer = new Container()
      const plantsLayer = new Container()
      const plantsOverlayLayer = new Container()
      const annotationTextLayer = new Container()
      const annotationHighlightLayer = new Container()
      world.addChild(zonesLayer)
      world.addChild(plantsLayer)
      world.addChild(plantsOverlayLayer)
      world.addChild(annotationTextLayer)
      world.addChild(annotationHighlightLayer)
      app.stage.addChild(world)

      let snapshot: SceneRendererSnapshot | null = null
      const zoneGraphicsByName = new Map<string, Graphics>()
      const plantGraphicsById = new Map<string, Graphics>()
      const plantLabelById = new Map<string, Text>()
      const plantBadgeGraphicsById = new Map<string, Graphics>()
      const plantBadgeTextById = new Map<string, Text>()
      const annotationTextById = new Map<string, Text>()
      const annotationHighlightById = new Map<string, Graphics>()

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
          syncPlants(
            plantsLayer,
            plantsOverlayLayer,
            plantGraphicsById,
            plantLabelById,
            plantBadgeGraphicsById,
            plantBadgeTextById,
            nextSnapshot,
            true,
          )
          syncAnnotations(
            annotationTextLayer,
            annotationHighlightLayer,
            annotationTextById,
            annotationHighlightById,
            nextSnapshot,
            true,
          )
          world.position.set(nextSnapshot.viewport.x, nextSnapshot.viewport.y)
          world.scale.set(nextSnapshot.viewport.scale)
          app.render()
        },
        setViewport(viewport) {
          if (!snapshot) return
          snapshot = { ...snapshot, viewport }
          syncPlants(
            plantsLayer,
            plantsOverlayLayer,
            plantGraphicsById,
            plantLabelById,
            plantBadgeGraphicsById,
            plantBadgeTextById,
            snapshot,
            false,
          )
          syncAnnotations(
            annotationTextLayer,
            annotationHighlightLayer,
            annotationTextById,
            annotationHighlightById,
            snapshot,
            false,
          )
          world.position.set(viewport.x, viewport.y)
          world.scale.set(viewport.scale)
          app.render()
        },
      }

      return instance
    },
  }
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
    drawZone(graphics, zone, snapshot.selectedZoneIds.has(zone.name))
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

function drawZone(graphics: Graphics, zone: SceneZoneEntity, selected: boolean): void {
  const visual = resolveZoneVisual(zone)
  const fillColor = toPixiColor(visual.fill, 0)
  const strokeColor = toPixiColor(selected ? getSelectionStrokeColor() : visual.stroke, 0)
  const strokeWidth = selected ? 3 : 2

  graphics.clear()

  if (zone.zoneType === 'rect' && zone.points.length >= 4) {
    const start = zone.points[0]!
    const end = zone.points[2]!
    graphics.rect(start.x, start.y, end.x - start.x, end.y - start.y)
      .fill({ color: fillColor, alpha: 0.2 })
      .stroke({ color: strokeColor, width: strokeWidth, alpha: 1 })
    return
  }

  if (zone.zoneType === 'ellipse' && zone.points.length >= 2) {
    const center = zone.points[0]!
    const radii = zone.points[1]!
    graphics.ellipse(center.x, center.y, radii.x, radii.y)
      .fill({ color: fillColor, alpha: 0.2 })
      .stroke({ color: strokeColor, width: strokeWidth, alpha: 1 })
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
    graphics.closePath().fill({ color: fillColor, alpha: 0.2 })
  }

  graphics.stroke({ color: strokeColor, width: strokeWidth, alpha: 1 })
}

function syncPlants(
  world: Container,
  overlay: Container,
  plantGraphicsById: Map<string, Graphics>,
  plantLabelById: Map<string, Text>,
  plantBadgeGraphicsById: Map<string, Graphics>,
  plantBadgeTextById: Map<string, Text>,
  snapshot: SceneRendererSnapshot,
  reconcileRemoved: boolean,
): void {
  const layer = getSceneLayerStyle(snapshot.scene, 'plants')
  world.visible = layer.visible
  world.alpha = layer.opacity
  overlay.visible = layer.visible
  overlay.alpha = layer.opacity
  if (!layer.visible) return

  const entries = buildPlantPresentationEntries(snapshot.scene.plants, {
    viewport: snapshot.viewport,
    sizeMode: snapshot.sizeMode,
    colorByAttr: snapshot.colorByAttr,
    speciesCache: snapshot.speciesCache,
    localizedCommonNames: snapshot.localizedCommonNames,
  }, snapshot.selectedPlantIds)
  const layout = layoutPlantPresentation(entries, snapshot.viewport.scale)
  const nextIds = new Set(entries.map((entry) => entry.plant.id))

  for (const entry of entries) {
    const circle = plantGraphicsById.get(entry.plant.id) ?? new Graphics()
    if (!plantGraphicsById.has(entry.plant.id)) {
      plantGraphicsById.set(entry.plant.id, circle)
      world.addChild(circle)
    }
    drawPlant(circle, entry)
    circle.visible = true

    const labelVisible = layout.visibleLabelIds.has(entry.plant.id)
    if (labelVisible) {
      const label = plantLabelById.get(entry.plant.id) ?? new Text()
      if (!plantLabelById.has(entry.plant.id)) {
        plantLabelById.set(entry.plant.id, label)
        overlay.addChild(label)
      }
      drawPlantLabel(label, entry, snapshot.viewport.scale)
      label.visible = true
    } else if (reconcileRemoved && plantLabelById.has(entry.plant.id)) {
      const label = plantLabelById.get(entry.plant.id)
      if (label) {
        label.removeFromParent()
        label.destroy()
      }
      plantLabelById.delete(entry.plant.id)
    } else {
      const label = plantLabelById.get(entry.plant.id)
      if (label) label.visible = false
    }

    const stackCount = layout.stackCounts.get(entry.plant.id)
    if (stackCount) {
      const badge = plantBadgeGraphicsById.get(entry.plant.id) ?? new Graphics()
      if (!plantBadgeGraphicsById.has(entry.plant.id)) {
        plantBadgeGraphicsById.set(entry.plant.id, badge)
        overlay.addChild(badge)
      }
      drawStackBadge(badge, entry, snapshot.viewport.scale)
      badge.visible = true

      const badgeText = plantBadgeTextById.get(entry.plant.id) ?? new Text()
      if (!plantBadgeTextById.has(entry.plant.id)) {
        plantBadgeTextById.set(entry.plant.id, badgeText)
        overlay.addChild(badgeText)
      }
      drawStackBadgeText(badgeText, entry, stackCount, snapshot.viewport.scale)
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
  for (const [plantId, label] of plantLabelById) {
    if (nextIds.has(plantId)) continue
    label.removeFromParent()
    label.destroy()
    plantLabelById.delete(plantId)
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

function drawPlant(graphics: Graphics, entry: ReturnType<typeof buildPlantPresentationEntries>[number]): void {
  const color = toPixiColor(entry.color, 0)
  const selected = entry.selected
  graphics.clear()
  graphics.circle(entry.plant.position.x, entry.plant.position.y, entry.radiusWorld)
    .fill({ color, alpha: 0.55 })
    .stroke({
      color: toPixiColor(selected ? getSelectionStrokeColor() : entry.color, color),
      width: selected ? 0.35 : 0.15,
      alpha: 1,
    })
}

function drawPlantLabel(
  label: Text,
  entry: ReturnType<typeof buildPlantPresentationEntries>[number],
  viewportScale: number,
): void {
  label.text = entry.labelText
  label.style = new TextStyle({
    fontSize: 11 / viewportScale,
    fill: toPixiColor(getPlantLabelColor(), 0),
    fontStyle: entry.labelFontStyle,
  })
  label.position.set(entry.plant.position.x, entry.plant.position.y + (12 / viewportScale))
  label.anchor.set(0.5, 0)
}

function drawStackBadge(
  badge: Graphics,
  entry: ReturnType<typeof buildPlantPresentationEntries>[number],
  viewportScale: number,
): void {
  badge.clear()
  badge.circle(
    entry.plant.position.x + STACK_BADGE_OFFSET_X_PX / viewportScale,
    entry.plant.position.y + STACK_BADGE_OFFSET_Y_PX / viewportScale,
    STACK_BADGE_RADIUS_PX / viewportScale,
  ).fill({ color: toPixiColor(getStackBadgeBackgroundColor(), 0), alpha: 1 })
}

function drawStackBadgeText(
  badgeText: Text,
  entry: ReturnType<typeof buildPlantPresentationEntries>[number],
  stackCount: number,
  viewportScale: number,
): void {
  badgeText.text = String(stackCount)
  badgeText.style = new TextStyle({
    fontSize: 9 / viewportScale,
    fill: toPixiColor(getStackBadgeTextColor(), 0),
  })
  badgeText.position.set(
    entry.plant.position.x + STACK_BADGE_OFFSET_X_PX / viewportScale,
    entry.plant.position.y + STACK_BADGE_OFFSET_Y_PX / viewportScale,
  )
  badgeText.anchor.set(0.5, 0.5)
}

function syncAnnotations(
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
    const text = annotationTextById.get(annotation.id) ?? new Text()
    if (!annotationTextById.has(annotation.id)) {
      annotationTextById.set(annotation.id, text)
      textLayer.addChild(text)
    }
    drawAnnotationText(text, annotation, snapshot.viewport)
    text.visible = true

    const selected = snapshot.selectedAnnotationIds.has(annotation.id)
    const highlight = annotationHighlightById.get(annotation.id)
    if (selected) {
      const nextHighlight = highlight ?? new Graphics()
      if (!annotationHighlightById.has(annotation.id)) {
        annotationHighlightById.set(annotation.id, nextHighlight)
        highlightLayer.addChild(nextHighlight)
      }
      drawAnnotationHighlight(nextHighlight, annotation, snapshot.viewport.scale)
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
  const screenBounds = getAnnotationScreenBounds(annotation, viewport)
  text.text = annotation.text
  text.style = new TextStyle({
    fontSize: annotation.fontSize / viewport.scale,
    fill: getAnnotationTextColor(),
  })
  text.position.set(screenBounds.x, screenBounds.y)
  text.anchor.set(0, 0)
}

function drawAnnotationHighlight(
  highlight: Graphics,
  annotation: SceneAnnotationEntity,
  viewportScale: number,
): void {
  const bounds = getAnnotationWorldBounds(annotation, viewportScale)
  highlight.clear()
  highlight
    .rect(
      bounds.x - 4 / viewportScale,
      bounds.y - 2 / viewportScale,
      bounds.width + 8 / viewportScale,
      bounds.height + 4 / viewportScale,
    )
    .stroke({ color: toPixiColor(getSelectionStrokeColor(), 0), width: 1 / viewportScale, alpha: 1 })
}

function toPixiColor(color: string | null | undefined, fallback: string | number): number {
  const value = typeof fallback === 'number'
    ? fallback
    : Number.parseInt(String(fallback).replace('#', ''), 16)

  if (!color) return value

  const normalized = color.replace('#', '')
  const parsed = Number.parseInt(normalized, 16)
  return Number.isFinite(parsed) ? parsed : value
}
