import { getCanvasTextOpacity } from './text-visibility'
import { worldToScreen } from './annotation-layout'
import {
  getPlantWorldBounds,
  type PlantPresentationContext,
} from './plant-presentation'
import type { ScenePlantEntity, ScenePoint, SceneViewportState } from './scene'
import type { SpeciesCacheEntry } from './species-cache'
import type { SceneRendererSnapshot } from './renderers/scene-types'

/**
 * A plant's name label: drawn upright at `offsetPx` (CSS px) from its plant's projected `anchor` (world metres), so a pan
 * moves it with its plant. `screenPoint` is where it lands under the viewport it was computed with.
 */
interface AnchoredLabel {
  anchor: ScenePoint
  offsetPx: ScenePoint
  screenPoint: ScenePoint
}

export interface SelectionLabel extends AnchoredLabel {
  canonicalName: string
  text: string
  fontStyle: 'normal' | 'italic'
}

export interface PlantNameLabel extends AnchoredLabel {
  plantId: string
  opacity: number
  text: string
  fontStyle: 'normal' | 'italic'
}

/** A single selection's label and the pinned names, under `viewport`. */
export function projectScenePlantLabels(
  snapshot: Pick<SceneRendererSnapshot, 'scene' | 'speciesCache' | 'localizedCommonNames' | 'selectionLabelPlantIds'>,
  viewport: SceneViewportState,
): { readonly pinnedPlantNameLabels: PlantNameLabel[]; readonly selectionLabels: SelectionLabel[] } {
  const { scene, speciesCache, localizedCommonNames, selectionLabelPlantIds } = snapshot
  const plantContext = { plants: scene.plants, viewport, speciesCache, localizedCommonNames }
  return {
    pinnedPlantNameLabels: computePinnedPlantNameLabels(scene.plants, viewport, localizedCommonNames,
      { plantContext, selectionLabelPlantIds }),
    selectionLabels: computeSelectionLabels(scene.plants, selectionLabelPlantIds, viewport,
      localizedCommonNames, { plantContext }),
  }
}

export interface SelectionLabelOptions {
  plantContext?: PlantPresentationContext
  selectionLabelPlantIds?: ReadonlySet<string>
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

  const offsetYPx = plantLabelOffsetPx([plant], viewport, { ...options.plantContext, viewport, speciesCache: options.plantContext?.speciesCache ?? EMPTY_SPECIES_CACHE, plants })

  const localizedName = localizedCommonNames.get(plant.canonicalName) ?? plant.commonName
  const text = localizedName || abbreviateCanonical(plant.canonicalName)
  const fontStyle = localizedName ? 'normal' as const : 'italic' as const

  return [{ canonicalName: plant.canonicalName, text, fontStyle, ...below(plant.position, offsetYPx, viewport) }]
}

export function computePinnedPlantNameLabels(
  plants: readonly ScenePlantEntity[],
  viewport: SceneViewportState,
  localizedCommonNames: ReadonlyMap<string, string | null>,
  options: SelectionLabelOptions = {},
): PlantNameLabel[] {
  const labels: PlantNameLabel[] = []
  const overviewOpacity = getCanvasTextOpacity(viewport.scale)
  const revealedId = options.selectionLabelPlantIds?.size === 1
    ? options.selectionLabelPlantIds.values().next().value
    : null
  for (const plant of plants) {
    if (!plant.pinnedName) continue
    const opacity = plant.id === revealedId ? 1 : overviewOpacity
    if (opacity === 0) continue
    const offsetYPx = plantLabelOffsetPx([plant], viewport, { ...options.plantContext, viewport, speciesCache: options.plantContext?.speciesCache ?? EMPTY_SPECIES_CACHE, plants })

    const localizedName = localizedCommonNames.get(plant.canonicalName) ?? plant.commonName
    const text = localizedName || abbreviateCanonical(plant.canonicalName)
    const fontStyle = localizedName ? 'normal' as const : 'italic' as const
    labels.push({ plantId: plant.id, text, fontStyle, opacity, ...below(plant.position, offsetYPx, viewport) })
  }

  return labels
}

/** A label `offsetYPx` below `anchor`, and where that lands under `viewport`. */
function below(anchor: ScenePoint, offsetYPx: number, viewport: SceneViewportState): AnchoredLabel {
  const screenPoint = worldToScreen(anchor, viewport)
  screenPoint.y += offsetYPx
  return { anchor: { x: anchor.x, y: anchor.y }, offsetPx: { x: 0, y: offsetYPx }, screenPoint }
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
