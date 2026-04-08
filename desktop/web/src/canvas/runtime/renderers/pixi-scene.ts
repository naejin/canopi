import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js'
import { getAnnotationScreenBounds, getAnnotationWorldBounds } from '../annotation-layout'
import {
  buildPlantPresentationEntries,
  layoutPlantPresentation,
  STACK_BADGE_OFFSET_X_PX,
  STACK_BADGE_OFFSET_Y_PX,
  STACK_BADGE_RADIUS_PX,
} from '../plant-presentation'
import { computeSelectionLabels } from '../selection-labels'
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
      const selectionLabelLayer = new Container()
      app.stage.addChild(world)
      app.stage.addChild(selectionLabelLayer)

      let snapshot: SceneRendererSnapshot | null = null
      const zoneGraphicsByName = new Map<string, Graphics>()
      const plantGraphicsById = new Map<string, Graphics>()
      const plantBadgeGraphicsById = new Map<string, Graphics>()
      const plantBadgeTextById = new Map<string, Text>()
      const annotationTextById = new Map<string, Text>()
      const annotationHighlightById = new Map<string, Graphics>()
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
          syncPlants(
            plantsLayer,
            plantsOverlayLayer,
            plantGraphicsById,
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
          syncSelectionLabels(selectionLabelLayer, selectionLabelBySpecies, nextSnapshot)
          world.position.set(nextSnapshot.viewport.x, nextSnapshot.viewport.y)
          world.scale.set(nextSnapshot.viewport.scale)
          app.render()
        },
        setViewport(viewport) {
          if (!snapshot) return
          const labels = computeSelectionLabels(
            snapshot.scene.plants,
            snapshot.selectedPlantIds,
            viewport,
            snapshot.localizedCommonNames,
          )
          snapshot = { ...snapshot, viewport, selectionLabels: labels }
          syncPlants(
            plantsLayer,
            plantsOverlayLayer,
            plantGraphicsById,
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
          syncSelectionLabels(selectionLabelLayer, selectionLabelBySpecies, snapshot)
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
    drawZone(graphics, zone, snapshot.selectedZoneIds.has(zone.name), snapshot.highlightedZoneIds.has(zone.name))
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

function drawZone(graphics: Graphics, zone: SceneZoneEntity, selected: boolean, highlighted: boolean): void {
  const visual = resolveZoneVisual(zone)
  const fillColor = toPixiColor(visual.fill, 0)
  const emphasized = selected || highlighted
  const strokeColor = toPixiColor(emphasized ? getSelectionStrokeColor() : visual.stroke, 0)
  const strokeWidth = emphasized ? 3 : 2

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
    drawPlant(circle, entry, snapshot.hoveredCanonicalName, snapshot.highlightedPlantIds.has(entry.plant.id))
    circle.visible = true

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
  entry: ReturnType<typeof buildPlantPresentationEntries>[number],
  hoveredCanonicalName: string | null,
  highlighted: boolean,
): void {
  const color = toPixiColor(entry.color, 0)
  const selected = entry.selected
  const x = entry.plant.position.x
  const y = entry.plant.position.y
  const r = entry.radiusWorld
  graphics.clear()
  graphics.circle(x, y, r)
    .fill({ color, alpha: 0.55 })
    .stroke({
      color: toPixiColor(selected ? getSelectionStrokeColor() : entry.color, color),
      width: selected ? 0.35 : 0.15,
      alpha: 1,
    })
  if (highlighted || (hoveredCanonicalName && entry.plant.canonicalName === hoveredCanonicalName)) {
    graphics.circle(x, y, r * 1.4)
      .stroke({
        color: toPixiColor(getSelectionStrokeColor(), 0),
        width: 0.2,
        alpha: 0.5,
      })
  }
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

function syncSelectionLabels(
  layer: Container,
  labelBySpecies: Map<string, Text>,
  snapshot: SceneRendererSnapshot,
): void {
  const nextSpecies = new Set(snapshot.selectionLabels.map((l) => l.canonicalName))

  for (const label of snapshot.selectionLabels) {
    let text = labelBySpecies.get(label.canonicalName)
    if (!text) {
      text = new Text()
      labelBySpecies.set(label.canonicalName, text)
      layer.addChild(text)
    }
    text.text = label.text
    text.style = new TextStyle({
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

function toPixiColor(color: string | null | undefined, fallback: string | number): number {
  const value = typeof fallback === 'number'
    ? fallback
    : Number.parseInt(String(fallback).replace('#', ''), 16)

  if (!color) return value

  const normalized = color.replace('#', '')
  const parsed = Number.parseInt(normalized, 16)
  return Number.isFinite(parsed) ? parsed : value
}
