import { getAnnotationScreenFrame } from '../annotation-layout'
import {
  buildPlantPresentationEntries,
  getStackBadgeOffsetPx,
  layoutPlantPresentation,
  STACK_BADGE_RADIUS_PX,
  type PlantPresentationEntry,
} from '../plant-presentation'
import { computeSelectionLabels } from '../selection-labels'
import type {
  SceneAnnotationEntity,
  SceneViewportState,
  SceneZoneEntity,
} from '../scene'
import {
  getAnnotationTextColor,
  getCanvasInteractionStrokeVisual,
  getPlantLabelColor,
  getSceneLayerStyle,
  getStackBadgeBackgroundColor,
  getStackBadgeTextColor,
  resolveZoneVisual,
  type CanvasInteractionVisualState,
} from '../scene-visuals'
import type { SceneRendererDefinition, SceneRendererHoverState, SceneRendererInstance, SceneRendererSnapshot } from './scene-types'
import { getRectangularZoneCorners } from '../zone-geometry'

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
      canvas.style.background = 'transparent'
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
          const labels = computeSelectionLabels(
            snapshot.scene.plants,
            snapshot.selectedPlantIds,
            viewport,
            snapshot.localizedCommonNames,
          )
          snapshot = { ...snapshot, viewport, selectionLabels: labels }
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
        renderSelectionLabels(ctx, snapshot)
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
    const interactionState = resolveInteractionState(
      snapshot.selectedZoneIds.has(zone.name),
      snapshot.highlightedZoneIds.has(zone.name),
      hoverStateForTarget(snapshot, 'zone', zone.name),
    )
    const interactionVisual = interactionState ? getCanvasInteractionStrokeVisual(interactionState) : null
    ctx.strokeStyle = interactionVisual?.color ?? visual.stroke
    ctx.globalAlpha = (interactionVisual?.alpha ?? 1) * layer.opacity
    ctx.lineWidth = (interactionVisual?.widthPx ?? 2) / Math.max(ctx.getTransform().a, 1e-6)
    ctx.stroke()
  }

  ctx.globalAlpha = 1
}

function drawZonePath(ctx: CanvasRenderingContext2D, zone: SceneZoneEntity): void {
  if (zone.zoneType === 'rect' && zone.points.length >= 4) {
    if (Math.abs(zone.rotationDeg) > 0.000001) {
      const corners = getRectangularZoneCorners(zone)
      if (corners) drawClosedPath(ctx, corners)
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

function drawClosedPath(ctx: CanvasRenderingContext2D, points: readonly { x: number; y: number }[]): void {
  const first = points[0]
  if (!first) return
  ctx.moveTo(first.x, first.y)
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]!
    ctx.lineTo(point.x, point.y)
  }
  ctx.closePath()
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
    const highlighted = snapshot.highlightedPlantIds.has(entry.plant.id)
    const sameSpeciesHover = Boolean(
      snapshot.hoveredCanonicalName && entry.plant.canonicalName === snapshot.hoveredCanonicalName,
    )
    const interactionState = resolveInteractionState(
      selected,
      highlighted || sameSpeciesHover,
      hoverStateForTarget(snapshot, 'plant', entry.plant.id),
    )
    const interactionVisual = interactionState ? getCanvasInteractionStrokeVisual(interactionState) : null

    ctx.beginPath()
    ctx.arc(entry.plant.position.x, entry.plant.position.y, entry.radiusWorld, 0, Math.PI * 2)
    ctx.fillStyle = entry.color
    ctx.globalAlpha = 0.55 * layer.opacity
    ctx.fill()
    ctx.globalAlpha = layer.opacity
    ctx.strokeStyle = selected ? interactionVisual?.color ?? entry.color : entry.color
    ctx.lineWidth = selected ? (interactionVisual?.widthPx ?? 1.5) / snapshot.viewport.scale : worldLineWidth
    ctx.stroke()

    if (interactionState && !selected) {
      const ringVisual = getCanvasInteractionStrokeVisual(interactionState)
      ctx.beginPath()
      ctx.arc(entry.plant.position.x, entry.plant.position.y, entry.radiusWorld * 1.4, 0, Math.PI * 2)
      ctx.strokeStyle = ringVisual.color
      ctx.globalAlpha = ringVisual.alpha * layer.opacity
      ctx.lineWidth = ringVisual.widthPx / snapshot.viewport.scale
      ctx.stroke()
    }

    const stackCount = layout.stackCounts.get(entry.plant.id)
    if (stackCount) {
      drawStackBadge(ctx, entry, stackCount, layer.opacity)
    }
  }

  ctx.globalAlpha = 1
}

function drawStackBadge(
  ctx: CanvasRenderingContext2D,
  entry: PlantPresentationEntry,
  count: number,
  opacity: number,
): void {
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  const offset = getStackBadgeOffsetPx(entry.radiusScreenPx)
  const x = entry.screenPoint.x + offset.x
  const y = entry.screenPoint.y + offset.y
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
    const interactionState = resolveInteractionState(
      snapshot.selectedAnnotationIds.has(annotation.id),
      false,
      hoverStateForTarget(snapshot, 'annotation', annotation.id),
    )
    drawAnnotationText(ctx, annotation, snapshot.viewport, interactionState, layer.opacity)
  }
}

function drawAnnotationText(
  ctx: CanvasRenderingContext2D,
  annotation: SceneAnnotationEntity,
  viewport: SceneViewportState,
  interactionState: CanvasInteractionVisualState | null,
  opacity: number,
): void {
  const frame = getAnnotationScreenFrame(annotation, viewport)
  const lines = annotation.text.split('\n')

  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.translate(frame.origin.x, frame.origin.y)
  ctx.rotate((frame.rotationDeg * Math.PI) / 180)
  ctx.font = `${annotation.fontSize}px Inter, sans-serif`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'

  if (interactionState) {
    const visual = getCanvasInteractionStrokeVisual(interactionState)
    ctx.strokeStyle = visual.color
    ctx.globalAlpha = visual.alpha * opacity
    ctx.lineWidth = visual.widthPx
    ctx.strokeRect(-4, -2, frame.widthPx + 8, frame.heightPx + 4)
  }

  ctx.fillStyle = getAnnotationTextColor()
  ctx.globalAlpha = opacity
  lines.forEach((line, index) => {
    ctx.fillText(line, 0, index * frame.lineHeightPx)
  })
  ctx.restore()
}

function renderSelectionLabels(ctx: CanvasRenderingContext2D, snapshot: SceneRendererSnapshot): void {
  if (snapshot.selectionLabels.length === 0) return
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  for (const label of snapshot.selectionLabels) {
    ctx.fillStyle = getPlantLabelColor()
    ctx.globalAlpha = 1
    ctx.font = `${label.fontStyle === 'italic' ? 'italic ' : ''}600 12px Inter, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(label.text, label.screenPoint.x, label.screenPoint.y)
  }
  ctx.restore()
}

function applyViewport(ctx: CanvasRenderingContext2D, viewport: SceneViewportState): void {
  const current = ctx.getTransform()
  ctx.setTransform(current.a, current.b, current.c, current.d, 0, 0)
  ctx.translate(viewport.x, viewport.y)
  ctx.scale(viewport.scale, viewport.scale)
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
  kind: 'plant' | 'zone' | 'annotation',
  id: string,
): SceneRendererHoverState | null {
  const hoverTarget = snapshot.hoverTarget
  if (!hoverTarget) return null
  if (hoverTarget.kind === kind && hoverTarget.id === id) return hoverTarget.state
  if (hoverTarget.kind !== 'group') return null
  const group = snapshot.scene.groups.find((entry) => entry.id === hoverTarget.id)
  return group?.memberIds.includes(id) ? hoverTarget.state : null
}
