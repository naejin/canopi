import { worldToScreen } from './annotation-layout'
import {
  getPlantWorldBounds,
  type PlantPresentationContext,
} from './plant-presentation'
import type { ScenePlantEntity, ScenePoint, SceneViewportState } from './scene'
import type { SpeciesCacheEntry } from './species-cache'

export interface SelectionLabel {
  canonicalName: string
  text: string
  fontStyle: 'normal' | 'italic'
  screenPoint: ScenePoint
}

export interface PlantNameLabel {
  plantId: string
  text: string
  fontStyle: 'normal' | 'italic'
  screenPoint: ScenePoint
}

export interface SelectionLabelOptions {
  plantContext?: PlantPresentationContext
}

const PLANT_LABEL_GAP_PX = 2
const PLANT_LABEL_MIN_OFFSET_PX = 5
const PLANT_LABEL_MAX_OFFSET_PX = 8
const EMPTY_SPECIES_CACHE = new Map<string, SpeciesCacheEntry>()

export function computeSelectionLabels(
  plants: readonly ScenePlantEntity[],
  selectedIds: ReadonlySet<string>,
  viewport: SceneViewportState,
  localizedCommonNames: ReadonlyMap<string, string | null>,
  options: SelectionLabelOptions = {},
): SelectionLabel[] {
  if (selectedIds.size !== 1) return []

  const selectedId = selectedIds.values().next().value
  const plant = plants.find((candidate) => candidate.id === selectedId)
  if (!plant || plant.pinnedName) return []

  const screenPoint = worldToScreen(plant.position, viewport)
  screenPoint.y += plantLabelOffsetPx([plant], viewport, options.plantContext)

  const localizedName = localizedCommonNames.get(plant.canonicalName) ?? plant.commonName
  const text = localizedName || abbreviateCanonical(plant.canonicalName)
  const fontStyle = localizedName ? 'normal' as const : 'italic' as const

  return [{ canonicalName: plant.canonicalName, text, fontStyle, screenPoint }]
}

export function computePinnedPlantNameLabels(
  plants: readonly ScenePlantEntity[],
  viewport: SceneViewportState,
  localizedCommonNames: ReadonlyMap<string, string | null>,
  options: SelectionLabelOptions = {},
): PlantNameLabel[] {
  const labels: PlantNameLabel[] = []
  for (const plant of plants) {
    if (!plant.pinnedName) continue
    const screenPoint = worldToScreen(plant.position, viewport)
    screenPoint.y += plantLabelOffsetPx([plant], viewport, options.plantContext)

    const localizedName = localizedCommonNames.get(plant.canonicalName) ?? plant.commonName
    const text = localizedName || abbreviateCanonical(plant.canonicalName)
    const fontStyle = localizedName ? 'normal' as const : 'italic' as const
    labels.push({ plantId: plant.id, text, fontStyle, screenPoint })
  }

  return labels
}

function plantLabelOffsetPx(
  plants: readonly ScenePlantEntity[],
  viewport: SceneViewportState,
  plantContext: PlantPresentationContext | undefined,
): number {
  let maxRadiusPx = 0
  for (const plant of plants) {
    maxRadiusPx = Math.max(maxRadiusPx, plantVisualRadiusPx(plant, viewport, plantContext))
  }
  return clamp(maxRadiusPx + PLANT_LABEL_GAP_PX, PLANT_LABEL_MIN_OFFSET_PX, PLANT_LABEL_MAX_OFFSET_PX)
}

function plantVisualRadiusPx(
  plant: ScenePlantEntity,
  viewport: SceneViewportState,
  plantContext: PlantPresentationContext | undefined,
): number {
  const bounds = getPlantWorldBounds(plant, {
    ...(plantContext ?? {
      sizeMode: 'default' as const,
      colorByAttr: null,
      speciesCache: EMPTY_SPECIES_CACHE,
    }),
    viewport,
  })
  return (Math.max(bounds.width, bounds.height) * viewport.scale) / 2
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function abbreviateCanonical(name: string): string {
  const parts = name.split(' ')
  return parts.length >= 2
    ? `${parts[0]![0]}. ${parts[1]!.slice(0, 3)}.`
    : name.slice(0, 6)
}
