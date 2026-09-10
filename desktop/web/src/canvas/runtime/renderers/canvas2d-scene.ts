import { speciesFocusOpacity } from '../species-key'
import { instrumentSceneRenderer } from './profile'
import { getAnnotationPresentation } from '../annotation-layout'
import { getCanvasDetailLayout, getCanvasPlantNameLabels, isMeasurementLabelVisible } from '../automatic-detail'
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
  getPlantSymbolShapes,
  ROUND_PLANT_SYMBOL_RADIUS,
  tracePlantSymbolContour,
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
import { getRectangularZoneCorners } from '../zone-geometry'

export interface Canvas2DSceneSnapshotRenderOptions {
  readonly widthPx: number
  readonly heightPx: number
  readonly dpr?: number
  readonly background?: string | null
  readonly underlay?: ((ctx: CanvasRenderingContext2D, widthPx: number, heightPx: number) => void) | null
  readonly showPlantNames?: boolean
}

export function createCanvas2DSceneRenderer(): SceneRendererDefinition {
  return {
    id: 'canvas2d',
    supports(capabilities) {
      return capabilities.canvas2d
    },
    initialize(context) {
      const canvas = document.createElement('canvas')
      canvas.dataset.canopiRenderer = 'canvas2d'
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
        },
        renderScene(nextSnapshot) {
          snapshot = nextSnapshot
          redraw()
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

      return import.meta.env.DEV ? instrumentSceneRenderer(canvas, instance) : instance
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

  applyScreenSpaceTransform(ctx, dpr)
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
  renderMeasurementGuides(ctx, snapshot, dpr)
  renderPlants(ctx, snapshot, dpr)
  if (options.showPlantNames !== false) {
    renderPinnedPlantNameLabels(ctx, snapshot, dpr)
    renderSelectionLabels(ctx, snapshot, dpr)
  }
  renderAnnotations(ctx, snapshot, dpr)
}

function renderMeasurementGuides(
  ctx: CanvasRenderingContext2D,
  snapshot: SceneRendererSnapshot,
  dpr: number,
): void {
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
    ctx.lineWidth = (interactionVisual?.widthPx ?? .8) / viewportScale
    ctx.globalAlpha = (interactionVisual?.alpha ?? .25) * layer.opacity
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
  applyScreenSpaceTransform(ctx, dpr)
  ctx.font = `400 ${MEASUREMENT_GUIDE_LABEL_FONT_SIZE_PX}px Inter, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const guide of snapshot.scene.measurementGuides) {
    if (!isMeasurementLabelVisible(snapshot, guide.id)) continue
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
    ctx.lineWidth = (interactionVisual?.widthPx ?? 2) / snapshot.viewport.scale
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

function renderPlants(
  ctx: CanvasRenderingContext2D,
  snapshot: SceneRendererSnapshot,
  dpr: number,
): void {
  const layer = getSceneLayerStyle(snapshot.scene, 'plants')
  if (!layer.visible) return

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
    drawPlantSymbolGlyph(ctx, renderedSymbol, entry, layer.opacity * speciesFocusOpacity(snapshot.speciesFocus, entry.plant.canonicalName), snapshot.viewport.scale)

    if (selected) {
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
      drawStackBadge(ctx, entry, stackCount, layer.opacity, dpr)
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
  opacity: number,
  viewportScale: number,
): void {
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
  ctx.font = '9px Inter, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(count), x, y)
  ctx.restore()
}

function renderAnnotations(
  ctx: CanvasRenderingContext2D,
  snapshot: SceneRendererSnapshot,
  dpr: number,
): void {
  const layer = getSceneLayerStyle(snapshot.scene, 'annotations')
  if (!layer.visible) return

  for (const annotation of snapshot.scene.annotations) {
    if (annotation.annotationType !== 'text') continue
    const interactionState = resolveInteractionState(
      snapshot.selectedAnnotationIds.has(annotation.id),
      false,
      hoverStateForTarget(snapshot, 'annotation', annotation.id),
    )
    const reveal = annotation.id === snapshot.revealedAnnotationId
      || (snapshot.hoverTarget?.kind === 'annotation' && snapshot.hoverTarget.id === annotation.id)
    drawAnnotationText(ctx, annotation, snapshot.viewport, interactionState, layer.opacity, dpr, reveal,
      getCanvasDetailLayout(snapshot.scene, snapshot.viewport.scale).annotationIds.has(annotation.id))
  }
}

function drawAnnotationText(
  ctx: CanvasRenderingContext2D,
  annotation: SceneAnnotationEntity,
  viewport: SceneViewportState,
  interactionState: CanvasInteractionVisualState | null,
  opacity: number,
  dpr: number,
  revealText: boolean,
  textAllowed: boolean,
): void {
  const { frame, textFrame, textOpacity, markerOpacity, markerPaths, markerStrokePx } = getAnnotationPresentation(annotation, viewport, revealText, textAllowed)
  const lines = annotation.text.split('\n')

  ctx.save()
  applyScreenSpaceTransform(ctx, dpr)
  if (markerOpacity > 0) {
    ctx.strokeStyle = getAnnotationTextColor()
    ctx.globalAlpha = opacity * markerOpacity
    ctx.lineWidth = markerStrokePx
    ctx.beginPath()
    for (const path of markerPaths) {
      path.forEach((point, index) => {
        const x = textFrame.origin.x + point.x
        const y = textFrame.origin.y + point.y
        if (index === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
    }
    ctx.stroke()
  }
  if (interactionState) {
    const visual = getCanvasInteractionStrokeVisual(interactionState)
    ctx.save()
    ctx.translate(frame.origin.x, frame.origin.y)
    ctx.rotate((frame.rotationDeg * Math.PI) / 180)
    ctx.strokeStyle = visual.color
    ctx.globalAlpha = visual.alpha * opacity
    ctx.lineWidth = visual.widthPx
    ctx.strokeRect(-4, -2, frame.widthPx + 8, frame.heightPx + 4)
    ctx.restore()
  }
  if (textOpacity > 0) {
    ctx.translate(textFrame.origin.x, textFrame.origin.y)
    ctx.rotate((textFrame.rotationDeg * Math.PI) / 180)
    ctx.font = `${annotation.fontSize}px Inter, sans-serif`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillStyle = getAnnotationTextColor()
    ctx.globalAlpha = opacity * textOpacity
    lines.forEach((line, index) => {
      ctx.fillText(line, 0, index * textFrame.lineHeightPx)
    })
  }
  ctx.restore()
}

function renderSelectionLabels(
  ctx: CanvasRenderingContext2D,
  snapshot: SceneRendererSnapshot,
  dpr: number,
): void {
  if (snapshot.selectionLabels.length === 0) return
  ctx.save()
  applyScreenSpaceTransform(ctx, dpr)
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

function renderPinnedPlantNameLabels(
  ctx: CanvasRenderingContext2D,
  snapshot: SceneRendererSnapshot,
  dpr: number,
): void {
  const labels = getCanvasPlantNameLabels(snapshot)
  if (labels.length === 0) return
  const layer = getSceneLayerStyle(snapshot.scene, 'plants')
  if (!layer.visible) return
  ctx.save()
  applyScreenSpaceTransform(ctx, dpr)
  for (const label of labels) {
    ctx.fillStyle = getPlantLabelColor()
    ctx.globalAlpha = layer.opacity * label.opacity
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

function applyScreenSpaceTransform(ctx: CanvasRenderingContext2D, dpr: number): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
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
