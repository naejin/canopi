import { DEFAULT_PLANT_COLOR, normalizeHexColor } from '../plant-colors'
import {
  getPlantLOD,
  getStratumColor,
  type PlantLOD,
} from '../plants'
import {
  resolvePlantSymbolForPlant,
  type PlantSymbolId,
  type ScenePlantEntity,
  type ScenePoint,
} from './scene'
import type { SpeciesCacheEntry } from './species-cache'
import { nearestPlantSpacing } from '../plant-spacing'
import { getCanvasPlantDisplay, resolveDisplayedPlantColor, type PlantDisplay } from './plant-display'

/** Stack badge count text: the 12 px type floor (digits only, so no CJK raise). */
export const STACK_BADGE_FONT_SIZE_PX = 12
/** Badge height; it is a circle for one digit and a pill for more. */
const STACK_BADGE_HEIGHT_PX = 18
const STACK_BADGE_GAP_PX = 2
// A 12 px Source Sans 3 digit is about 6.1 px wide; 7 keeps a margin for fallback fonts.
const STACK_BADGE_DIGIT_WIDTH_PX = 7
const STACK_BADGE_PADDING_PX = 5

export interface PlantPresentationContext {
  /** The view's scale: screen sizes in CSS px turn into metres with it. */
  pixelsPerMetre: number
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
  /** The anchor plant's position (world metres); the badge's centre is its projection plus `badgeOffsetPx`. */
  anchor: ScenePoint
  badgeOffsetPx: ScenePoint
}

/** Screen size of the badge that shows `text` (the stack count). */
export function getStackBadgeSizePx(text: string): { width: number; height: number } {
  return {
    width: Math.max(STACK_BADGE_HEIGHT_PX, text.length * STACK_BADGE_DIGIT_WIDTH_PX + STACK_BADGE_PADDING_PX * 2),
    height: STACK_BADGE_HEIGHT_PX,
  }
}

export function getStackBadgeOffsetPx(radiusScreenPx: number): ScenePoint {
  const offset = radiusScreenPx + STACK_BADGE_GAP_PX
  return { x: offset, y: -offset }
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
  const lod = getPlantLOD(context.pixelsPerMetre)
  context = { ...context, plants: context.plants ?? plants }
  return plants.map((plant) => {
    const radiusPresentation = resolvePlantRadiusPresentation(plant, context)
    const radiusWorld = radiusPresentation.radiusWorld
    const radiusScreenPx = radiusPresentation.radiusScreenPx
    const baseColor = resolvePlantBaseColor(plant, context.speciesCache)
    const color = resolveDisplayedPlantColor(baseColor, plant.canonicalName, getCanvasPlantDisplay())
    const symbol = resolvePlantSymbolForPlant(plant, context.plantSpeciesSymbols ?? {})
    const selected = selectedPlantIds.has(plant.id)
    return {
      plant,
      radiusWorld,
      radiusScreenPx,
      color,
      baseColor,
      symbol,
      usesCanopyRadius: radiusPresentation.usesCanopyRadius,
      stackPriority: getStackPriority(plant, selected),
      lod: radiusScreenPx < 3.6 ? 'dot' : lod,
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

/** The plant's hit area on screen about `screenPoint`, its position projected through the view. */
export function getPlantScreenHitBounds(
  plant: ScenePlantEntity,
  context: PlantPresentationContext,
  screenPoint: ScenePoint,
): PlantScreenHitBounds {
  const hitRadiusPx = plantHitRadiusPx(plant, context)
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

/** The drawn radius plus the interaction padding, in CSS px. */
function plantHitRadiusPx(plant: ScenePlantEntity, context: PlantPresentationContext): number {
  return resolvePlantRadiusWorld(plant, context) * context.pixelsPerMetre + 4
}

export function hitTestPlant(
  plant: ScenePlantEntity,
  point: ScenePoint,
  context: PlantPresentationContext,
): boolean {
  const radiusWorld = plantHitRadiusPx(plant, context) / Math.max(context.pixelsPerMetre, 0.001)
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

/** The colour the plant is drawn with under the current plant display; its stored colour never changes. */
export function resolvePlantDisplayColor(
  plant: ScenePlantEntity,
  speciesCache: ReadonlyMap<string, SpeciesCacheEntry>,
  display: PlantDisplay = getCanvasPlantDisplay(),
): string {
  return resolveDisplayedPlantColor(resolvePlantBaseColor(plant, speciesCache), plant.canonicalName, display)
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

    decisions.push({
      anchorPlantId: anchor.plant.id,
      memberPlantIds: [...memberIds].sort(),
      count: memberIds.length,
      text: String(memberIds.length),
      anchor: { x: anchor.plant.position.x, y: anchor.plant.position.y },
      badgeOffsetPx: getStackBadgeOffsetPx(anchor.radiusScreenPx),
    })
  }

  return decisions
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
): { radiusWorld: number; radiusScreenPx: number; usesCanopyRadius: boolean } {
  const scale = Math.max(context.pixelsPerMetre, .001)
  const spacing = context.plants ? nearestPlantSpacing(context.plants, plant.position) : Infinity
  // Display › Symbol size scales the footprint, so drawing, hit testing and bounds agree.
  const radiusScreenPx = Math.max(.65, Math.min(getSymbolicPlantRadiusScreenPx(scale), spacing * scale * .42)
    * getCanvasPlantDisplay().symbolScale)
  return { radiusWorld: radiusScreenPx / scale, radiusScreenPx, usesCanopyRadius: false }
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
