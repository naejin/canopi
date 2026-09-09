import { DEFAULT_PLANT_COLOR, normalizeHexColor } from '../plant-colors'
import {
  getPlantLOD,
  getStratumColor,
  type PlantLOD,
} from '../plants'
import { worldToScreen } from './annotation-layout'
import {
  resolvePlantSymbolForPlant,
  type PlantSymbolId,
  type ScenePlantEntity,
  type ScenePoint,
  type SceneViewportState,
} from './scene'
import type { SpeciesCacheEntry } from './species-cache'
import { nearestPlantSpacing } from '../plant-spacing'

export const STACK_BADGE_RADIUS_PX = 7
export const STACK_BADGE_GAP_PX = 2

export interface PlantPresentationContext {
  viewport: SceneViewportState
  plants?: readonly ScenePlantEntity[]
  speciesCache: ReadonlyMap<string, SpeciesCacheEntry>
  plantSpeciesSymbols?: Readonly<Record<string, string>>
  localizedCommonNames?: ReadonlyMap<string, string | null>
}

export interface PlantPresentationEntry {
  plant: ScenePlantEntity
  radiusWorld: number
  radiusScreenPx: number
  color: string
  baseColor: string
  symbol: PlantSymbolId
  usesCanopyRadius: boolean
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

export function getStackBadgeOffsetPx(radiusScreenPx: number): ScenePoint {
  const offset = radiusScreenPx + STACK_BADGE_GAP_PX
  return { x: offset, y: -offset }
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
  context = { ...context, plants: context.plants ?? plants }
  return plants.map((plant) => {
    const radiusPresentation = resolvePlantRadiusPresentation(plant, context)
    const radiusWorld = radiusPresentation.radiusWorld
    const radiusScreenPx = radiusWorld * context.viewport.scale
    const baseColor = resolvePlantBaseColor(plant, context.speciesCache)
    const symbol = resolvePlantSymbolForPlant(plant, context.plantSpeciesSymbols ?? {})
    const selected = selectedPlantIds.has(plant.id)
    const screenPoint = worldToScreen(plant.position, context.viewport)
    const hitBoundsScreen = getPlantScreenHitBounds(plant, context)
    return {
      plant,
      radiusWorld,
      radiusScreenPx,
      color: baseColor,
      baseColor,
      symbol,
      usesCanopyRadius: radiusPresentation.usesCanopyRadius,
      stackPriority: getStackPriority(plant, selected),
      lod: radiusScreenPx < 3.6 ? 'dot' : lod,
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
  speciesCache: ReadonlyMap<string, SpeciesCacheEntry>,
): string {
  return resolvePlantBaseColor(plant, speciesCache)
}

export function resolveStackBadgeDecisions(
  entries: readonly PlantPresentationEntry[],
): PlantStackBadgeDecision[] {
  const coincident = new Map<string, PlantPresentationEntry[]>()
  for (const entry of entries) {
    const { x, y } = entry.plant.position
    const key = `${x}:${y}`
    const members = coincident.get(key)
    if (members) members.push(entry)
    else coincident.set(key, [entry])
  }
  const decisions: PlantStackBadgeDecision[] = []
  for (const members of coincident.values()) {
    if (members.length < 2) continue
    members.sort((left, right) => left.stackPriority - right.stackPriority || left.plant.id.localeCompare(right.plant.id))
    const memberIds = members.map((entry) => entry.plant.id)
    const anchor = members[0]
    if (!anchor) continue

    const badgeOffset = getStackBadgeOffsetPx(anchor.radiusScreenPx)
    decisions.push({
      anchorPlantId: anchor.plant.id,
      memberPlantIds: [...memberIds].sort(),
      count: memberIds.length,
      text: String(memberIds.length),
      anchorScreenPoint: anchor.screenPoint,
      badgeCenterScreenPoint: {
        x: anchor.screenPoint.x + badgeOffset.x,
        y: anchor.screenPoint.y + badgeOffset.y,
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

const SYMBOLIC_PLANT_MIN_SCREEN_PX = 2
const SYMBOLIC_PLANT_MAX_SCREEN_PX = 6.75
const SYMBOLIC_PLANT_HALF_GROWTH_SCALE = 21

function resolvePlantRadiusWorld(plant: ScenePlantEntity, context: PlantPresentationContext): number {
  return resolvePlantRadiusPresentation(plant, context).radiusWorld
}

function resolvePlantRadiusPresentation(
  plant: ScenePlantEntity,
  context: PlantPresentationContext,
): { radiusWorld: number; usesCanopyRadius: boolean } {
  const scale = Math.max(context.viewport.scale, .001)
  const spacing = context.plants ? nearestPlantSpacing(context.plants, plant.position) : Infinity
  const radiusPx = Math.max(.65, Math.min(getSymbolicPlantRadiusScreenPx(scale), spacing * scale * .42))
  return { radiusWorld: radiusPx / scale, usesCanopyRadius: false }
}

function getSymbolicPlantRadiusScreenPx(viewportScale: number): number {
  const scale = Math.max(viewportScale, 0.001)
  const range = SYMBOLIC_PLANT_MAX_SCREEN_PX - SYMBOLIC_PLANT_MIN_SCREEN_PX
  return SYMBOLIC_PLANT_MIN_SCREEN_PX + (
    range * scale / (scale + SYMBOLIC_PLANT_HALF_GROWTH_SCALE)
  )
}

function getStackPriority(plant: ScenePlantEntity, selected: boolean): number {
  if (selected) return 0
  return normalizeHexColor(plant.color) ? 1 : 2
}
