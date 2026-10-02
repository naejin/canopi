import { getCanvasTextOpacity } from './text-visibility'
import {
  getPlantWorldBounds,
  type PlantPresentationContext,
} from './plant-presentation'
import type { ScenePlantEntity, ScenePoint } from './scene'
import type { SpeciesCacheEntry } from './species-cache'
import type { SceneRendererSnapshot } from './renderers/scene-types'

/**
 * A plant's name label: drawn upright at `offsetPx` (CSS px) from its plant's projected `anchor` (world metres), so a pan
 * moves it with its plant. Where it lands is the frame's: `view.worldToScreen(anchor)` plus `offsetPx`.
 */
interface AnchoredLabel {
  anchor: ScenePoint
  offsetPx: ScenePoint
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

/** A single selection's label and the pinned names, at `pixelsPerMetre`. */
export function projectScenePlantLabels(
  snapshot: Pick<SceneRendererSnapshot, 'scene' | 'speciesCache' | 'localizedCommonNames' | 'selectionLabelPlantIds'>,
  pixelsPerMetre: number,
): { readonly pinnedPlantNameLabels: PlantNameLabel[]; readonly selectionLabels: SelectionLabel[] } {
  const { scene, speciesCache, localizedCommonNames, selectionLabelPlantIds } = snapshot
  const plantContext = { plants: scene.plants, viewport: scaleOnly(pixelsPerMetre), speciesCache, localizedCommonNames }
  return {
    pinnedPlantNameLabels: computePinnedPlantNameLabels(scene.plants, pixelsPerMetre, localizedCommonNames,
      { plantContext, selectionLabelPlantIds }),
    selectionLabels: computeSelectionLabels(scene.plants, selectionLabelPlantIds, pixelsPerMetre,
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
  pixelsPerMetre: number,
  localizedCommonNames: ReadonlyMap<string, string | null>,
  options: SelectionLabelOptions = {},
): SelectionLabel[] {
  if (selectedIds.size !== 1) return []

  const selectedId = selectedIds.values().next().value
  const plant = plants.find((candidate) => candidate.id === selectedId)
  if (!plant || plant.pinnedName) return []

  const offsetYPx = plantLabelOffsetPx(plant, pixelsPerMetre, options.plantContext, plants)

  const localizedName = localizedCommonNames.get(plant.canonicalName) ?? plant.commonName
  const text = localizedName || abbreviateCanonical(plant.canonicalName)
  const fontStyle = localizedName ? 'normal' as const : 'italic' as const

  return [{ canonicalName: plant.canonicalName, text, fontStyle, ...below(plant.position, offsetYPx) }]
}

export function computePinnedPlantNameLabels(
  plants: readonly ScenePlantEntity[],
  pixelsPerMetre: number,
  localizedCommonNames: ReadonlyMap<string, string | null>,
  options: SelectionLabelOptions = {},
): PlantNameLabel[] {
  const labels: PlantNameLabel[] = []
  const overviewOpacity = getCanvasTextOpacity(pixelsPerMetre)
  const revealedId = options.selectionLabelPlantIds?.size === 1
    ? options.selectionLabelPlantIds.values().next().value
    : null
  for (const plant of plants) {
    if (!plant.pinnedName) continue
    const opacity = plant.id === revealedId ? 1 : overviewOpacity
    if (opacity === 0) continue
    const offsetYPx = plantLabelOffsetPx(plant, pixelsPerMetre, options.plantContext, plants)

    const localizedName = localizedCommonNames.get(plant.canonicalName) ?? plant.commonName
    const text = localizedName || abbreviateCanonical(plant.canonicalName)
    const fontStyle = localizedName ? 'normal' as const : 'italic' as const
    labels.push({ plantId: plant.id, text, fontStyle, opacity, ...below(plant.position, offsetYPx) })
  }

  return labels
}

/** A label `offsetYPx` below `anchor`. */
function below(anchor: ScenePoint, offsetYPx: number): AnchoredLabel {
  return { anchor: { x: anchor.x, y: anchor.y }, offsetPx: { x: 0, y: offsetYPx } }
}

/** Plant presentation reads only a context's scale (`PlantPresentationContext.viewport`, until 0E retypes it). */
function scaleOnly(pixelsPerMetre: number): PlantPresentationContext['viewport'] {
  return { x: 0, y: 0, scale: pixelsPerMetre }
}

/** The gap below a plant's footprint, at `pixelsPerMetre`, clamped to today's 5–8 px. */
function plantLabelOffsetPx(
  plant: ScenePlantEntity,
  pixelsPerMetre: number,
  plantContext: PlantPresentationContext | undefined,
  plants: readonly ScenePlantEntity[],
): number {
  const bounds = getPlantWorldBounds(plant, {
    ...plantContext,
    viewport: scaleOnly(pixelsPerMetre),
    speciesCache: plantContext?.speciesCache ?? EMPTY_SPECIES_CACHE,
    plants,
  })
  const radiusPx = (Math.max(bounds.width, bounds.height) * pixelsPerMetre) / 2
  return clamp(radiusPx + PLANT_LABEL_GAP_PX, PLANT_LABEL_MIN_OFFSET_PX, PLANT_LABEL_MAX_OFFSET_PX)
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
