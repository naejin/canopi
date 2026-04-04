import { zoomReference, type ColorByAttribute, type PlantSizeMode } from '../../state/canvas'
import { getColorForAttribute } from '../display-modes'
import { DEFAULT_PLANT_COLOR, normalizeHexColor } from '../plant-colors'
import {
  CIRCLE_SCREEN_PX,
  getPlantLOD,
  getStratumColor,
  type PlantLOD,
} from '../plants'
import { worldToScreen } from './annotation-layout'
import type { ScenePlantEntity, ScenePoint, SceneViewportState } from './scene'
import type { SpeciesCacheEntry } from './species-cache'

const STACK_THRESHOLD_PX = 5
const STACK_THRESHOLD_SQ = STACK_THRESHOLD_PX * STACK_THRESHOLD_PX
export const STACK_BADGE_RADIUS_PX = 7
export const STACK_BADGE_OFFSET_X_PX = CIRCLE_SCREEN_PX + 2
export const STACK_BADGE_OFFSET_Y_PX = -(CIRCLE_SCREEN_PX + 2)

export interface PlantPresentationContext {
  viewport: SceneViewportState
  sizeMode: PlantSizeMode
  colorByAttr: ColorByAttribute | null
  speciesCache: ReadonlyMap<string, SpeciesCacheEntry>
  localizedCommonNames?: ReadonlyMap<string, string | null>
  zoomReference?: number
}

export interface PlantPresentationEntry {
  plant: ScenePlantEntity
  radiusWorld: number
  radiusScreenPx: number
  color: string
  baseColor: string
  stackPriority: number
  lod: PlantLOD
  screenPoint: ScenePoint
  hitBoundsScreen: PlantScreenHitBounds
  selected: boolean
}

export interface PlantLayoutResult {
  lod: PlantLOD
  stackCounts: ReadonlyMap<string, number>
}

export interface PlantScreenHitBounds {
  center: ScenePoint
  radiusPx: number
  bounds: {
    x: number
    y: number
    width: number
    height: number
  }
}

export interface PlantStackBadgeDecision {
  anchorPlantId: string
  memberPlantIds: ReadonlyArray<string>
  count: number
  text: string
  anchorScreenPoint: ScenePoint
  badgeCenterScreenPoint: ScenePoint
}

export interface PlantPresentationSnapshot {
  entries: PlantPresentationEntry[]
  layout: PlantLayoutResult
  stackBadges: PlantStackBadgeDecision[]
}

export interface PlantWorldBounds {
  x: number
  y: number
  width: number
  height: number
}

export function buildPlantPresentationEntries(
  plants: readonly ScenePlantEntity[],
  context: PlantPresentationContext,
  selectedPlantIds: ReadonlySet<string>,
): PlantPresentationEntry[] {
  const lod = getPlantLOD(context.viewport.scale)
  return plants.map((plant) => {
    const radiusWorld = resolvePlantRadiusWorld(plant, context)
    const radiusScreenPx = radiusWorld * context.viewport.scale
    const baseColor = resolvePlantBaseColor(plant, context.speciesCache)
    const color = resolvePlantDisplayColor(plant, context.colorByAttr, context.speciesCache)
    const selected = selectedPlantIds.has(plant.id)
    const screenPoint = worldToScreen(plant.position, context.viewport)
    const hitBoundsScreen = getPlantScreenHitBounds(plant, context)
    return {
      plant,
      radiusWorld,
      radiusScreenPx,
      color,
      baseColor,
      stackPriority: getStackPriority(plant, selected),
      lod,
      screenPoint,
      hitBoundsScreen,
      selected,
    }
  })
}

export function layoutPlantPresentation(
  entries: readonly PlantPresentationEntry[],
  viewportScale: number,
): PlantLayoutResult {
  const lod = getPlantLOD(viewportScale)
  const stackCounts = new Map(
    resolveStackBadgeDecisions(entries).map((badge) => [badge.anchorPlantId, badge.count]),
  )
  return { lod, stackCounts }
}

export function getPlantWorldBounds(
  plant: ScenePlantEntity,
  context: PlantPresentationContext,
): PlantWorldBounds {
  const radiusWorld = resolvePlantRadiusWorld(plant, context)
  return {
    x: plant.position.x - radiusWorld,
    y: plant.position.y - radiusWorld,
    width: radiusWorld * 2,
    height: radiusWorld * 2,
  }
}

export function getPlantScreenHitBounds(
  plant: ScenePlantEntity,
  context: PlantPresentationContext,
): PlantScreenHitBounds {
  const screenPoint = worldToScreen(plant.position, context.viewport)
  const radiusScreenPx = resolvePlantRadiusWorld(plant, context) * context.viewport.scale
  const hitRadiusPx = radiusScreenPx + 4
  return {
    center: screenPoint,
    radiusPx: hitRadiusPx,
    bounds: {
      x: screenPoint.x - hitRadiusPx,
      y: screenPoint.y - hitRadiusPx,
      width: hitRadiusPx * 2,
      height: hitRadiusPx * 2,
    },
  }
}

export function hitTestPlant(
  plant: ScenePlantEntity,
  point: ScenePoint,
  context: PlantPresentationContext,
): boolean {
  const radiusWorld = getPlantScreenHitBounds(plant, context).radiusPx / Math.max(context.viewport.scale, 0.001)
  const dx = point.x - plant.position.x
  const dy = point.y - plant.position.y
  return dx * dx + dy * dy <= radiusWorld * radiusWorld
}

export function resolvePlantBaseColor(
  plant: ScenePlantEntity,
  speciesCache: ReadonlyMap<string, SpeciesCacheEntry>,
): string {
  const override = normalizeHexColor(plant.color)
  if (override) return override
  const stratum = resolvePlantStratum(plant, speciesCache)
  return getStratumColor(stratum) || DEFAULT_PLANT_COLOR
}

export function resolvePlantStratum(
  plant: ScenePlantEntity,
  speciesCache: ReadonlyMap<string, SpeciesCacheEntry>,
): string | null {
  if (typeof plant.stratum === 'string' && plant.stratum.length > 0) return plant.stratum
  const cached = speciesCache.get(plant.canonicalName)
  return typeof cached?.stratum === 'string' && cached.stratum.length > 0
    ? cached.stratum
    : null
}

export function resolvePlantCanopySpreadM(
  plant: ScenePlantEntity,
  speciesCache: ReadonlyMap<string, SpeciesCacheEntry>,
): number | null {
  if (typeof plant.canopySpreadM === 'number' && plant.canopySpreadM > 0) return plant.canopySpreadM
  const cached = speciesCache.get(plant.canonicalName)
  return typeof cached?.width_max_m === 'number' && cached.width_max_m > 0
    ? cached.width_max_m
    : null
}

export function resolvePlantDisplayColor(
  plant: ScenePlantEntity,
  colorByAttr: ColorByAttribute | null,
  speciesCache: ReadonlyMap<string, SpeciesCacheEntry>,
): string {
  const baseColor = resolvePlantBaseColor(plant, speciesCache)
  if (colorByAttr === null) return baseColor
  return resolvePlantColorByAttribute(plant, colorByAttr, speciesCache)
}

export function resolveStackBadgeDecisions(
  entries: readonly PlantPresentationEntry[],
): PlantStackBadgeDecision[] {
  const index = new ScreenBucketIndex(STACK_THRESHOLD_PX, (entry) => entry.screenPoint)
  index.rebuild(entries)
  const byId = new Map(entries.map((entry) => [entry.plant.id, entry]))
  const visited = new Set<string>()
  const decisions: PlantStackBadgeDecision[] = []

  for (const entry of entries) {
    if (visited.has(entry.plant.id)) continue

    const queue = [entry]
    const memberIds: string[] = []
    visited.add(entry.plant.id)

    while (queue.length > 0) {
      const current = queue.shift()
      if (!current) continue
      memberIds.push(current.plant.id)

      for (const neighbor of index.queryNeighbors(
        current.screenPoint.x,
        current.screenPoint.y,
        STACK_THRESHOLD_PX,
      )) {
        if (visited.has(neighbor.plant.id) || neighbor.plant.id === current.plant.id) continue
        const dx = current.screenPoint.x - neighbor.screenPoint.x
        const dy = current.screenPoint.y - neighbor.screenPoint.y
        if (dx * dx + dy * dy >= STACK_THRESHOLD_SQ) continue
        visited.add(neighbor.plant.id)
        queue.push(neighbor)
      }
    }

    if (memberIds.length < 2) continue

    const members = memberIds
      .map((memberId) => byId.get(memberId))
      .filter((value): value is PlantPresentationEntry => value !== undefined)
      .sort((left, right) => {
        if (left.stackPriority !== right.stackPriority) {
          return left.stackPriority - right.stackPriority
        }
        return (left.screenPoint.y - right.screenPoint.y)
          || (left.screenPoint.x - right.screenPoint.x)
      })
    const anchor = members[0]
    if (!anchor) continue

    decisions.push({
      anchorPlantId: anchor.plant.id,
      memberPlantIds: [...memberIds].sort(),
      count: memberIds.length,
      text: String(memberIds.length),
      anchorScreenPoint: anchor.screenPoint,
      badgeCenterScreenPoint: {
        x: anchor.screenPoint.x + STACK_BADGE_OFFSET_X_PX,
        y: anchor.screenPoint.y + STACK_BADGE_OFFSET_Y_PX,
      },
    })
  }

  return decisions
}

export function buildPlantPresentationSnapshot(
  plants: readonly ScenePlantEntity[],
  context: PlantPresentationContext,
  selectedPlantIds: ReadonlySet<string>,
): PlantPresentationSnapshot {
  const entries = buildPlantPresentationEntries(plants, context, selectedPlantIds)
  return {
    entries,
    layout: layoutPlantPresentation(entries, context.viewport.scale),
    stackBadges: resolveStackBadgeDecisions(entries),
  }
}

function resolvePlantRadiusWorld(
  plant: ScenePlantEntity,
  context: PlantPresentationContext,
): number {
  if (context.sizeMode === 'canopy') {
    const canopySpreadM = resolvePlantCanopySpreadM(plant, context.speciesCache)
    if (canopySpreadM && canopySpreadM > 0) return canopySpreadM / 2
    return getFallbackWorldRadius(context.zoomReference)
  }
  return CIRCLE_SCREEN_PX / Math.max(context.viewport.scale, 0.001)
}

function resolvePlantColorByAttribute(
  plant: ScenePlantEntity,
  colorByAttr: ColorByAttribute,
  speciesCache: ReadonlyMap<string, SpeciesCacheEntry>,
): string {
  if (colorByAttr === 'stratum') {
    return getStratumColor(resolvePlantStratum(plant, speciesCache))
  }
  return getColorForAttribute(colorByAttr, speciesCache.get(plant.canonicalName))
}

function getFallbackWorldRadius(referenceScaleOverride?: number): number {
  const referenceScale = referenceScaleOverride && referenceScaleOverride > 0
    ? referenceScaleOverride
    : (zoomReference.value > 0 ? zoomReference.value : 1)
  return CIRCLE_SCREEN_PX / referenceScale
}

function getStackPriority(plant: ScenePlantEntity, selected: boolean): number {
  if (selected) return 0
  return normalizeHexColor(plant.color) ? 1 : 2
}

class ScreenBucketIndex {
  private readonly _cells = new Map<string, PlantPresentationEntry[]>()

  constructor(
    private readonly _cellSize: number,
    private readonly _pointOf: (entry: PlantPresentationEntry) => ScenePoint,
  ) {}

  rebuild(entries: readonly PlantPresentationEntry[]): void {
    this._cells.clear()
    for (const entry of entries) {
      const point = this._pointOf(entry)
      const key = this._keyFor(point.x, point.y)
      const current = this._cells.get(key)
      if (current) current.push(entry)
      else this._cells.set(key, [entry])
    }
  }

  queryNeighbors(x: number, y: number, radius: number): PlantPresentationEntry[] {
    const minX = Math.floor((x - radius) / this._cellSize)
    const maxX = Math.floor((x + radius) / this._cellSize)
    const minY = Math.floor((y - radius) / this._cellSize)
    const maxY = Math.floor((y + radius) / this._cellSize)
    const results: PlantPresentationEntry[] = []

    for (let cellX = minX; cellX <= maxX; cellX += 1) {
      for (let cellY = minY; cellY <= maxY; cellY += 1) {
        const cell = this._cells.get(`${cellX}:${cellY}`)
        if (cell) results.push(...cell)
      }
    }
    return results
  }

  private _keyFor(x: number, y: number): string {
    return `${Math.floor(x / this._cellSize)}:${Math.floor(y / this._cellSize)}`
  }
}

export class PlantPresentationService {
  buildEntries = buildPlantPresentationEntries
  buildSnapshot = buildPlantPresentationSnapshot
  layout = layoutPlantPresentation
  getWorldBounds = getPlantWorldBounds
  getScreenHitBounds = getPlantScreenHitBounds
  hitTest = hitTestPlant
  resolveBaseColor = resolvePlantBaseColor
  resolveDisplayColor = resolvePlantDisplayColor
  resolveStratum = resolvePlantStratum
  resolveCanopySpreadM = resolvePlantCanopySpreadM
  resolveStackBadges = resolveStackBadgeDecisions
}

export const plantPresentationService = new PlantPresentationService()
