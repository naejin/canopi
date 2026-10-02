/**
 * The scene's billboard root (spec §1.5): plants, their rings and stack
 * badges, notes, measurement-guide labels and plant names, drawn upright in CSS
 * px under an identity transform. Each sits at its world anchor projected
 * through `view.projectAnchors`, plus a CSS-px offset, so a pan moves them all
 * and a turned view keeps them upright; a note's text turns by its own angle
 * less the bearing. Plants are culled in screen space, as today. Labels are
 * admitted by `label-admission.ts` at today's cadence.
 */

// Production CSP rejects Pixi's generated functions; its shim avoids eval.
import 'pixi.js/unsafe-eval'
import { CANVAS_CHROME_FONT_FAMILY } from '../../chrome-fonts'
import { SPECIES_FOCUS_DIM_OPACITY, speciesFocusOpacity } from '../species-key'
import { AlphaFilter, Container, Graphics, GraphicsContext, Rectangle, type Text } from 'pixi.js'
import { getAnnotationPresentation, getAnnotationVisualWorldCorners } from '../annotation-layout'
import { getCanvasDetailLayout, isMeasurementLabelVisible } from '../automatic-detail'
import {
  createMeasurementGuidePresentation,
  MEASUREMENT_GUIDE_LABEL_FONT_SIZE_PX,
  measurementGuideLabelPoseIn,
} from '../measurement-guides'
import {
  buildPlantPresentationEntries,
  getStackBadgeOffsetPx,
  getStackBadgeSizePx,
  layoutPlantPresentation,
  STACK_BADGE_FONT_SIZE_PX,
  type PlantPresentationEntry,
} from '../plant-presentation'
import { getPlantSymbolArt, ROUND_PLANT_SYMBOL_RADIUS, tracePlantSymbolContours } from '../plant-symbol-recipes'
import type { PlantSymbolId, SceneAnnotationEntity, ScenePlantEntity, ScenePoint } from '../scene'
import {
  getAnnotationTextColor,
  getCanvasInteractionStrokeVisual,
  getMapBackdropInk,
  getPlantLabelColor,
  getPlantSymbolEdgeColor,
  getPlantSymbolEdgeWidth,
  getSceneLayerStyle,
  getStackBadgeBackgroundColor,
  getStackBadgeTextColor,
  MIN_PLANT_RING_RADIUS_PX,
  OVERLAY_CASING_EXTRA_PX,
  type CanvasInteractionVisualState,
} from '../scene-visuals'
import type { PlantNameLabel, SelectionLabel } from '../selection-labels'
import type { ViewTransform } from '../view/types'
import { LabelAdmission } from './label-admission'
import {
  casedStroke,
  destroyEntriesNotIn,
  drawClosedPath,
  hoverStateForTarget,
  interactionOutline,
  labelHaloStroke,
  resolveInteractionState,
  setTextStyle,
  toPixiColor,
} from './scene-paint'
import type { SceneRendererHoverState, SceneRendererSnapshot } from './scene-types'

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

export interface BillboardLayer {
  /** Plants, rings, badges, notes and labels, in CSS px; stays untransformed. */
  readonly root: Container
  syncScene(snapshot: SceneRendererSnapshot): void
  setView(view: ViewTransform): void
  resize(width: number, height: number): void
  dispose(): void
}

export interface BillboardLayerOptions {
  readonly createText: () => Text
  readonly viewSize: { width: number; height: number }
}

/** Bulk projection through `view.projectAnchors`, with buffers kept between frames. */
class AnchorProjection {
  private world = new Float64Array(0)
  private screen = new Float32Array(0)

  /** CSS px of each point, as [x0, y0, x1, y1, …]; valid until the next call. */
  project(view: ViewTransform, points: readonly ScenePoint[]): Float32Array {
    const count = points.length
    if (this.world.length < count * 2) {
      this.world = new Float64Array(count * 2)
      this.screen = new Float32Array(count * 2)
    }
    for (let index = 0; index < count; index++) {
      this.world[index * 2] = points[index]!.x
      this.world[index * 2 + 1] = points[index]!.y
    }
    view.projectAnchors(this.world, this.screen, count)
    return this.screen
  }
}

export function createBillboardLayer(options: BillboardLayerOptions): BillboardLayer {
  const { createText, viewSize } = options
  const root = new Container()
  const plantLayers = createPlantLayers(viewSize)
  const plantsOverlayLayer = new Container()
  const annotationTextLayer = new Container()
  const annotationHighlightLayer = new Container()
  const measurementGuideLabelLayer = new Container()
  const plantNameLabelLayer = new Container()
  const selectionLabelLayer = new Container()
  root.addChild(plantLayers.root)
  root.addChild(plantsOverlayLayer)
  root.addChild(annotationTextLayer)
  root.addChild(annotationHighlightLayer)
  root.addChild(measurementGuideLabelLayer)
  root.addChild(plantNameLabelLayer)
  root.addChild(selectionLabelLayer)

  const labels = new LabelAdmission()
  const plants: PlantGraphics = {
    layers: plantLayers,
    overlay: plantsOverlayLayer,
    graphicsById: new Map(),
    ringById: new Map(),
    badgeById: new Map(),
    badgeTextById: new Map(),
    // Passing one external empty context avoids the unused owned context that
    // `new Graphics()` would otherwise allocate for every Plant before its exact
    // shared geometry is assigned.
    emptyContext: new GraphicsContext(),
    visibleIds: new Set(),
    contexts: new PlantGraphicsContextCache(),
    stackCounts: new PlantStackCountsCache(),
    projection: new AnchorProjection(),
  }
  const notes: NoteGraphics = {
    textLayer: annotationTextLayer,
    highlightLayer: annotationHighlightLayer,
    textById: new Map(),
    highlightById: new Map(),
  }
  const measurementLabelById = new Map<string, Text>()
  const plantNameLabelById = new Map<string, Text>()
  const selectionLabelBySpecies = new Map<string, Text>()
  const labelProjection = new AnchorProjection()
  let snapshot: SceneRendererSnapshot | null = null
  let view: ViewTransform | null = null
  let sceneSynced = false

  function present(reconcileRemoved: boolean): void {
    if (!snapshot || !view) return
    syncPlants(createText, plants, viewSize, snapshot, view, reconcileRemoved)
    syncAnnotations(createText, notes, snapshot, view, reconcileRemoved)
    syncMeasurementLabels(createText, measurementGuideLabelLayer, measurementLabelById, snapshot, view, reconcileRemoved)
    const admitted = labels.admit(view.pixelsPerMetre)!
    syncPlantNameLabels(createText, plantNameLabelLayer, plantNameLabelById, snapshot, view, labelProjection, admitted.plantNameLabels)
    syncSelectionLabels(createText, selectionLabelLayer, selectionLabelBySpecies, view, labelProjection, admitted.selectionLabels)
    sceneSynced = true
  }

  return {
    root,
    syncScene(next) {
      snapshot = next
      sceneSynced = false
      labels.setScene(next)
      present(true)
    },
    setView(next) {
      view = next
      present(!sceneSynced)
    },
    resize(width, height) {
      viewSize.width = width
      viewSize.height = height
      plantLayers.resize(width, height)
    },
    dispose() {
      labels.dispose()
      snapshot = null
      view = null
      for (const graphics of plants.graphicsById.values()) {
        graphics.removeFromParent()
        destroySharedPlantGraphics(graphics)
      }
      plants.graphicsById.clear()
      for (const ring of plants.ringById.values()) ring.destroy()
      plants.ringById.clear()
      plantLayers.dispose()
      plants.visibleIds.clear()
      plants.emptyContext.destroy()
      plants.contexts.dispose()
    },
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
    pixelsPerMetre: number,
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
    const stackCounts = layoutPlantPresentation(presentationEntries, pixelsPerMetre).stackCounts
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
  // Plants draw in CSS pixels in the untransformed billboard root, so the view is the filter area.
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

interface PlantGraphics {
  readonly layers: PlantLayers
  readonly overlay: Container
  readonly graphicsById: Map<string, Graphics>
  readonly ringById: Map<string, Graphics>
  readonly badgeById: Map<string, Graphics>
  readonly badgeTextById: Map<string, Text>
  readonly emptyContext: GraphicsContext
  readonly visibleIds: Set<string>
  readonly contexts: PlantGraphicsContextCache
  readonly stackCounts: PlantStackCountsCache
  readonly projection: AnchorProjection
}

function syncPlants(
  createText: () => Text,
  plants: PlantGraphics,
  viewSize: { width: number; height: number },
  snapshot: SceneRendererSnapshot,
  view: ViewTransform,
  reconcileRemoved: boolean,
): void {
  const { layers, overlay, graphicsById, ringById, badgeById, badgeTextById, emptyContext, visibleIds } = plants
  const layer = getSceneLayerStyle(snapshot.scene, 'plants')
  layers.root.visible = layer.visible
  layers.setLayerOpacity(layer.opacity)
  overlay.visible = layer.visible
  overlay.alpha = layer.opacity
  if (!layer.visible) {
    if (reconcileRemoved) {
      const keep = new Set(snapshot.scene.plants.map((plant) => plant.id))
      destroyEntriesNotIn(graphicsById, keep, destroySharedPlantGraphics)
      destroyEntriesNotIn(ringById, keep)
      destroyEntriesNotIn(badgeById, keep)
      destroyEntriesNotIn(badgeTextById, keep)
    }
    return
  }

  // Keep display order stable even when a previously unseen Plant enters the view.
  const nextIds = new Set<string>()
  measurePixiSceneWork('plantObjects', () => {
    snapshot.scene.plants.forEach((plant, index) => {
      nextIds.add(plant.id)
      let graphic = graphicsById.get(plant.id)
      if (!graphic) {
        graphic = new Graphics(emptyContext)
        graphic.visible = false
        graphicsById.set(plant.id, graphic)
        layers.symbols.addChild(graphic)
      }
      graphic.zIndex = index
    })
    for (const ring of ringById.values()) ring.visible = false
    for (const badge of badgeById.values()) badge.visible = false
    for (const text of badgeTextById.values()) text.visible = false
  })
  // Includes the largest symbolic footprint, interaction ring and stack badge.
  const margin = 32
  const projected = plants.projection.project(view, snapshot.scene.plants.map((plant) => plant.position))
  const screenPointById = new Map<string, ScenePoint>()
  const visiblePlants = measurePixiSceneWork('plantCull', () => snapshot.scene.plants.filter((plant, index) => {
    const x = projected[index * 2]!
    const y = projected[index * 2 + 1]!
    screenPointById.set(plant.id, { x, y })
    if (viewSize.width <= 0 || viewSize.height <= 0) return true
    return x >= -margin && y >= -margin && x <= viewSize.width + margin && y <= viewSize.height + margin
  }))
  const pixelsPerMetre = view.pixelsPerMetre
  const entries = measurePixiSceneWork('plantEntries', () => buildPlantPresentationEntries(visiblePlants, {
    plants: snapshot.scene.plants,
    viewport: { x: 0, y: 0, scale: pixelsPerMetre },
    speciesCache: snapshot.speciesCache,
    plantSpeciesSymbols: snapshot.scene.plantSpeciesSymbols,
    localizedCommonNames: snapshot.localizedCommonNames,
  }, snapshot.selectedPlantIds))
  const stackCounts = measurePixiSceneWork('plantLayout', () => plants.stackCounts.get(
    entries, snapshot.selectedPlantIds, pixelsPerMetre,
  ))
  const nextVisiblePlantIds = new Set(visiblePlants.map((plant) => plant.id))
  for (const plantId of visibleIds) {
    if (nextVisiblePlantIds.has(plantId)) continue
    const graphic = graphicsById.get(plantId)!
    graphic.visible = false
    // A hidden symbol must not keep a cache context alive or, worse, hold one
    // the cache retires two generations later: Pixi still validates hidden
    // renderables, and a destroyed context has no instructions to read.
    graphic.context = emptyContext
  }
  plants.contexts.beginGeneration()

  let anyDimmed = false
  measurePixiSceneWork('plantDraw', () => { for (const entry of entries) {
    const at = screenPointById.get(entry.plant.id)!
    const graphic = graphicsById.get(entry.plant.id)!
    const dimmed = speciesFocusOpacity(snapshot.speciesFocus, entry.plant.canonicalName) < 1
    anyDimmed ||= dimmed
    const target = dimmed ? layers.dimmed : layers.symbols
    if (graphic.parent !== target) target.addChild(graphic)
    const { context, created } = plants.contexts.acquire(plantGeometryKey(entry))
    graphic.context = context
    graphic.position.set(at.x, at.y)
    if (created) drawPlantGlyph(context, entry)
    if (!visibleIds.has(entry.plant.id)) graphic.visible = true

    const interactionState = resolvePlantInteractionState(
      entry,
      snapshot.hoveredCanonicalName,
      snapshot.highlightedPlantIds.has(entry.plant.id),
      hoverStateForTarget(snapshot, 'plant', entry.plant.id),
    )
    if (interactionState) {
      let ring = ringById.get(entry.plant.id)
      if (!ring) {
        ring = new Graphics()
        ringById.set(entry.plant.id, ring)
        layers.rings.addChild(ring)
      }
      drawPlantRing(ring, entry, interactionState)
      ring.position.set(at.x, at.y)
      ring.visible = true
    }

    const stackCount = stackCounts.get(entry.plant.id)
    if (stackCount) {
      const badge = badgeById.get(entry.plant.id) ?? new Graphics()
      if (!badgeById.has(entry.plant.id)) {
        badgeById.set(entry.plant.id, badge)
        overlay.addChild(badge)
      }
      drawStackBadge(badge, entry, stackCount)
      badge.position.set(at.x, at.y)
      badge.visible = true

      const badgeText = badgeTextById.get(entry.plant.id) ?? createText()
      if (!badgeTextById.has(entry.plant.id)) {
        badgeTextById.set(entry.plant.id, badgeText)
        overlay.addChild(badgeText)
      }
      drawStackBadgeText(badgeText, entry, stackCount, at)
      badgeText.visible = true
    } else if (reconcileRemoved) {
      const badge = badgeById.get(entry.plant.id)
      if (badge) {
        badge.removeFromParent()
        badge.destroy()
      }
      badgeById.delete(entry.plant.id)
      const badgeText = badgeTextById.get(entry.plant.id)
      if (badgeText) {
        badgeText.removeFromParent()
        badgeText.destroy()
      }
      badgeTextById.delete(entry.plant.id)
    } else {
      const badge = badgeById.get(entry.plant.id)
      if (badge) badge.visible = false
      const badgeText = badgeTextById.get(entry.plant.id)
      if (badgeText) badgeText.visible = false
    }
  } })

  layers.setDimmed(anyDimmed)
  visibleIds.clear()
  for (const plantId of nextVisiblePlantIds) visibleIds.add(plantId)

  if (!reconcileRemoved) return
  for (const [plantId, graphics] of graphicsById) {
    if (nextIds.has(plantId)) continue
    graphics.removeFromParent()
    destroySharedPlantGraphics(graphics)
    graphicsById.delete(plantId)
  }
  for (const [plantId, ring] of ringById) {
    if (ring.visible) continue
    ring.removeFromParent()
    ring.destroy()
    ringById.delete(plantId)
  }
  for (const [plantId, badge] of badgeById) {
    if (nextIds.has(plantId)) continue
    badge.removeFromParent()
    badge.destroy()
    badgeById.delete(plantId)
  }
  for (const [plantId, badgeText] of badgeTextById) {
    if (nextIds.has(plantId)) continue
    badgeText.removeFromParent()
    badgeText.destroy()
    badgeTextById.delete(plantId)
  }
}

/** Pixi does not detach a destroyed Graphics from an externally owned context. */
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

/** The symbol alone at the local origin, opaque; its container applies any dimming or layer opacity once. */
export function drawPlantGlyph(graphics: GraphicsContext, entry: PlantPresentationEntry): void {
  const symbol = resolveRenderedPlantSymbol(entry)
  const r = entry.radiusScreenPx
  const color = toPixiColor(entry.color, 0)
  if (entry.lod === 'dot' || symbol === 'round') {
    graphics.circle(0, 0, entry.lod === 'dot' ? r : r * ROUND_PLANT_SYMBOL_RADIUS).fill({ color })
    const width = getPlantSymbolEdgeWidth(r * 2)
    if (entry.lod !== 'dot' && width > 0) graphics.stroke({ color: toPixiColor(getPlantSymbolEdgeColor(entry.color), 0), width })
    return
  }
  const edge = toPixiColor(getPlantSymbolEdgeColor(entry.color), 0)
  const width = getPlantSymbolEdgeWidth(r * 2)
  const art = getPlantSymbolArt(symbol, r * 2)
  // Halo under the whole silhouette (unless Outline is off), then the body, then cut-outs in the outline colour.
  if (width > 0) {
    tracePlantSymbolContours(graphics, art.body, 0, 0, r)
    graphics.stroke({ color: edge, width, join: 'round', cap: 'round' })
  }
  tracePlantSymbolContours(graphics, art.body, 0, 0, r)
  graphics.fill({ color })
  if (art.cutouts.length === 0) return
  tracePlantSymbolContours(graphics, art.cutouts, 0, 0, r)
  graphics.fill({ color: edge })
}

/** The ring at the local origin; plants draw in the CSS-pixel root, so ring widths need no scaling. */
function drawPlantRing(ring: Graphics, entry: PlantPresentationEntry, state: CanvasInteractionVisualState): void {
  const visual = interactionOutline(state)
  const r = entry.radiusScreenPx
  const radius = entry.selected ? r : Math.max(r * 1.4, MIN_PLANT_RING_RADIUS_PX)
  ring.clear()
  ring.circle(0, 0, radius).stroke(visual.casing)
  ring.circle(0, 0, radius).stroke(visual.stroke)
}

function resolveRenderedPlantSymbol(entry: PlantPresentationEntry): PlantSymbolId {
  return entry.lod === 'dot' || entry.usesCanopyRadius ? 'round' : entry.symbol
}

/** The badge at its offset from the local origin, the plant's screen point. */
function drawStackBadge(badge: Graphics, entry: PlantPresentationEntry, stackCount: number): void {
  const offset = getStackBadgeOffsetPx(entry.radiusScreenPx)
  const size = getStackBadgeSizePx(String(stackCount))
  badge.clear()
  badge.roundRect(
    offset.x - size.width / 2,
    offset.y - size.height / 2,
    size.width,
    size.height,
    size.height / 2,
  ).fill({ color: toPixiColor(getStackBadgeBackgroundColor(), 0), alpha: 1 })
}

function drawStackBadgeText(badgeText: Text, entry: PlantPresentationEntry, stackCount: number, at: ScenePoint): void {
  const offset = getStackBadgeOffsetPx(entry.radiusScreenPx)
  badgeText.text = String(stackCount)
  setTextStyle(badgeText, {
    fontFamily: CANVAS_CHROME_FONT_FAMILY,
    fontSize: STACK_BADGE_FONT_SIZE_PX,
    fill: toPixiColor(getStackBadgeTextColor(), 0),
  })
  badgeText.position.set(at.x + offset.x, at.y + offset.y)
  badgeText.anchor.set(0.5, 0.5)
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

interface NoteGraphics {
  readonly textLayer: Container
  readonly highlightLayer: Container
  readonly textById: Map<string, Text>
  readonly highlightById: Map<string, Graphics>
}

function syncAnnotations(
  createText: () => Text,
  notes: NoteGraphics,
  snapshot: SceneRendererSnapshot,
  view: ViewTransform,
  reconcileRemoved: boolean,
): void {
  const { textLayer, highlightLayer, textById, highlightById } = notes
  const layer = getSceneLayerStyle(snapshot.scene, 'annotations')
  textLayer.visible = layer.visible
  textLayer.alpha = layer.opacity
  highlightLayer.visible = layer.visible
  highlightLayer.alpha = layer.opacity
  if (!layer.visible) {
    if (reconcileRemoved) {
      const keep = new Set(snapshot.scene.annotations.map((annotation) => annotation.id))
      destroyEntriesNotIn(textById, keep)
      destroyEntriesNotIn(highlightById, keep)
    }
    return
  }

  const pixelsPerMetre = view.pixelsPerMetre
  const placement = { x: 0, y: 0, scale: pixelsPerMetre }
  const detail = getCanvasDetailLayout(snapshot.scene, pixelsPerMetre)
  const nextIds = new Set<string>()
  for (const annotation of snapshot.scene.annotations) {
    if (annotation.annotationType !== 'text') continue
    nextIds.add(annotation.id)
    const text = textById.get(annotation.id) ?? createText()
    if (!textById.has(annotation.id)) {
      textById.set(annotation.id, text)
      textLayer.addChild(text)
    }
    const revealText = annotation.id === snapshot.revealedAnnotationId
      || (snapshot.hoverTarget?.kind === 'annotation' && snapshot.hoverTarget.id === annotation.id)
    const textAllowed = detail.annotationIds.has(annotation.id)
    const presentation = getAnnotationPresentation(annotation, placement, revealText, textAllowed)
    const origin = view.worldToScreen(annotation.position)
    styleAnnotationText(text, annotation, presentation.textFrame.lineHeightPx, view.camera.bearingDeg)
    text.position.set(origin.x, origin.y)
    text.alpha = presentation.textOpacity
    text.visible = presentation.textOpacity > 0

    const interactionState = resolveInteractionState(
      snapshot.selectedAnnotationIds.has(annotation.id),
      false,
      hoverStateForTarget(snapshot, 'annotation', annotation.id),
    )
    const highlight = highlightById.get(annotation.id)
    if (interactionState || presentation.markerOpacity > 0) {
      const nextHighlight = highlight ?? new Graphics()
      if (!highlightById.has(annotation.id)) {
        highlightById.set(annotation.id, nextHighlight)
        highlightLayer.addChild(nextHighlight)
      }
      nextHighlight.clear()
      if (presentation.markerOpacity > 0) {
        traceAnnotationMarker(nextHighlight, presentation.markerPaths, origin)
        nextHighlight.stroke({ color: toPixiColor(getMapBackdropInk().halo, 0),
          width: presentation.markerStrokePx + OVERLAY_CASING_EXTRA_PX, alpha: presentation.markerOpacity, cap: 'round', join: 'round' })
        traceAnnotationMarker(nextHighlight, presentation.markerPaths, origin)
        nextHighlight.stroke({ color: toPixiColor(getAnnotationTextColor(), 0),
          width: presentation.markerStrokePx, alpha: presentation.markerOpacity })
      }
      if (interactionState) {
        const corners = getAnnotationVisualWorldCorners(annotation, pixelsPerMetre, revealText, { x: 4, y: 2 }, textAllowed)
          .map((point) => view.worldToScreen(point))
        const outline = casedStroke(getCanvasInteractionStrokeVisual(interactionState), 1)
        drawClosedPath(nextHighlight, corners).stroke(outline.casing)
        drawClosedPath(nextHighlight, corners).stroke(outline.stroke)
      }
      nextHighlight.visible = true
    } else if (reconcileRemoved) {
      if (highlight) {
        highlight.removeFromParent()
        highlight.destroy()
      }
      highlightById.delete(annotation.id)
    } else if (highlight) {
      highlight.visible = false
    }
  }

  if (!reconcileRemoved) return
  for (const [annotationId, text] of textById) {
    if (nextIds.has(annotationId)) continue
    text.removeFromParent()
    text.destroy()
    textById.delete(annotationId)
  }
  for (const [annotationId, highlight] of highlightById) {
    if (nextIds.has(annotationId)) continue
    highlight.removeFromParent()
    highlight.destroy()
    highlightById.delete(annotationId)
  }
}

/** A note's text, style and on-screen angle (its own angle less the bearing); the caller places it at the note's screen point. */
export function styleAnnotationText(text: Text, annotation: SceneAnnotationEntity, lineHeightPx: number, bearingDeg: number): void {
  text.text = annotation.text
  setTextStyle(text, {
    fontFamily: CANVAS_CHROME_FONT_FAMILY,
    fontSize: annotation.fontSize,
    lineHeight: lineHeightPx,
    fill: getAnnotationTextColor(),
    stroke: labelHaloStroke(annotation.fontSize),
  })
  text.rotation = (((annotation.rotationDeg ?? 0) - bearingDeg) * Math.PI) / 180
  text.anchor.set(0, 0)
}

/** A note's marker paths, CSS px from `origin`. */
export function traceAnnotationMarker(
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

function syncMeasurementLabels(
  createText: () => Text,
  layer: Container,
  labelById: Map<string, Text>,
  snapshot: SceneRendererSnapshot,
  view: ViewTransform,
  reconcileRemoved: boolean,
): void {
  const style = getSceneLayerStyle(snapshot.scene, 'measurement-guides')
  layer.visible = style.visible
  layer.alpha = style.opacity
  if (!style.visible) {
    if (reconcileRemoved) destroyEntriesNotIn(labelById, new Set(snapshot.scene.measurementGuides.map((guide) => guide.id)))
    return
  }

  const nextIds = new Set<string>()
  for (const guide of snapshot.scene.measurementGuides) {
    const presentation = createMeasurementGuidePresentation(guide)
    if (!presentation) continue
    nextIds.add(guide.id)
    let text = labelById.get(guide.id)
    if (!text) {
      text = createText()
      labelById.set(guide.id, text)
      layer.addChild(text)
    }
    text.text = presentation.text
    setTextStyle(text, {
      fontFamily: CANVAS_CHROME_FONT_FAMILY,
      fontSize: MEASUREMENT_GUIDE_LABEL_FONT_SIZE_PX,
      // Map text follows the backdrop; the guide's own stroke carries the interaction state.
      fill: toPixiColor(getAnnotationTextColor(), 0),
      stroke: labelHaloStroke(MEASUREMENT_GUIDE_LABEL_FONT_SIZE_PX),
    })
    const pose = measurementGuideLabelPoseIn(guide, view)
    text.position.set(pose.point.x, pose.point.y)
    text.rotation = pose.rotationRad
    text.anchor.set(0.5, 0.5)
    text.visible = isMeasurementLabelVisible(snapshot, view.pixelsPerMetre, guide.id)
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

function syncSelectionLabels(
  createText: () => Text,
  layer: Container,
  labelBySpecies: Map<string, Text>,
  view: ViewTransform,
  projection: AnchorProjection,
  labels: readonly SelectionLabel[],
): void {
  const nextSpecies = new Set(labels.map((label) => label.canonicalName))
  const projected = projection.project(view, labels.map((label) => label.anchor))
  labels.forEach((label, index) => {
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
    text.position.set(projected[index * 2]! + label.offsetPx.x, projected[index * 2 + 1]! + label.offsetPx.y)
    text.anchor.set(0.5, 0)
    text.visible = true
  })

  for (const [species, text] of labelBySpecies) {
    if (nextSpecies.has(species)) continue
    text.removeFromParent()
    text.destroy()
    labelBySpecies.delete(species)
  }
}

function syncPlantNameLabels(
  createText: () => Text,
  layer: Container,
  labelByPlantId: Map<string, Text>,
  snapshot: SceneRendererSnapshot,
  view: ViewTransform,
  projection: AnchorProjection,
  labels: readonly PlantNameLabel[],
): void {
  const plantLayer = getSceneLayerStyle(snapshot.scene, 'plants')
  layer.visible = plantLayer.visible
  layer.alpha = plantLayer.opacity
  const nextPlantIds = new Set(labels.map((label) => label.plantId))

  if (plantLayer.visible) {
    const projected = projection.project(view, labels.map((label) => label.anchor))
    labels.forEach((label, index) => {
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
      text.position.set(projected[index * 2]! + label.offsetPx.x, projected[index * 2 + 1]! + label.offsetPx.y)
      text.anchor.set(0.5, 0)
      text.alpha = label.opacity
      text.visible = true
    })
  }

  for (const [plantId, text] of labelByPlantId) {
    if (plantLayer.visible && nextPlantIds.has(plantId)) continue
    text.removeFromParent()
    text.destroy()
    labelByPlantId.delete(plantId)
  }
}
