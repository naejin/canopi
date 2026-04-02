import { getAnnotationScreenBounds, getAnnotationTextMetrics } from '../annotation-layout'
import {
  buildPlantPresentationEntries,
  layoutPlantPresentation,
  STACK_BADGE_OFFSET_X_PX,
  STACK_BADGE_OFFSET_Y_PX,
  STACK_BADGE_RADIUS_PX,
} from '../plant-presentation'
import type {
  SceneAnnotationEntity,
  SceneViewportState,
  SceneZoneEntity,
} from '../scene'
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

export function createCanvas2DSceneRenderer(): SceneRendererDefinition {
  return {
    id: 'canvas2d',
    supports(capabilities) {
      return capabilities.canvas2d
    },
    initialize(context) {
      const canvas = document.createElement('canvas')
      canvas.style.position = 'absolute'
      canvas.style.inset = '0'
      canvas.style.width = '100%'
      canvas.style.height = '100%'
      canvas.style.zIndex = '1'
      context.container.appendChild(canvas)

      const dpr = Math.max(window.devicePixelRatio || 1, 1)
      let snapshot: SceneRendererSnapshot | null = null

      const resize = (width: number, height: number): void => {
        canvas.width = Math.max(1, Math.round(width * dpr))
        canvas.height = Math.max(1, Math.round(height * dpr))
      }

      resize(context.container.clientWidth, context.container.clientHeight)

      const instance: SceneRendererInstance = {
        id: 'canvas2d',
        dispose() {
          canvas.remove()
        },
        resize(width, height) {
          resize(width, height)
          redraw()
        },
        renderScene(nextSnapshot) {
          snapshot = nextSnapshot
          redraw()
        },
        setViewport(viewport) {
          if (!snapshot) return
          snapshot = { ...snapshot, viewport }
          redraw()
        },
      }

      const redraw = (): void => {
        if (!snapshot) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        applyViewport(ctx, snapshot.viewport)
        renderZones(ctx, snapshot)
        renderPlants(ctx, snapshot)
        renderAnnotations(ctx, snapshot)
      }

      return instance
    },
  }
}

function renderZones(ctx: CanvasRenderingContext2D, snapshot: SceneRendererSnapshot): void {
  const layer = getSceneLayerStyle(snapshot.scene, 'zones')
  if (!layer.visible) return

  for (const zone of snapshot.scene.zones) {
    const visual = resolveZoneVisual(zone)
    ctx.beginPath()
    drawZonePath(ctx, zone)
    ctx.fillStyle = visual.fill
    ctx.globalAlpha = 0.2 * layer.opacity
    if (zone.zoneType !== 'line') {
      ctx.fill()
    }
    ctx.globalAlpha = layer.opacity
    ctx.strokeStyle = snapshot.selectedZoneIds.has(zone.name) ? getSelectionStrokeColor() : visual.stroke
    ctx.lineWidth = (snapshot.selectedZoneIds.has(zone.name) ? 3 : 2) / Math.max(ctx.getTransform().a, 1e-6)
    ctx.stroke()
  }

  ctx.globalAlpha = 1
}

function drawZonePath(ctx: CanvasRenderingContext2D, zone: SceneZoneEntity): void {
  if (zone.zoneType === 'rect' && zone.points.length >= 4) {
    const start = zone.points[0]!
    const end = zone.points[2]!
    ctx.rect(start.x, start.y, end.x - start.x, end.y - start.y)
    return
  }

  if (zone.zoneType === 'ellipse' && zone.points.length >= 2) {
    const center = zone.points[0]!
    const radii = zone.points[1]!
    ctx.ellipse(center.x, center.y, radii.x, radii.y, 0, 0, Math.PI * 2)
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

function renderPlants(ctx: CanvasRenderingContext2D, snapshot: SceneRendererSnapshot): void {
  const layer = getSceneLayerStyle(snapshot.scene, 'plants')
  if (!layer.visible) return

  const worldLineWidth = 1.5 / snapshot.viewport.scale
  const entries = buildPlantPresentationEntries(snapshot.scene.plants, {
    viewport: snapshot.viewport,
    sizeMode: snapshot.sizeMode,
    colorByAttr: snapshot.colorByAttr,
    speciesCache: snapshot.speciesCache,
    localizedCommonNames: snapshot.localizedCommonNames,
  }, snapshot.selectedPlantIds)
  const layout = layoutPlantPresentation(entries, snapshot.viewport.scale)

  for (const entry of entries) {
    const selected = entry.selected

    ctx.beginPath()
    ctx.arc(entry.plant.position.x, entry.plant.position.y, entry.radiusWorld, 0, Math.PI * 2)
    ctx.fillStyle = entry.color
    ctx.globalAlpha = 0.55 * layer.opacity
    ctx.fill()
    ctx.globalAlpha = layer.opacity
    ctx.strokeStyle = selected ? getSelectionStrokeColor() : entry.color
    ctx.lineWidth = selected ? worldLineWidth * 2.5 : worldLineWidth
    ctx.stroke()

    if (layout.visibleLabelIds.has(entry.plant.id)) {
      drawLabel(ctx, entry.labelText, entry.labelScreenPoint, entry.labelFontStyle === 'normal', layer.opacity)
    }
    const stackCount = layout.stackCounts.get(entry.plant.id)
    if (stackCount) {
      drawStackBadge(ctx, entry.screenPoint, stackCount, layer.opacity)
    }
  }

  ctx.globalAlpha = 1
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  labelText: string,
  labelPoint: { x: number; y: number },
  isCommonName: boolean,
  opacity: number,
): void {
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = getPlantLabelColor()
  ctx.globalAlpha = opacity
  ctx.font = `${isCommonName ? '400' : 'italic'} 11px Inter, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText(labelText, labelPoint.x, labelPoint.y)
  ctx.restore()
}

function drawStackBadge(
  ctx: CanvasRenderingContext2D,
  screenPoint: { x: number; y: number },
  count: number,
  opacity: number,
): void {
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  const x = screenPoint.x + STACK_BADGE_OFFSET_X_PX
  const y = screenPoint.y + STACK_BADGE_OFFSET_Y_PX
  ctx.globalAlpha = opacity
  ctx.fillStyle = getStackBadgeBackgroundColor()
  ctx.beginPath()
  ctx.arc(x, y, STACK_BADGE_RADIUS_PX, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = getStackBadgeTextColor()
  ctx.font = '9px Inter, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(count), x, y)
  ctx.restore()
}

function renderAnnotations(ctx: CanvasRenderingContext2D, snapshot: SceneRendererSnapshot): void {
  const layer = getSceneLayerStyle(snapshot.scene, 'annotations')
  if (!layer.visible) return

  for (const annotation of snapshot.scene.annotations) {
    if (annotation.annotationType !== 'text') continue
    drawAnnotationText(ctx, annotation, snapshot.viewport, snapshot.selectedAnnotationIds.has(annotation.id), layer.opacity)
  }
}

function drawAnnotationText(
  ctx: CanvasRenderingContext2D,
  annotation: SceneAnnotationEntity,
  viewport: SceneViewportState,
  selected: boolean,
  opacity: number,
): void {
  const screenBounds = getAnnotationScreenBounds(annotation, viewport)
  const metrics = getAnnotationTextMetrics(annotation)
  const lines = annotation.text.split('\n')

  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.font = `${annotation.fontSize}px Inter, sans-serif`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'

  if (selected) {
    ctx.strokeStyle = getSelectionStrokeColor()
    ctx.lineWidth = 1
    ctx.strokeRect(screenBounds.x - 4, screenBounds.y - 2, screenBounds.width + 8, screenBounds.height + 4)
  }

  ctx.fillStyle = getAnnotationTextColor()
  ctx.globalAlpha = opacity
  lines.forEach((line, index) => {
    ctx.fillText(line, screenBounds.x, screenBounds.y + index * metrics.lineHeightPx)
  })
  ctx.restore()
}

function applyViewport(ctx: CanvasRenderingContext2D, viewport: SceneViewportState): void {
  const current = ctx.getTransform()
  ctx.setTransform(current.a, current.b, current.c, current.d, 0, 0)
  ctx.translate(viewport.x, viewport.y)
  ctx.scale(viewport.scale, viewport.scale)
}
