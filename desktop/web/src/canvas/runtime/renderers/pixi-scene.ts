import { CANVAS_CHROME_FONT_FAMILY } from '../../chrome-fonts'
import { SPECIES_FOCUS_DIM_OPACITY, speciesFocusOpacity } from '../species-key'
// Production CSP rejects Pixi's generated functions; its shim avoids eval.
import 'pixi.js/unsafe-eval'
import { AlphaFilter, Container, Graphics, GraphicsContext, Rectangle, Text, TextStyle, type TextStyleOptions } from 'pixi.js'
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
  STACK_BADGE_FONT_SIZE_PX,
  getStackBadgeSizePx,
  type PlantPresentationEntry,
} from '../plant-presentation'
import {
  getPlantSymbolArt,
  ROUND_PLANT_SYMBOL_RADIUS,
  tracePlantSymbolContours,
} from '../plant-symbol-recipes'
import type { PlantNameLabel } from '../selection-labels'
import { SceneViewportPresentation } from './viewport-presentation'
import { getCanvasDetailLayout, isMeasurementLabelVisible } from '../automatic-detail'
import {
  getAnnotationTextColor,
  getCanvasInteractionStrokeVisual,
  getGuideLineVisual,
  getLabelHalo,
  getMapBackdropInk,
  getPlantSymbolEdgeColor,
  getPlantSymbolEdgeWidth,
  getPlantLabelColor,
  getSceneLayerStyle,
  getStackBadgeBackgroundColor,
  getStackBadgeTextColor,
  MIN_PLANT_RING_RADIUS_PX,
  OVERLAY_CASING_EXTRA_PX,
  resolveZoneVisual,
  type CanvasInteractionStrokeVisual,
  type CanvasInteractionVisualState,
} from '../scene-visuals'
import type { SceneRendererHoverState, SceneRendererSnapshot } from './scene-types'
import { createDraftLayer, type DraftScenePainters } from './draft-layer'
import type { DraftPresentation } from '../tools/draft'
import { getEllipticalZonePolygon, getRectangularZoneCorners } from '../zone-geometry'
import type { PlantSymbolId, SceneAnnotationEntity, SceneMeasurementGuideEntity, ScenePlantEntity, ScenePoint, SceneZoneEntity } from '../scene'
import { isSceneObjectGroupMemberTarget } from '../scene'

const ZONE_STROKE_PX = 2
const MEASUREMENT_GUIDE_STROKE_PX = 1.5
/** Plant a row's disc: today's 2 px border-box border keeps it at least 4 px across (today's (a4c86d39) plant-spacing-overlay.ts). */
const DOT_GHOST_MIN_RADIUS_PX = 2
const graphicsKeys = new WeakMap<Graphics, string>()

type PixiSceneWorkName = 'plantObjects' | 'plantCull' | 'plantEntries' | 'plantLayout' | 'plantDraw'

declare global {
  interface Window {
    __CANOPI_PIXI_SCENE_WORK__?: (name: PixiSceneWorkName, durationMs: number) => void
  }
}

function measurePixiSceneWork<T>(name: PixiSceneWorkName, operation: () => T): T {
  const observer = import.meta.env.DEV ? window.__CANOPI_PIXI_SCENE_WORK__ : undefined
  if (!observer) return operation()
  const startedAt = performance.now()
  try {
    return operation()
  } finally {
    observer(name, performance.now() - startedAt)
  }
}

/** Keeps exact current and two prior plant geometry generations while bounding zoom churn. */
class PlantGraphicsContextCache {
  private current = new Map<string, GraphicsContext>()
  private recent = new Map<string, GraphicsContext>()
  private older = new Map<string, GraphicsContext>()
  private disposed = false

  beginGeneration(): void {
    this.destroyContexts(this.older)
    this.older = this.recent
    this.recent = this.current
    this.current = new Map()
  }

  acquire(key: string): { context: GraphicsContext; created: boolean } {
    const current = this.current.get(key)
    if (current) return { context: current, created: false }
    const recent = this.recent.get(key)
    if (recent) {
      this.recent.delete(key)
      this.current.set(key, recent)
      return { context: recent, created: false }
    }
    const older = this.older.get(key)
    if (older) {
      this.older.delete(key)
      this.current.set(key, older)
      return { context: older, created: false }
    }
    const context = new GraphicsContext()
    this.current.set(key, context)
    return { context, created: true }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.destroyContexts(this.current)
    this.destroyContexts(this.recent)
    this.destroyContexts(this.older)
    this.current.clear()
    this.recent.clear()
    this.older.clear()
  }

  private destroyContexts(contexts: ReadonlyMap<string, GraphicsContext>): void {
    for (const context of contexts.values()) context.destroy()
  }
}

interface CachedPlantStackCounts {
  readonly plants: readonly ScenePlantEntity[]
  readonly selectedPlantIds: ReadonlySet<string>
  readonly stackCounts: ReadonlyMap<string, number>
}

class PlantStackCountsCache {
  private readonly entries: CachedPlantStackCounts[] = []

  get(
    presentationEntries: readonly PlantPresentationEntry[],
    selectedPlantIds: ReadonlySet<string>,
    viewportScale: number,
  ): ReadonlyMap<string, number> {
    const matchIndex = this.entries.findIndex((candidate) =>
      samePlantSelection(candidate.selectedPlantIds, selectedPlantIds)
      && candidate.plants.length === presentationEntries.length
      && candidate.plants.every((plant, index) => plant === presentationEntries[index]?.plant))
    if (matchIndex >= 0) {
      const [match] = this.entries.splice(matchIndex, 1)
      this.entries.unshift(match!)
      return match!.stackCounts
    }
    const stackCounts = layoutPlantPresentation(presentationEntries, viewportScale).stackCounts
    this.entries.unshift({
      plants: presentationEntries.map((entry) => entry.plant),
      selectedPlantIds: new Set(selectedPlantIds),
      stackCounts,
    })
    if (this.entries.length > 2) this.entries.pop()
    return stackCounts
  }
}

function samePlantSelection(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((plantId) => right.has(plantId))
}

/**
 * Retained botanical presentation. The MapLibre custom layer owns the stage,
 * the shared WebGL context and frame submission; this graph only syncs scene
 * content into it, and the active tool's draft over it (`draft-layer.ts`).
 */
export interface PixiScenePresentation {
  dispose(): void
  resize(width: number, height: number): void
  renderScene(snapshot: SceneRendererSnapshot): void
  setViewport(viewport: SceneRendererSnapshot['viewport']): void
  setDraft(draft: DraftPresentation | null): void
}

export interface PixiScenePresentationOptions {
  readonly stage: Container
  readonly createText: () => Text
  readonly viewSize: { width: number; height: number }
  /** Asks the host for a frame when the presentation changed outside a render (a draft chip's font arrived). */
  readonly requestRepaint?: () => void
}

export function createPixiScenePresentation(options: PixiScenePresentationOptions): PixiScenePresentation {
  const { stage, createText, viewSize } = options
  const world = new Container()
  const zonesLayer = new Container()
  const measurementGuideLayer = new Container()
  const plantLayers = createPlantLayers(viewSize)
  const plantsOverlayLayer = new Container()
  const annotationTextLayer = new Container()
  const annotationHighlightLayer = new Container()
  world.addChild(zonesLayer)
  world.addChild(measurementGuideLayer)
  // Rasterize text and tessellate symbols at their readable CSS-pixel size.
  // Tiny world-unit primitives lose detail before the camera enlarges them.
  const screen = new Container()
  screen.addChild(plantLayers.root)
  screen.addChild(plantsOverlayLayer)
  screen.addChild(annotationTextLayer)
  screen.addChild(annotationHighlightLayer)
  const measurementGuideLabelLayer = new Container()
  const pinnedPlantNameLabelLayer = new Container()
  const selectionLabelLayer = new Container()
  stage.addChild(world)
  stage.addChild(screen)
  stage.addChild(measurementGuideLabelLayer)
  stage.addChild(pinnedPlantNameLabelLayer)
  stage.addChild(selectionLabelLayer)

  const presentation = new SceneViewportPresentation()
  // Drafts draw over plants, notes and labels, as the DOM previews did over the canvas.
  const draftLayer = createDraftLayer({
    createText,
    viewSize,
    requestRepaint: options.requestRepaint,
    painters: createDraftScenePainters(() => presentation.current?.snapshot ?? null),
  })
  stage.addChild(draftLayer.world)
  stage.addChild(draftLayer.screen)
  const zoneGraphicsById = new Map<string, Graphics>()
  const measurementGuideGraphicsById = new Map<string, Graphics>()
  const measurementGuideLabelById = new Map<string, Text>()
  const plantGraphicsById = new Map<string, Graphics>()
  const plantRingGraphicsById = new Map<string, Graphics>()
  // Passing one external empty context avoids the unused owned context that
  // `new Graphics()` would otherwise allocate for every Plant before its exact
  // shared geometry is assigned.
  const emptyPlantGraphicsContext = new GraphicsContext()
  const visiblePlantIds = new Set<string>()
  const plantGraphicsContexts = new PlantGraphicsContextCache()
  const plantStackCounts = new PlantStackCountsCache()
  const plantBadgeGraphicsById = new Map<string, Graphics>()
  const plantBadgeTextById = new Map<string, Text>()
  const annotationTextById = new Map<string, Text>()
  const annotationHighlightById = new Map<string, Graphics>()
  const pinnedPlantNameLabelById = new Map<string, Text>()
  const selectionLabelBySpecies = new Map<string, Text>()

  return {
    dispose() {
      draftLayer.dispose()
      presentation.dispose()
      for (const graphics of plantGraphicsById.values()) {
        graphics.removeFromParent()
        destroySharedPlantGraphics(graphics)
      }
      plantGraphicsById.clear()
      for (const ring of plantRingGraphicsById.values()) ring.destroy()
      plantRingGraphicsById.clear()
      plantLayers.dispose()
      visiblePlantIds.clear()
      emptyPlantGraphicsContext.destroy()
      plantGraphicsContexts.dispose()
    },
    resize(width, height) {
      viewSize.width = width
      viewSize.height = height
      plantLayers.resize(width, height)
      draftLayer.resize(width, height)
    },
    renderScene(nextSnapshot) {
      const { plantNameLabels } = presentation.setScene(nextSnapshot)
      syncZones(zonesLayer, zoneGraphicsById, nextSnapshot, true)
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
        plantLayers,
        plantsOverlayLayer,
        plantGraphicsById,
        plantRingGraphicsById,
        emptyPlantGraphicsContext,
        visiblePlantIds,
        plantGraphicsContexts,
        plantStackCounts,
        plantBadgeGraphicsById,
        plantBadgeTextById,
        viewSize,
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
      syncPinnedPlantNameLabels(createText, pinnedPlantNameLabelLayer, pinnedPlantNameLabelById, nextSnapshot, plantNameLabels)
      syncSelectionLabels(createText, selectionLabelLayer, selectionLabelBySpecies, nextSnapshot)
      world.position.set(nextSnapshot.viewport.x, nextSnapshot.viewport.y)
      world.scale.set(nextSnapshot.viewport.scale)
      draftLayer.place(nextSnapshot.viewport, nextSnapshot.viewport.scale)
    },
    setViewport(viewport) {
      const current = presentation.setViewport(viewport)
      if (!current) return
      const { snapshot, plantNameLabels } = current
      syncZones(zonesLayer, zoneGraphicsById, snapshot, false)
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
        plantLayers,
        plantsOverlayLayer,
        plantGraphicsById,
        plantRingGraphicsById,
        emptyPlantGraphicsContext,
        visiblePlantIds,
        plantGraphicsContexts,
        plantStackCounts,
        plantBadgeGraphicsById,
        plantBadgeTextById,
        viewSize,
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
      syncPinnedPlantNameLabels(createText, pinnedPlantNameLabelLayer, pinnedPlantNameLabelById, snapshot, plantNameLabels)
      syncSelectionLabels(createText, selectionLabelLayer, selectionLabelBySpecies, snapshot)
      world.position.set(viewport.x, viewport.y)
      world.scale.set(viewport.scale)
      draftLayer.place(viewport, viewport.scale)
    },
    setDraft(draft) {
      draftLayer.setDraft(draft)
    },
  }
}

/**
 * The scene's own drawing code, lent to the draft layer so a placement ghost
 * looks like the object a click would create: zones in world units, plant
 * marks and note text at the local origin in CSS px. Plants are presented
 * with the last scene snapshot's plant context.
 */
export function createDraftScenePainters(getSnapshot: () => SceneRendererSnapshot | null): DraftScenePainters {
  return {
    paint: (color) => ({ color: toPixiColor(color, 0), alpha: cssColorAlpha(color) }),
    screenPxToWorldPx,
    drawZoneGhost(graphics, zone, viewportScale) {
      // Today's ghost: the zone's fill at a fifth and its stroke, with round ends and no casing.
      const visual = resolveZoneVisual(zone)
      if (!traceZonePath(graphics, zone)) return false
      if (zone.zoneType !== 'line') graphics.fill({ color: toPixiColor(visual.fill, 0), alpha: 0.2 * cssColorAlpha(visual.fill) })
      graphics.stroke({
        color: toPixiColor(visual.stroke, 0),
        alpha: cssColorAlpha(visual.stroke),
        width: screenPxToWorldPx(ZONE_STROKE_PX, viewportScale),
        cap: 'round',
        join: 'round',
      })
      return true
    },
    drawPlantGhost(graphics, plant, mark, viewportScale, sizeFrom) {
      const snapshot = getSnapshot()
      if (!snapshot) return false
      // A dot's radius is the presentation at sizeFrom (Plant a row: the source plant's), so the whole row has one size.
      const presented = mark === 'dot' && sizeFrom ? { ...plant, position: sizeFrom } : plant
      const [entry] = buildPlantPresentationEntries([presented], {
        plants: snapshot.scene.plants,
        viewport: { x: 0, y: 0, scale: viewportScale },
        speciesCache: snapshot.speciesCache,
        plantSpeciesSymbols: snapshot.scene.plantSpeciesSymbols,
        localizedCommonNames: snapshot.localizedCommonNames,
      }, new Set())
      if (!entry) return false
      // Plant a row's look: a disc in the display colour, its 2 px border the same colour, so never under 2 px in radius.
      if (mark === 'dot') graphics.circle(0, 0, Math.max(entry.radiusScreenPx, DOT_GHOST_MIN_RADIUS_PX)).fill({ color: toPixiColor(entry.color, 0) })
      else drawPlantGlyph(graphics.context, entry)
      return true
    },
    drawNoteGhost(text, marker, annotation, viewportScale) {
      if (annotation.annotationType !== 'text') return null
      const { textFrame, textOpacity, markerOpacity, markerPaths, markerStrokePx } =
        getAnnotationPresentation(annotation, { x: 0, y: 0, scale: viewportScale })
      styleAnnotationText(text, annotation, textFrame.lineHeightPx)
      // Today's ghost marker has no halo.
      traceAnnotationMarker(marker, markerPaths, { x: 0, y: 0 })
      marker.stroke({ color: toPixiColor(getAnnotationTextColor(), 0), width: markerStrokePx })
      return { textOpacity, markerOpacity }
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
  if (!layer.visible) {
    if (reconcileRemoved) {
      const keep = new Set(snapshot.scene.measurementGuides.map((guide) => guide.id))
      destroyEntriesNotIn(graphicsById, keep)
      destroyEntriesNotIn(labelById, keep)
    }
    return
  }

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
    setTextStyle(text, {
      fontFamily: CANVAS_CHROME_FONT_FAMILY,
      fontSize: MEASUREMENT_GUIDE_LABEL_FONT_SIZE_PX,
      // Map text follows the backdrop; the guide's own stroke carries the interaction state.
      fill: toPixiColor(getAnnotationTextColor(), 0),
      stroke: labelHaloStroke(MEASUREMENT_GUIDE_LABEL_FONT_SIZE_PX),
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
  const stroke = resolveCasedStroke(interactionVisual, getGuideLineVisual(), MEASUREMENT_GUIDE_STROKE_PX, viewportScale)
  if (reuseGeometry(graphics, [guide.start, guide.end, stroke, viewportScale])) return
  graphics.clear()
  const trace = () => {
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
  }
  trace()
  graphics.stroke(stroke.casing)
  trace()
  graphics.stroke(stroke.stroke)
}

interface CasedStroke {
  readonly casing: { color: number; width: number; alpha: number }
  readonly stroke: { color: number; width: number; alpha: number }
}

/** Resolves the interaction stroke, or the base overlay stroke, and the casing drawn under it. */
function resolveCasedStroke(
  interactionVisual: CanvasInteractionStrokeVisual | null,
  base: { color: string; casing: string },
  baseWidthPx: number,
  viewportScale: number,
): CasedStroke {
  return casedStroke(interactionVisual ?? {
    color: base.color,
    widthPx: baseWidthPx,
    alpha: 1,
    casingColor: base.casing,
    casingWidthPx: baseWidthPx + OVERLAY_CASING_EXTRA_PX,
  }, viewportScale)
}

/** Screen-pixel widths become world units under the camera transform (`viewportScale` 1 for CSS-pixel layers). */
function casedStroke(visual: CanvasInteractionStrokeVisual, viewportScale: number): CasedStroke {
  return {
    casing: {
      color: toPixiColor(visual.casingColor, 0),
      width: screenPxToWorldPx(visual.casingWidthPx, viewportScale),
      alpha: visual.alpha * cssColorAlpha(visual.casingColor),
    },
    stroke: {
      color: toPixiColor(visual.color, 0),
      width: screenPxToWorldPx(visual.widthPx, viewportScale),
      alpha: visual.alpha * cssColorAlpha(visual.color),
    },
  }
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
  zoneGraphicsById: Map<string, Graphics>,
  snapshot: SceneRendererSnapshot,
  reconcileRemoved: boolean,
): void {
  const layer = getSceneLayerStyle(snapshot.scene, 'zones')
  world.visible = layer.visible
  world.alpha = layer.opacity
  if (!layer.visible) {
    if (reconcileRemoved) destroyEntriesNotIn(zoneGraphicsById, new Set(snapshot.scene.zones.map((zone) => zone.id)))
    return
  }

  const nextZoneIds = new Set<string>()
  for (const zone of snapshot.scene.zones) {
    nextZoneIds.add(zone.id)
    const graphics = zoneGraphicsById.get(zone.id) ?? new Graphics()
    if (!zoneGraphicsById.has(zone.id)) {
      zoneGraphicsById.set(zone.id, graphics)
      world.addChild(graphics)
    }
    drawZone(
      graphics,
      zone,
      snapshot.selectedZoneIds.has(zone.id),
      snapshot.highlightedZoneIds.has(zone.id),
      hoverStateForTarget(snapshot, 'zone', zone.id),
      snapshot.viewport.scale,
    )
    graphics.visible = true
  }

  if (!reconcileRemoved) return
  for (const [zoneId, graphics] of zoneGraphicsById) {
    if (nextZoneIds.has(zoneId)) continue
    graphics.removeFromParent()
    graphics.destroy()
    zoneGraphicsById.delete(zoneId)
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
  const stroke = resolveCasedStroke(interactionVisual, { color: visual.stroke, casing: visual.casing }, ZONE_STROKE_PX, viewportScale)

  if (reuseGeometry(graphics, [zone.zoneType, zone.points, zone.rotationDeg, fillColor, fillAlpha, stroke])) return
  graphics.clear()

  if (!traceZonePath(graphics, zone)) return
  if (zone.zoneType !== 'line') graphics.fill({ color: fillColor, alpha: fillAlpha })
  graphics.stroke(stroke.casing)
  traceZonePath(graphics, zone)
  graphics.stroke(stroke.stroke)
}

/** Traces the zone outline; the caller fills and strokes it. Returns false when nothing is drawable. */
function traceZonePath(graphics: Graphics, zone: SceneZoneEntity): boolean {
  if (zone.zoneType === 'rect' && zone.points.length >= 4) {
    if (Math.abs(zone.rotationDeg) > 0.000001) {
      const corners = getRectangularZoneCorners(zone)
      if (!corners) return false
      drawClosedZonePath(graphics, corners)
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
      drawClosedZonePath(graphics, polygon)
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

/**
 * Plant symbols draw opaque into containers that apply opacity once, as a
 * composite: Pixi multiplies a container's alpha into every triangle, so the
 * overlapping contours of one symbol (and its halo under the fill) would show
 * darker. Species Focus dims the other plants through `dimmed`; the Plants
 * layer opacity applies to `root`. Interaction rings sit above both, so a
 * dimmed plant's selection ring stays at full strength. The filters run only
 * while something is dimmed or the layer is translucent.
 */
interface PlantLayers {
  readonly root: Container
  readonly dimmed: Container
  readonly symbols: Container
  readonly rings: Container
  setLayerOpacity(opacity: number): void
  setDimmed(active: boolean): void
  resize(width: number, height: number): void
  dispose(): void
}

function createPlantLayers(viewSize: { width: number; height: number }): PlantLayers {
  const root = new Container()
  const dimmed = new Container()
  const symbols = new Container()
  const rings = new Container()
  // Children keep scene order through zIndex, whichever container holds them.
  dimmed.sortableChildren = true
  symbols.sortableChildren = true
  root.addChild(dimmed)
  root.addChild(symbols)
  root.addChild(rings)
  // Plants draw in CSS pixels in the untransformed screen layer, so the view is the filter area.
  const area = new Rectangle(0, 0, viewSize.width, viewSize.height)
  const filterOptions = { resolution: 'inherit', antialias: 'inherit' } as const
  const layerFilter = new AlphaFilter({ alpha: 1, ...filterOptions })
  const dimFilter = new AlphaFilter({ alpha: SPECIES_FOCUS_DIM_OPACITY, ...filterOptions })
  root.filterArea = area
  dimmed.filterArea = area
  let layerFiltered = false
  let dimFiltered = false
  return {
    root,
    dimmed,
    symbols,
    rings,
    setLayerOpacity(opacity) {
      layerFilter.alpha = opacity
      const filtered = opacity < 1
      if (filtered !== layerFiltered) root.filters = filtered ? [layerFilter] : null
      layerFiltered = filtered
    },
    setDimmed(active) {
      if (active !== dimFiltered) dimmed.filters = active ? [dimFilter] : null
      dimFiltered = active
    },
    resize(width, height) {
      area.width = width
      area.height = height
    },
    dispose() {
      root.filters = null
      dimmed.filters = null
      layerFilter.destroy()
      dimFilter.destroy()
    },
  }
}

function syncPlants(
  createText: () => Text,
  layers: PlantLayers,
  overlay: Container,
  plantGraphicsById: Map<string, Graphics>,
  plantRingGraphicsById: Map<string, Graphics>,
  emptyPlantGraphicsContext: GraphicsContext,
  visiblePlantIds: Set<string>,
  plantGraphicsContexts: PlantGraphicsContextCache,
  plantStackCounts: PlantStackCountsCache,
  plantBadgeGraphicsById: Map<string, Graphics>,
  plantBadgeTextById: Map<string, Text>,
  viewSize: { width: number; height: number },
  snapshot: SceneRendererSnapshot,
  reconcileRemoved: boolean,
): void {
  const layer = getSceneLayerStyle(snapshot.scene, 'plants')
  layers.root.visible = layer.visible
  layers.setLayerOpacity(layer.opacity)
  overlay.visible = layer.visible
  overlay.alpha = layer.opacity
  if (!layer.visible) {
    if (reconcileRemoved) {
      const keep = new Set(snapshot.scene.plants.map((plant) => plant.id))
      destroyEntriesNotIn(plantGraphicsById, keep, destroySharedPlantGraphics)
      destroyEntriesNotIn(plantRingGraphicsById, keep)
      destroyEntriesNotIn(plantBadgeGraphicsById, keep)
      destroyEntriesNotIn(plantBadgeTextById, keep)
    }
    return
  }

  // Keep display order stable even when a previously unseen Plant enters the view.
  const nextIds = new Set<string>()
  measurePixiSceneWork('plantObjects', () => {
    snapshot.scene.plants.forEach((plant, index) => {
      nextIds.add(plant.id)
      let graphic = plantGraphicsById.get(plant.id)
      if (!graphic) {
        graphic = new Graphics(emptyPlantGraphicsContext)
        graphic.visible = false
        plantGraphicsById.set(plant.id, graphic)
        layers.symbols.addChild(graphic)
      }
      graphic.zIndex = index
    })
    for (const ring of plantRingGraphicsById.values()) ring.visible = false
    for (const badge of plantBadgeGraphicsById.values()) badge.visible = false
    for (const text of plantBadgeTextById.values()) text.visible = false
  })
  // Includes the largest symbolic footprint, interaction ring and stack badge.
  const margin = 32
  const visiblePlants = measurePixiSceneWork('plantCull', () => snapshot.scene.plants.filter(plant => {
    if (viewSize.width <= 0 || viewSize.height <= 0) return true
    const { x, y } = worldToScreen(plant.position, snapshot.viewport)
    return x >= -margin && y >= -margin && x <= viewSize.width + margin && y <= viewSize.height + margin
  }))
  const entries = measurePixiSceneWork('plantEntries', () => buildPlantPresentationEntries(visiblePlants, {
    plants: snapshot.scene.plants,
    viewport: snapshot.viewport,
    speciesCache: snapshot.speciesCache,
    plantSpeciesSymbols: snapshot.scene.plantSpeciesSymbols,
    localizedCommonNames: snapshot.localizedCommonNames,
  }, snapshot.selectedPlantIds))
  const stackCounts = measurePixiSceneWork('plantLayout', () => plantStackCounts.get(
    entries, snapshot.selectedPlantIds, snapshot.viewport.scale,
  ))
  const nextVisiblePlantIds = new Set(visiblePlants.map((plant) => plant.id))
  for (const plantId of visiblePlantIds) {
    if (nextVisiblePlantIds.has(plantId)) continue
    const graphic = plantGraphicsById.get(plantId)!
    graphic.visible = false
    // A hidden symbol must not keep a cache context alive or, worse, hold one
    // the cache retires two generations later: Pixi still validates hidden
    // renderables, and a destroyed context has no instructions to read.
    graphic.context = emptyPlantGraphicsContext
  }
  plantGraphicsContexts.beginGeneration()

  let anyDimmed = false
  measurePixiSceneWork('plantDraw', () => { for (const entry of entries) {
    const graphic = plantGraphicsById.get(entry.plant.id)!
    const dimmed = speciesFocusOpacity(snapshot.speciesFocus, entry.plant.canonicalName) < 1
    anyDimmed ||= dimmed
    const target = dimmed ? layers.dimmed : layers.symbols
    if (graphic.parent !== target) target.addChild(graphic)
    const { context, created } = plantGraphicsContexts.acquire(plantGeometryKey(entry))
    graphic.context = context
    graphic.position.set(entry.screenPoint.x, entry.screenPoint.y)
    if (created) drawPlantGlyph(context, entry)
    if (!visiblePlantIds.has(entry.plant.id)) graphic.visible = true

    const interactionState = resolvePlantInteractionState(
      entry,
      snapshot.hoveredCanonicalName,
      snapshot.highlightedPlantIds.has(entry.plant.id),
      hoverStateForTarget(snapshot, 'plant', entry.plant.id),
    )
    if (interactionState) {
      let ring = plantRingGraphicsById.get(entry.plant.id)
      if (!ring) {
        ring = new Graphics()
        plantRingGraphicsById.set(entry.plant.id, ring)
        layers.rings.addChild(ring)
      }
      drawPlantRing(ring, entry, interactionState)
      ring.visible = true
    }

    const stackCount = stackCounts.get(entry.plant.id)
    if (stackCount) {
      const badge = plantBadgeGraphicsById.get(entry.plant.id) ?? new Graphics()
      if (!plantBadgeGraphicsById.has(entry.plant.id)) {
        plantBadgeGraphicsById.set(entry.plant.id, badge)
        overlay.addChild(badge)
      }
      drawStackBadge(badge, entry, stackCount)
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
  } })

  layers.setDimmed(anyDimmed)
  visiblePlantIds.clear()
  for (const plantId of nextVisiblePlantIds) visiblePlantIds.add(plantId)

  if (!reconcileRemoved) return
  for (const [plantId, graphics] of plantGraphicsById) {
    if (nextIds.has(plantId)) continue
    graphics.removeFromParent()
    destroySharedPlantGraphics(graphics)
    plantGraphicsById.delete(plantId)
  }
  for (const [plantId, ring] of plantRingGraphicsById) {
    if (ring.visible) continue
    ring.removeFromParent()
    ring.destroy()
    plantRingGraphicsById.delete(plantId)
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

/** Pixi does not detach a destroyed Graphics from an externally owned context. */
/** Destroys every entry `keep` does not name; a Design switch behind a hidden layer must not retain the old objects. */
function destroyEntriesNotIn<T extends { removeFromParent(): void; destroy(): void }>(
  byId: Map<string, T>,
  keep: ReadonlySet<string>,
  destroy: (entry: T) => void = (entry) => entry.destroy(),
): void {
  for (const [id, entry] of byId) {
    if (keep.has(id)) continue
    entry.removeFromParent()
    destroy(entry)
    byId.delete(id)
  }
}

function destroySharedPlantGraphics(graphics: Graphics): void {
  // Rebinding uses Pixi's public context setter to detach both listeners from
  // the shared cache entry. The temporary context is then destroyed with the
  // Graphics, so neither side retains the other.
  graphics.context = new GraphicsContext()
  graphics.destroy({ context: true })
}

function plantGeometryKey(entry: PlantPresentationEntry): string {
  const renderedSymbol = resolveRenderedPlantSymbol(entry)
  const edgeColor = getPlantSymbolEdgeColor(entry.color)
  const edgeWidth = getPlantSymbolEdgeWidth(entry.radiusScreenPx * 2)
  return `${entry.radiusScreenPx}|${renderedSymbol}|${entry.lod}|${entry.color}|${edgeColor}|${edgeWidth}`
}

/** The symbol alone, opaque; its container applies any dimming or layer opacity once. */
function drawPlantGlyph(graphics: GraphicsContext, entry: PlantPresentationEntry): void {
  drawPlantSymbolGlyph(graphics, resolveRenderedPlantSymbol(entry), { ...entry, screenPoint: { x: 0, y: 0 } })
}

function drawPlantRing(ring: Graphics, entry: PlantPresentationEntry, state: CanvasInteractionVisualState): void {
  // Plants draw in the CSS-pixel layer, so ring widths need no camera scaling.
  const visual = casedStroke(getCanvasInteractionStrokeVisual(state), 1)
  const r = entry.radiusScreenPx
  const radius = entry.selected ? r : Math.max(r * 1.4, MIN_PLANT_RING_RADIUS_PX)
  ring.clear()
  ring.position.set(entry.screenPoint.x, entry.screenPoint.y)
  ring.circle(0, 0, radius).stroke(visual.casing)
  ring.circle(0, 0, radius).stroke(visual.stroke)
}

function resolveRenderedPlantSymbol(entry: PlantPresentationEntry): PlantSymbolId {
  return entry.lod === 'dot' || entry.usesCanopyRadius ? 'round' : entry.symbol
}

function drawPlantSymbolGlyph(graphics: GraphicsContext, symbol: PlantSymbolId, entry: PlantPresentationEntry): void {
  const { x, y } = entry.screenPoint
  const r = entry.radiusScreenPx
  const color = toPixiColor(entry.color, 0)
  if (entry.lod === 'dot' || symbol === 'round') {
    graphics.circle(x, y, entry.lod === 'dot' ? r : r * ROUND_PLANT_SYMBOL_RADIUS).fill({ color })
    const width = getPlantSymbolEdgeWidth(r * 2)
    if (entry.lod !== 'dot' && width > 0) graphics.stroke({ color: toPixiColor(getPlantSymbolEdgeColor(entry.color), 0), width })
    return
  }
  const edge = toPixiColor(getPlantSymbolEdgeColor(entry.color), 0)
  const width = getPlantSymbolEdgeWidth(r * 2)
  const art = getPlantSymbolArt(symbol, r * 2)
  // Halo under the whole silhouette (unless Outline is off), then the body, then cut-outs in the outline colour.
  if (width > 0) {
    tracePlantSymbolContours(graphics, art.body, x, y, r)
    graphics.stroke({ color: edge, width, join: 'round', cap: 'round' })
  }
  tracePlantSymbolContours(graphics, art.body, x, y, r)
  graphics.fill({ color })
  if (art.cutouts.length === 0) return
  tracePlantSymbolContours(graphics, art.cutouts, x, y, r)
  graphics.fill({ color: edge })
}

function screenPxToWorldPx(px: number, viewportScale: number): number {
  return px / Math.max(viewportScale, 0.001)
}

function drawStackBadge(
  badge: Graphics,
  entry: ReturnType<typeof buildPlantPresentationEntries>[number],
  stackCount: number,
): void {
  const offset = getStackBadgeOffsetPx(entry.radiusScreenPx)
  const size = getStackBadgeSizePx(String(stackCount))
  badge.clear()
  badge.roundRect(
    entry.screenPoint.x + offset.x - size.width / 2,
    entry.screenPoint.y + offset.y - size.height / 2,
    size.width,
    size.height,
    size.height / 2,
  ).fill({ color: toPixiColor(getStackBadgeBackgroundColor(), 0), alpha: 1 })
}

function drawStackBadgeText(
  badgeText: Text,
  entry: ReturnType<typeof buildPlantPresentationEntries>[number],
  stackCount: number,
): void {
  const offset = getStackBadgeOffsetPx(entry.radiusScreenPx)
  badgeText.text = String(stackCount)
  setTextStyle(badgeText, {
    fontFamily: CANVAS_CHROME_FONT_FAMILY,
    fontSize: STACK_BADGE_FONT_SIZE_PX,
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
  if (!layer.visible) {
    if (reconcileRemoved) {
      const keep = new Set(snapshot.scene.annotations.map((annotation) => annotation.id))
      destroyEntriesNotIn(annotationTextById, keep)
      destroyEntriesNotIn(annotationHighlightById, keep)
    }
    return
  }

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
  styleAnnotationText(text, annotation, getAnnotationPresentation(annotation, viewport).textFrame.lineHeightPx)
  const origin = worldToScreen(annotation.position, viewport)
  text.position.set(origin.x, origin.y)
}

/** A note's text, style and angle; the caller places it at the note's screen point. */
function styleAnnotationText(text: Text, annotation: SceneAnnotationEntity, lineHeightPx: number): void {
  text.text = annotation.text
  setTextStyle(text, {
    fontFamily: CANVAS_CHROME_FONT_FAMILY,
    fontSize: annotation.fontSize,
    lineHeight: lineHeightPx,
    fill: getAnnotationTextColor(),
    stroke: labelHaloStroke(annotation.fontSize),
  })
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
    traceAnnotationMarker(graphics, markerPaths, origin)
    graphics.stroke({ color: toPixiColor(getMapBackdropInk().halo, 0),
      width: markerStrokePx + OVERLAY_CASING_EXTRA_PX, alpha: markerOpacity, cap: 'round', join: 'round' })
    traceAnnotationMarker(graphics, markerPaths, origin)
    graphics.stroke({ color: toPixiColor(getAnnotationTextColor(), 0),
      width: markerStrokePx, alpha: markerOpacity })
  }
  if (state) {
    const corners = getAnnotationVisualWorldCorners(annotation, viewport.scale, revealText, { x: 4, y: 2 }, textAllowed)
      .map((point) => worldToScreen(point, viewport))
    const outline = casedStroke(getCanvasInteractionStrokeVisual(state), 1)
    drawClosedZonePath(graphics, corners).stroke(outline.casing)
    drawClosedZonePath(graphics, corners).stroke(outline.stroke)
  }
}

function traceAnnotationMarker(
  graphics: Graphics,
  markerPaths: readonly (readonly ScenePoint[])[],
  origin: ScenePoint,
): void {
  for (const path of markerPaths) {
    path.forEach((point, index) => {
      const x = origin.x + point.x
      const y = origin.y + point.y
      if (index === 0) graphics.moveTo(x, y)
      else graphics.lineTo(x, y)
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
    setTextStyle(text, {
      fontFamily: CANVAS_CHROME_FONT_FAMILY,
      fontSize: 12,
      fontWeight: '600',
      fontStyle: label.fontStyle,
      fill: toPixiColor(getPlantLabelColor(), 0),
      stroke: labelHaloStroke(12),
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
  labels: readonly PlantNameLabel[],
): void {
  const plantLayer = getSceneLayerStyle(snapshot.scene, 'plants')
  layer.visible = plantLayer.visible
  layer.alpha = plantLayer.opacity
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
      setTextStyle(text, {
        fontFamily: CANVAS_CHROME_FONT_FAMILY,
        fontSize: 12,
        fontWeight: '600',
        fontStyle: label.fontStyle,
        fill: toPixiColor(getPlantLabelColor(), 0),
        stroke: labelHaloStroke(12),
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
  if (channels?.length === 4) return Number.parseFloat(channels[3]!)
  return parseHexColor(color)?.alpha ?? 1
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

  const hex = parseHexColor(color)
  return hex ? hex.rgb : value
}

// `#RGB`, `#RGBA`, `#RRGGBB` and `#RRGGBBAA`; anything else (named colours,
// hsl()) is not a colour this renderer knows and keeps the fallback.
function parseHexColor(color: string): { rgb: number; alpha: number } | null {
  const match = color.trim().match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i)
  if (!match) return null
  let digits = match[1]!
  if (digits.length <= 4) digits = [...digits].map((digit) => digit + digit).join('')
  const rgb = Number.parseInt(digits.slice(0, 6), 16)
  const alpha = digits.length === 8 ? Number.parseInt(digits.slice(6), 16) / 255 : 1
  return { rgb, alpha }
}

/**
 * A plant's ring state: selection first, then the map hover, then a panel's
 * highlight, then the species under the pointer.
 */
function resolvePlantInteractionState(
  entry: PlantPresentationEntry,
  hoveredCanonicalName: string | null,
  highlighted: boolean,
  hoverState: SceneRendererHoverState | null,
): CanvasInteractionVisualState | null {
  if (entry.selected) return 'selected'
  if (hoverState) return hoverState
  if (highlighted) return 'highlight'
  return hoveredCanonicalName && entry.plant.canonicalName === hoveredCanonicalName ? 'hover' : null
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

const textStyleKeys = new WeakMap<Text, string>()

/** The halo under map text, so it reads on the backdrop and on busy imagery. */
function labelHaloStroke(fontSizePx: number): { color: number; width: number; join: 'round' } {
  const halo = getLabelHalo(fontSizePx)
  return { color: toPixiColor(halo.color, 0), width: halo.widthPx, join: 'round' }
}

function setTextStyle(text: Text, options: TextStyleOptions): void {
  const key = JSON.stringify(options)
  if (textStyleKeys.get(text) === key) return
  text.style = new TextStyle(options)
  textStyleKeys.set(text, key)
}

function reuseGeometry(graphics: Graphics, appearance: readonly unknown[]): boolean {
  const key = JSON.stringify(appearance)
  if (graphicsKeys.get(graphics) === key) return true
  graphicsKeys.set(graphics, key)
  return false
}
