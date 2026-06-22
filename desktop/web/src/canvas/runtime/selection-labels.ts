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

const LABEL_OVERLAP_PX = 16
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
  if (selectedIds.size === 0) return []

  // Group selected plants by species
  const groups = new Map<string, ScenePlantEntity[]>()
  for (const plant of plants) {
    if (!selectedIds.has(plant.id)) continue
    const group = groups.get(plant.canonicalName)
    if (group) group.push(plant)
    else groups.set(plant.canonicalName, [plant])
  }

  // Compute one label per species at centroid
  const labels: SelectionLabel[] = []
  for (const [canonicalName, group] of groups) {
    let sumX = 0
    let sumY = 0
    for (const plant of group) {
      sumX += plant.position.x
      sumY += plant.position.y
    }
    const worldCentroid = { x: sumX / group.length, y: sumY / group.length }
    const screenPoint = worldToScreen(worldCentroid, viewport)
    screenPoint.y += plantLabelOffsetPx(group, viewport, options.plantContext)

    const localizedName = localizedCommonNames.get(canonicalName) ?? group[0]!.commonName
    const text = localizedName || abbreviateCanonical(canonicalName)
    const fontStyle = localizedName ? 'normal' as const : 'italic' as const

    labels.push({ canonicalName, text, fontStyle, screenPoint })
  }

  // Sort by screen Y and nudge overlapping labels apart
  labels.sort((a, b) => a.screenPoint.y - b.screenPoint.y)
  for (let i = 1; i < labels.length; i++) {
    const prev = labels[i - 1]!
    const curr = labels[i]!
    const overlap = (prev.screenPoint.y + LABEL_OVERLAP_PX) - curr.screenPoint.y
    if (overlap > 0) {
      curr.screenPoint.y += overlap
    }
  }

  return labels
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

  labels.sort((a, b) => a.screenPoint.y - b.screenPoint.y)
  for (let i = 1; i < labels.length; i++) {
    const prev = labels[i - 1]!
    const curr = labels[i]!
    const overlap = (prev.screenPoint.y + LABEL_OVERLAP_PX) - curr.screenPoint.y
    if (overlap > 0) {
      curr.screenPoint.y += overlap
    }
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
