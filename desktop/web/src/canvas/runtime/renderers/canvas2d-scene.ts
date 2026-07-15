import { getAnnotationScreenFrame } from '../annotation-layout'
import {
  buildPlantPresentationEntries,
  getStackBadgeOffsetPx,
  layoutPlantPresentation,
  STACK_BADGE_RADIUS_PX,
  type PlantPresentationEntry,
} from '../plant-presentation'
import {
  createMeasurementGuidePresentation,
  MEASUREMENT_GUIDE_DASH_PX,
  MEASUREMENT_GUIDE_GAP_PX,
  MEASUREMENT_GUIDE_LABEL_FONT_SIZE_PX,
  MEASUREMENT_GUIDE_TICK_HALF_PX,
} from '../measurement-guides'
import {
  DEFAULT_PLANT_SYMBOL_LINE_STROKE_WIDTH,
  DEFAULT_PLANT_SYMBOL_SHAPE_STROKE_WIDTH,
  PLANT_SYMBOL_RECIPES,
} from '../plant-symbol-recipes'
import { computePinnedPlantNameLabels, computeSelectionLabels } from '../selection-labels'
import type {
  SceneAnnotationEntity,
  PlantSymbolId,
  SceneViewportState,
  SceneZoneEntity,
} from '../scene'
import { isSceneObjectGroupMemberTarget } from '../scene'
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

export interface Canvas2DSceneSnapshotRenderOptions {
  readonly widthPx: number
  readonly heightPx: number
  readonly dpr?: number
  readonly background?: string | null
  readonly underlay?: ((ctx: CanvasRenderingContext2D, widthPx: number, heightPx: number) => void) | null
}

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
      let logicalWidth = Math.max(1, context.container.clientWidth)
      let logicalHeight = Math.max(1, context.container.clientHeight)

      const resize = (width: number, height: number): void => {
        logicalWidth = Math.max(1, width)
        logicalHeight = Math.max(1, height)
        canvas.width = Math.max(1, Math.round(logicalWidth * dpr))
        canvas.height = Math.max(1, Math.round(logicalHeight * dpr))
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
            snapshot.selectedEntityIds,
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
              plantContext: {
                viewport,
                speciesCache: snapshot.speciesCache,
                localizedCommonNames: snapshot.localizedCommonNames,
              },
            },
          )
          snapshot = { ...snapshot, viewport, pinnedPlantNameLabels, selectionLabels: labels }
          redraw()
        },
      }

      const redraw = (): void => {
        if (!snapshot) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        renderCanvas2DSceneSnapshot(ctx, snapshot, {
          widthPx: logicalWidth,
          heightPx: logicalHeight,
          dpr,
        })
      }

      return instance
    },
  }
}

export function renderCanvas2DSceneSnapshot(
  ctx: CanvasRenderingContext2D,
  snapshot: SceneRendererSnapshot,
  options: Canvas2DSceneSnapshotRenderOptions,
): void {
  const dpr = Math.max(options.dpr ?? 1, 1)
  const widthPx = Math.max(1, options.widthPx)
  const heightPx = Math.max(1, options.heightPx)

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, widthPx, heightPx)
  if (options.background) {
    ctx.fillStyle = options.background
    ctx.globalAlpha = 1
    ctx.fillRect(0, 0, widthPx, heightPx)
  }
  if (options.underlay) {
    ctx.save()
    options.underlay(ctx, widthPx, heightPx)
    ctx.restore()
  }

  applyViewport(ctx, snapshot.viewport)
  renderZones(ctx, snapshot)
  renderMeasurementGuides(ctx, snapshot)
  renderPlants(ctx, snapshot)
  renderPinnedPlantNameLabels(ctx, snapshot)
  renderSelectionLabels(ctx, snapshot)
  renderAnnotations(ctx, snapshot)
}

function renderMeasurementGuides(ctx: CanvasRenderingContext2D, snapshot: SceneRendererSnapshot): void {
  const layer = getSceneLayerStyle(snapshot.scene, 'measurement-guides')
  if (!layer.visible) return

  const guideColor = getAnnotationTextColor()
  const viewportScale = Math.max(snapshot.viewport.scale, 0.001)
  const dashWorld = MEASUREMENT_GUIDE_DASH_PX / viewportScale
  const gapWorld = MEASUREMENT_GUIDE_GAP_PX / viewportScale
  const tickHalfWorld = MEASUREMENT_GUIDE_TICK_HALF_PX / viewportScale

  ctx.save()

  for (const guide of snapshot.scene.measurementGuides) {
    const presentation = createMeasurementGuidePresentation(guide, snapshot.viewport)
    if (!presentation) continue
    const interactionState = resolveInteractionState(
      snapshot.selectedMeasurementGuideIds.has(guide.id),
      false,
      hoverStateForTarget(snapshot, 'measurement-guide', guide.id),
    )
    const interactionVisual = interactionState ? getCanvasInteractionStrokeVisual(interactionState) : null
    ctx.strokeStyle = interactionVisual?.color ?? guideColor
    ctx.lineWidth = (interactionVisual?.widthPx ?? 1.5) / viewportScale
    ctx.globalAlpha = (interactionVisual?.alpha ?? 1) * layer.opacity
    ctx.setLineDash([dashWorld, gapWorld])

    ctx.beginPath()
    ctx.moveTo(guide.start.x, guide.start.y)
    ctx.lineTo(guide.end.x, guide.end.y)
    ctx.stroke()

    ctx.setLineDash([])
    ctx.beginPath()
    drawMeasurementGuideTick(ctx, guide.start, presentation.normalWorld, tickHalfWorld)
    drawMeasurementGuideTick(ctx, guide.end, presentation.normalWorld, tickHalfWorld)
    ctx.stroke()
    ctx.setLineDash([dashWorld, gapWorld])
  }
  ctx.restore()

  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.font = `400 ${MEASUREMENT_GUIDE_LABEL_FONT_SIZE_PX}px Inter, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const guide of snapshot.scene.measurementGuides) {
    const presentation = createMeasurementGuidePresentation(guide, snapshot.viewport)
    if (!presentation) continue
    const interactionState = resolveInteractionState(
      snapshot.selectedMeasurementGuideIds.has(guide.id),
      false,
      hoverStateForTarget(snapshot, 'measurement-guide', guide.id),
    )
    const interactionVisual = interactionState ? getCanvasInteractionStrokeVisual(interactionState) : null
    ctx.fillStyle = interactionVisual?.color ?? guideColor
    ctx.globalAlpha = (interactionVisual?.alpha ?? 1) * layer.opacity
    ctx.save()
    ctx.translate(presentation.labelScreenPoint.x, presentation.labelScreenPoint.y)
    ctx.rotate(presentation.labelRotationRad)
    ctx.fillText(presentation.text, 0, 0)
    ctx.restore()
  }
  ctx.restore()
  ctx.globalAlpha = 1
}

function drawMeasurementGuideTick(
  ctx: CanvasRenderingContext2D,
  point: { x: number; y: number },
  normal: { x: number; y: number },
  halfLength: number,
): void {
  ctx.moveTo(point.x - normal.x * halfLength, point.y - normal.y * halfLength)
  ctx.lineTo(point.x + normal.x * halfLength, point.y + normal.y * halfLength)
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
    speciesCache: snapshot.speciesCache,
    plantSpeciesSymbols: snapshot.scene.plantSpeciesSymbols,
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
    const renderedSymbol = resolveRenderedPlantSymbol(entry)
    const selectedStrokeColor = interactionVisual?.color ?? entry.color
    const glyphStrokeColor = renderedSymbol === 'round' && selected ? selectedStrokeColor : entry.color
    const glyphLineWidth = renderedSymbol === 'round' && selected
      ? (interactionVisual?.widthPx ?? 1.5) / snapshot.viewport.scale
      : worldLineWidth

    drawPlantSymbolGlyph(
      ctx,
      renderedSymbol,
      entry,
      entry.color,
      glyphStrokeColor,
      glyphLineWidth,
      layer.opacity,
      snapshot.viewport.scale,
    )

    if (selected && renderedSymbol !== 'round') {
      ctx.beginPath()
      ctx.arc(entry.plant.position.x, entry.plant.position.y, entry.radiusWorld, 0, Math.PI * 2)
      ctx.globalAlpha = layer.opacity
      ctx.strokeStyle = selectedStrokeColor
      ctx.lineWidth = (interactionVisual?.widthPx ?? 1.5) / snapshot.viewport.scale
      ctx.stroke()
    }

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

function resolveRenderedPlantSymbol(entry: PlantPresentationEntry): PlantSymbolId {
  return entry.lod === 'dot' || entry.usesCanopyRadius ? 'round' : entry.symbol
}

function drawPlantSymbolGlyph(
  ctx: CanvasRenderingContext2D,
  symbol: PlantSymbolId,
  entry: PlantPresentationEntry,
  fillColor: string,
  strokeColor: string,
  worldLineWidth: number,
  opacity: number,
  viewportScale: number,
): void {
  const x = entry.plant.position.x
  const y = entry.plant.position.y
  const r = entry.radiusWorld
  const lineWidth = Math.max(worldLineWidth, 1.6 / Math.max(viewportScale, 0.001))

  ctx.fillStyle = fillColor
  ctx.strokeStyle = strokeColor
  ctx.lineWidth = lineWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  for (const command of PLANT_SYMBOL_RECIPES[symbol]) {
    switch (command.kind) {
      case 'circle':
        ctx.beginPath()
        ctx.arc(x + command.cx * r, y + command.cy * r, command.radius * r, 0, Math.PI * 2)
        fillAndStrokeCanvasSymbolCommand(ctx, command.fill, command.stroke, opacity)
        break
      case 'rect':
        ctx.beginPath()
        ctx.rect(x + command.x * r, y + command.y * r, command.width * r, command.height * r)
        fillAndStrokeCanvasSymbolCommand(ctx, command.fill, command.stroke, opacity)
        break
      case 'path': {
        const first = command.points[0]
        if (!first) break
        ctx.beginPath()
        ctx.moveTo(x + first[0] * r, y + first[1] * r)
        for (let index = 1; index < command.points.length; index += 1) {
          const point = command.points[index]!
          ctx.lineTo(x + point[0] * r, y + point[1] * r)
        }
        if (command.closed) ctx.closePath()
        ctx.lineWidth = lineWidth * (
          (command.strokeWidth ?? DEFAULT_PLANT_SYMBOL_SHAPE_STROKE_WIDTH) /
          DEFAULT_PLANT_SYMBOL_SHAPE_STROKE_WIDTH
        )
        fillAndStrokeCanvasSymbolCommand(ctx, command.fill, command.stroke, opacity)
        ctx.lineWidth = lineWidth
        break
      }
      case 'curvePath':
        ctx.beginPath()
        ctx.moveTo(x + command.start[0] * r, y + command.start[1] * r)
        for (const segment of command.segments) {
          if (segment.kind === 'line') {
            ctx.lineTo(x + segment.to[0] * r, y + segment.to[1] * r)
          } else {
            ctx.bezierCurveTo(
              x + segment.control1[0] * r,
              y + segment.control1[1] * r,
              x + segment.control2[0] * r,
              y + segment.control2[1] * r,
              x + segment.to[0] * r,
              y + segment.to[1] * r,
            )
          }
        }
        if (command.closed) ctx.closePath()
        ctx.lineWidth = lineWidth * (
          (command.strokeWidth ?? DEFAULT_PLANT_SYMBOL_SHAPE_STROKE_WIDTH) /
          DEFAULT_PLANT_SYMBOL_SHAPE_STROKE_WIDTH
        )
        fillAndStrokeCanvasSymbolCommand(ctx, command.fill, command.stroke, opacity)
        ctx.lineWidth = lineWidth
        break
      case 'lines':
        ctx.globalAlpha = opacity
        ctx.lineWidth = lineWidth * (
          (command.strokeWidth ?? DEFAULT_PLANT_SYMBOL_LINE_STROKE_WIDTH) /
          DEFAULT_PLANT_SYMBOL_LINE_STROKE_WIDTH
        )
        ctx.beginPath()
        for (const segment of command.segments) {
          ctx.moveTo(x + segment[0] * r, y + segment[1] * r)
          ctx.lineTo(x + segment[2] * r, y + segment[3] * r)
        }
        ctx.stroke()
        ctx.lineWidth = lineWidth
        break
    }
  }
}

function fillAndStrokeCanvasSymbolCommand(
  ctx: CanvasRenderingContext2D,
  fill: boolean,
  stroke: boolean,
  opacity: number,
): void {
  if (fill) {
    ctx.globalAlpha = 0.55 * opacity
    ctx.fill()
  }
  if (stroke) {
    ctx.globalAlpha = opacity
    ctx.stroke()
  }
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

function renderPinnedPlantNameLabels(ctx: CanvasRenderingContext2D, snapshot: SceneRendererSnapshot): void {
  const labels = snapshot.pinnedPlantNameLabels
  if (labels.length === 0) return
  const layer = getSceneLayerStyle(snapshot.scene, 'plants')
  if (!layer.visible) return
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  for (const label of labels) {
    ctx.fillStyle = getPlantLabelColor()
    ctx.globalAlpha = layer.opacity
    ctx.font = `${label.fontStyle === 'italic' ? 'italic ' : ''}600 12px Inter, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(label.text, label.screenPoint.x, label.screenPoint.y)
  }
  ctx.restore()
  ctx.globalAlpha = 1
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
